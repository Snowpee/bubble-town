import fs from 'node:fs';
import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { DEFAULT_PROFILE_ID, getHermesRoot, getProfileHome } from './hermes-paths.js';

type HermesGatewayChildProcess = ChildProcessByStdio<null, Readable, Readable>;

interface ManagedHermesGatewaySnapshot {
  managed: true;
  running: boolean;
  profileId?: string;
  apiBaseUrl?: string;
  healthUrl?: string;
  port?: number;
  pid?: number;
  logs: string[];
}

interface LaunchGatewayOptions {
  profileId: string;
  port: number;
}

interface SpawnedGateway {
  child: HermesGatewayChildProcess;
  apiBaseUrl: string;
  healthUrl: string;
  port: number;
}

type GatewaySpawner = (options: LaunchGatewayOptions) => SpawnedGateway;
type GatewayHealthChecker = (healthUrl: string) => Promise<boolean>;

const defaultGatewayHost = process.env.BUBBLE_TOWN_HERMES_HOST ?? '127.0.0.1';
const defaultGatewayPort = Number(process.env.BUBBLE_TOWN_HERMES_PORT ?? 8643);
const gatewayReadyRetries = Number(process.env.BUBBLE_TOWN_HERMES_READY_RETRIES ?? 40);
const gatewayReadyIntervalMs = Number(process.env.BUBBLE_TOWN_HERMES_READY_INTERVAL_MS ?? 250);
const gatewayStopTimeoutMs = Number(process.env.BUBBLE_TOWN_HERMES_STOP_TIMEOUT_MS ?? 5_000);
const maxLogLines = 80;
const generatedGatewayApiKey = randomBytes(32).toString('hex');

function getManagedGatewayApiKey(): string {
  return process.env.BUBBLE_TOWN_HERMES_API_KEY || generatedGatewayApiKey;
}

let gatewaySpawner: GatewaySpawner = ({ profileId, port }) => {
  const profileHome = getProfileHome(profileId);
  const apiKey = getManagedGatewayApiKey();
  const child = spawn(process.env.HERMES_BINARY ?? 'hermes', ['gateway', 'run', '--replace', '--accept-hooks'], {
    env: {
      ...process.env,
      HERMES_HOME: profileHome,
      API_SERVER_ENABLED: 'true',
      API_SERVER_HOST: defaultGatewayHost,
      API_SERVER_PORT: String(port),
      API_SERVER_KEY: apiKey,
      BUBBLE_TOWN_HERMES_API_KEY: apiKey,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    child,
    apiBaseUrl: `http://${defaultGatewayHost}:${port}/v1`,
    healthUrl: `http://${defaultGatewayHost}:${port}/health`,
    port,
  };
};

let gatewayHealthChecker: GatewayHealthChecker = async (healthUrl) => {
  try {
    const response = await fetch(healthUrl);
    return response.ok;
  } catch {
    return false;
  }
};

const managedGatewayState: {
  child?: HermesGatewayChildProcess;
  profileId?: string;
  apiBaseUrl?: string;
  healthUrl?: string;
  port?: number;
  logs: string[];
} = {
  logs: [],
};

let transitionQueue = Promise.resolve();

function getProfileHomeForGateway(profileId = DEFAULT_PROFILE_ID): string {
  return getProfileHome(profileId);
}

function appendGatewayLog(prefix: string, chunk: string): void {
  const lines = chunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    managedGatewayState.logs.push(`${prefix}${line}`);
  }

  if (managedGatewayState.logs.length > maxLogLines) {
    managedGatewayState.logs.splice(0, managedGatewayState.logs.length - maxLogLines);
  }
}

function attachGatewayLogs(child: HermesGatewayChildProcess): void {
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => appendGatewayLog('[stdout] ', chunk));
  child.stderr.on('data', (chunk: string) => appendGatewayLog('[stderr] ', chunk));
}

function trackGatewayExit(child: HermesGatewayChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.once('exit', (code) => {
      if (managedGatewayState.child === child) {
        managedGatewayState.child = undefined;
        managedGatewayState.apiBaseUrl = undefined;
        managedGatewayState.healthUrl = undefined;
        managedGatewayState.port = undefined;
      }
      resolve(code);
    });
  });
}

