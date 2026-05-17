import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessByStdio } from 'node:child_process';
import {
  ensureManagedHermesGateway,
  getManagedHermesGatewaySnapshot,
  resetHermesGatewayHealthCheckerForTests,
  resetHermesGatewaySpawnerForTests,
  resetManagedHermesGatewayStateForTests,
  restartManagedHermesGateway,
  setHermesGatewayHealthCheckerForTests,
  setHermesGatewaySpawnerForTests,
  stopManagedHermesGateway,
} from './hermes-gateway.js';

type HermesGatewayChildProcess = ChildProcessByStdio<null, PassThrough, PassThrough>;

class FakeChildProcess extends EventEmitter {
  pid = Math.floor(Math.random() * 10_000) + 1;
  exitCode: number | null = null;
  killed = false;
  stdout = new PassThrough();
  stderr = new PassThrough();

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.exitCode = signal === 'SIGKILL' ? 137 : 0;
    this.emit('exit', this.exitCode);
    return true;
  }
}

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-hermes-gateway-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(hermesHome, 'profiles', 'sami', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(hermesHome, 'active_profile'), 'default\n');
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('ensureManagedHermesGateway 会为目标 profile 启动 Bubble Town 专用 Hermes 网关', async () => {
  const hermesHome = createHermesHome();
  const startedProfiles: string[] = [];
  const fakeChild = new FakeChildProcess();

  setHermesGatewaySpawnerForTests(({ profileId, port }) => {
    startedProfiles.push(profileId);
    return {
      child: fakeChild as unknown as HermesGatewayChildProcess,
      apiBaseUrl: `http://127.0.0.1:${port}/v1`,
      healthUrl: `http://127.0.0.1:${port}/health`,
      port,
    };
  });
  setHermesGatewayHealthCheckerForTests(async () => true);

  try {
    const snapshot = await ensureManagedHermesGateway('sami');

    assert.equal(startedProfiles[0], 'sami');
    assert.equal(snapshot.running, true);
    assert.equal(snapshot.profileId, 'sami');
    assert.equal(process.env.BUBBLE_TOWN_HERMES_PROFILE_ID, 'sami');
    assert.match(process.env.HERMES_API_BASE_URL ?? '', /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    assert.ok(process.env.BUBBLE_TOWN_HERMES_API_KEY);
  } finally {
    await stopManagedHermesGateway();
    resetManagedHermesGatewayStateForTests();
    resetHermesGatewaySpawnerForTests();
    resetHermesGatewayHealthCheckerForTests();
    cleanupHermesHome(hermesHome);
  }
});

test('restartManagedHermesGateway 切换 profile 时会停止之前的 Bubble Town 专用 Hermes 网关', async () => {
  const hermesHome = createHermesHome();
  const spawnedChildren: FakeChildProcess[] = [];

  setHermesGatewaySpawnerForTests(({ profileId: _profileId, port }) => {
    const child = new FakeChildProcess();
    spawnedChildren.push(child);
    return {
      child: child as unknown as HermesGatewayChildProcess,
      apiBaseUrl: `http://127.0.0.1:${port}/v1`,
      healthUrl: `http://127.0.0.1:${port}/health`,
      port,
    };
  });
  setHermesGatewayHealthCheckerForTests(async () => true);

  try {
    await ensureManagedHermesGateway('default');
    await restartManagedHermesGateway('sami');

    assert.equal(spawnedChildren.length, 2);
    assert.equal(spawnedChildren[0]?.killed, true);
    const snapshot = getManagedHermesGatewaySnapshot();
    assert.equal(snapshot.profileId, 'sami');
    assert.equal(snapshot.running, true);
  } finally {
    await stopManagedHermesGateway();
    resetManagedHermesGatewayStateForTests();
    resetHermesGatewaySpawnerForTests();
    resetHermesGatewayHealthCheckerForTests();
    cleanupHermesHome(hermesHome);
  }
});
