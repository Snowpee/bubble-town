import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateProfileContinuity } from './profile-continuity.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-profile-continuity-'));
  process.env.HERMES_HOME = hermesHome;
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('validateProfileContinuity 校验 session_reset.mode 为 none', () => {
  const hermesHome = createHermesHome();

  try {
    fs.writeFileSync(path.join(hermesHome, 'config.yaml'), 'session_reset:\n  mode: none\n', 'utf8');

    const result = validateProfileContinuity('default');

    assert.equal(result.exists, true);
    assert.equal(result.sessionResetMode, 'none');
    assert.equal(result.sessionResetModeValid, true);
    assert.deepEqual(result.warnings, []);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('validateProfileContinuity 对非 none 配置给出诊断', () => {
  const hermesHome = createHermesHome();

  try {
    fs.writeFileSync(path.join(hermesHome, 'config.yaml'), 'session_reset:\n  mode: daily\n', 'utf8');

    const result = validateProfileContinuity('default');

    assert.equal(result.sessionResetModeValid, false);
    assert.match(result.warnings.join('\n'), /daily/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});
