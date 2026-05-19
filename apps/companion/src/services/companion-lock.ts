import fs from 'node:fs';
import path from 'node:path';
import { getHermesRoot } from './hermes-paths.js';

interface CompanionLock {
  pid: number;
  startedAt: string;
  port: number;
  host: string;
}

function getCompanionLockPath(): string {
  return path.join(getHermesRoot(), 'bubble-town-companion.lock.json');
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readExistingLock(): CompanionLock | undefined {
  const lockPath = getCompanionLockPath();
  if (!fs.existsSync(lockPath)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8')) as CompanionLock;
  } catch {
    return undefined;
  }
}

export function acquireCompanionLock(port: number, host: string): void {
  const lockPath = getCompanionLockPath();
  const existing = readExistingLock();

  if (existing?.pid && existing.pid !== process.pid && isProcessAlive(existing.pid)) {
    throw new Error(
      `Bubble Town companion 已在运行：pid=${existing.pid}, host=${existing.host}, port=${existing.port}。请先停止旧的 npm run dev/backend 进程再启动。`,
    );
  }

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(
    lockPath,
    `${JSON.stringify(
      {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        port,
        host,
      } satisfies CompanionLock,
      null,
      2,
    )}\n`,
    'utf8',
  );
}

export function releaseCompanionLock(): void {
  const lockPath = getCompanionLockPath();
  const existing = readExistingLock();

  if (!existing || existing.pid !== process.pid) {
    return;
  }

  fs.unlinkSync(lockPath);
}

export function getCompanionLockSnapshot(): CompanionLock | undefined {
  return readExistingLock();
}