function buildGatewayFailureMessage(profileId: string, reason: string): string {
  const details = managedGatewayState.logs.slice(-10).join('\n');
  return details
    ? `Bubble Town 专用 Hermes 网关切到 profile "${profileId}" 失败：${reason}\n${details}`
    : `Bubble Town 专用 Hermes 网关切到 profile "${profileId}" 失败：${reason}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function reservePort(preferredPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryListen = (port: number) => {
      const server = net.createServer();
      server.unref();
      server.once('error', () => {
        server.close();
        if (port === 0) {
          reject(new Error('无法为 Bubble Town 专用 Hermes 网关分配端口。'));
          return;
        }
        tryListen(0);
      });
      server.listen(port, defaultGatewayHost, () => {
        const address = server.address();
        server.close(() => {
          if (!address || typeof address === 'string') {
            reject(new Error('无法获取 Bubble Town 专用 Hermes 网关端口。'));
            return;
          }
          resolve(address.port);
        });
      });
    };

    tryListen(preferredPort);
  });
}

async function waitForGatewayReady(profileId: string, child: HermesGatewayChildProcess, healthUrl: string): Promise<void> {
  for (let attempt = 0; attempt < gatewayReadyRetries; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(buildGatewayFailureMessage(profileId, `进程提前退出，退出码 ${child.exitCode}`));
    }

    if (await gatewayHealthChecker(healthUrl)) {
      return;
    }

    await sleep(gatewayReadyIntervalMs);
  }

  throw new Error(buildGatewayFailureMessage(profileId, `在 ${(gatewayReadyRetries * gatewayReadyIntervalMs) / 1000}s 内未就绪`));
}

async function stopGatewayProcess(child: HermesGatewayChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  const exited = trackGatewayExit(child);
  child.kill('SIGTERM');

  const timeout = sleep(gatewayStopTimeoutMs).then(() => 'timeout' as const);
  const result = await Promise.race([exited.then(() => 'exited' as const), timeout]);

  if (result === 'timeout' && child.exitCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

async function launchGateway(profileId: string): Promise<ManagedHermesGatewaySnapshot> {
  const profileHome = getProfileHomeForGateway(profileId);
  if (!fs.existsSync(profileHome)) {
    throw new Error(`目标 profile 不存在：${profileId}`);
  }

  managedGatewayState.logs = [];
  const port = await reservePort(defaultGatewayPort);
  const launched = gatewaySpawner({ profileId, port });
  attachGatewayLogs(launched.child);
  const exitPromise = trackGatewayExit(launched.child);

  managedGatewayState.child = launched.child;
  managedGatewayState.profileId = profileId;
  managedGatewayState.apiBaseUrl = launched.apiBaseUrl;
  managedGatewayState.healthUrl = launched.healthUrl;
  managedGatewayState.port = launched.port;

  try {
    await waitForGatewayReady(profileId, launched.child, launched.healthUrl);
  } catch (error) {
    await stopGatewayProcess(launched.child);
    await exitPromise.catch(() => undefined);
    throw error;
  }

  process.env.HERMES_API_BASE_URL = launched.apiBaseUrl;
  process.env.BUBBLE_TOWN_HERMES_PROFILE_ID = profileId;
  process.env.BUBBLE_TOWN_HERMES_API_KEY = getManagedGatewayApiKey();

  return getManagedHermesGatewaySnapshot();
}

function serializeTransition<T>(task: () => Promise<T>): Promise<T> {
  const next = transitionQueue.then(task, task);
  transitionQueue = next.then(() => undefined, () => undefined);
  return next;
}

export function getManagedHermesGatewaySnapshot(): ManagedHermesGatewaySnapshot {
  return {
    managed: true,
    running: Boolean(managedGatewayState.child && managedGatewayState.apiBaseUrl),
    profileId: managedGatewayState.profileId,
    apiBaseUrl: managedGatewayState.apiBaseUrl,
    healthUrl: managedGatewayState.healthUrl,
    port: managedGatewayState.port,
    pid: managedGatewayState.child?.pid,
    logs: [...managedGatewayState.logs],
  };
}

export async function isManagedHermesGatewayReachable(): Promise<boolean> {
  if (!managedGatewayState.healthUrl) {
    return false;
  }

  return gatewayHealthChecker(managedGatewayState.healthUrl);
}

export async function ensureManagedHermesGateway(profileId = DEFAULT_PROFILE_ID): Promise<ManagedHermesGatewaySnapshot> {
  return serializeTransition(async () => {
    const current = getManagedHermesGatewaySnapshot();
    const hasManagedApiKey = Boolean(process.env.BUBBLE_TOWN_HERMES_API_KEY);
    if (hasManagedApiKey && current.running && current.profileId === profileId && current.healthUrl && (await gatewayHealthChecker(current.healthUrl))) {
      process.env.HERMES_API_BASE_URL = current.apiBaseUrl;
      process.env.BUBBLE_TOWN_HERMES_PROFILE_ID = profileId;
      process.env.BUBBLE_TOWN_HERMES_API_KEY = getManagedGatewayApiKey();
      return current;
    }

    if (managedGatewayState.child) {
      await stopGatewayProcess(managedGatewayState.child);
    }

    return launchGateway(profileId);
  });
}

export async function restartManagedHermesGateway(profileId = DEFAULT_PROFILE_ID): Promise<ManagedHermesGatewaySnapshot> {
  return serializeTransition(async () => {
    if (managedGatewayState.child) {
      await stopGatewayProcess(managedGatewayState.child);
    }

    return launchGateway(profileId);
  });
}

export async function stopManagedHermesGateway(): Promise<void> {
  return serializeTransition(async () => {
    if (managedGatewayState.child) {
      await stopGatewayProcess(managedGatewayState.child);
    }

    managedGatewayState.child = undefined;
    managedGatewayState.apiBaseUrl = undefined;
    managedGatewayState.healthUrl = undefined;
    managedGatewayState.port = undefined;
    delete process.env.HERMES_API_BASE_URL;
    delete process.env.BUBBLE_TOWN_HERMES_PROFILE_ID;
    delete process.env.BUBBLE_TOWN_HERMES_API_KEY;
  });
}

export function isManagedHermesGatewayProfile(profileId = DEFAULT_PROFILE_ID): boolean {
  const snapshot = getManagedHermesGatewaySnapshot();
  return snapshot.running && snapshot.profileId === profileId;
}

export function setHermesGatewaySpawnerForTests(spawner: GatewaySpawner): void {
  gatewaySpawner = spawner;
}

export function resetHermesGatewaySpawnerForTests(): void {
  gatewaySpawner = ({ profileId, port }) => {
    const profileHome = getProfileHome(profileId);
    const child = spawn(process.env.HERMES_BINARY ?? 'hermes', ['gateway', 'run', '--replace', '--accept-hooks'], {
      env: {
        ...process.env,
        HERMES_HOME: profileHome,
        API_SERVER_ENABLED: 'true',
        API_SERVER_HOST: defaultGatewayHost,
        API_SERVER_PORT: String(port),
        API_SERVER_KEY: getManagedGatewayApiKey(),
        BUBBLE_TOWN_HERMES_API_KEY: getManagedGatewayApiKey(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return {
      child,
      apiBaseUrl: `http://${defaultGatewayHost}:${port}/v1`,
      healthUrl: `http://${defaultGatewayHost}:${port}/health`,
      port,
    };
  };
}

export function setHermesGatewayHealthCheckerForTests(checker: GatewayHealthChecker): void {
  gatewayHealthChecker = checker;
}

export function resetHermesGatewayHealthCheckerForTests(): void {
  gatewayHealthChecker = async (healthUrl) => {
    try {
      const response = await fetch(healthUrl);
      return response.ok;
    } catch {
      return false;
    }
  };
}

export function resetManagedHermesGatewayStateForTests(): void {
  managedGatewayState.child = undefined;
  managedGatewayState.profileId = undefined;
  managedGatewayState.apiBaseUrl = undefined;
  managedGatewayState.healthUrl = undefined;
  managedGatewayState.port = undefined;
  managedGatewayState.logs = [];
  delete process.env.HERMES_API_BASE_URL;
  delete process.env.BUBBLE_TOWN_HERMES_PROFILE_ID;
  delete process.env.BUBBLE_TOWN_HERMES_API_KEY;
}

export function setManagedHermesGatewayProfileForTests(profileId = DEFAULT_PROFILE_ID, apiBaseUrl = 'http://127.0.0.1:8643/v1'): void {
  managedGatewayState.child = { pid: 1, exitCode: null, killed: false } as unknown as HermesGatewayChildProcess;
  managedGatewayState.profileId = profileId;
  managedGatewayState.apiBaseUrl = apiBaseUrl;
  managedGatewayState.healthUrl = apiBaseUrl.replace(/\/v1$/, '/health');
  managedGatewayState.port = Number(new URL(apiBaseUrl).port || 80);
  process.env.HERMES_API_BASE_URL = apiBaseUrl;
  process.env.BUBBLE_TOWN_HERMES_PROFILE_ID = profileId;
  process.env.BUBBLE_TOWN_HERMES_API_KEY = getManagedGatewayApiKey();
}

export function getManagedHermesRootForTests(): string {
  return getHermesRoot();
}
