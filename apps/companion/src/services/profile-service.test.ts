import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetHermesProfileCommandRunnerForTests, setHermesProfileCommandRunnerForTests } from './profile-cli.js';
import { handlePrepareProfileForStoryline, handleSwitchProfile, getProfilesResponse } from './profile-service.js';

test('切换 profile 后返回激活项与会话概要', () => {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-hermes-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(hermesHome, 'profiles', 'research', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(hermesHome, 'active_profile'), 'default\n');
  fs.writeFileSync(path.join(hermesHome, 'profiles', 'research', 'sessions', 'session_test.json'), '{}\n');

  setHermesProfileCommandRunnerForTests((args: string[]) => {
    if (args[0] === 'use') {
      fs.writeFileSync(path.join(hermesHome, 'active_profile'), `${args[1]}\n`);
    }
  });

  const result = handleSwitchProfile({ profileId: 'research' });

  assert.equal(result.activeProfile?.id, 'research');
  assert.ok(result.sessions.every((session) => session.profileId === 'research'));

  resetHermesProfileCommandRunnerForTests();
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
});

test('切回 default profile 后返回 default 激活项', () => {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-hermes-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(hermesHome, 'profiles', 'sami', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(hermesHome, 'active_profile'), 'sami\n');

  setHermesProfileCommandRunnerForTests((args: string[]) => {
    if (args[0] === 'use') {
      fs.writeFileSync(path.join(hermesHome, 'active_profile'), `${args[1]}\n`);
    }
  });

  const result = handleSwitchProfile({ profileId: 'default' });

  assert.equal(result.activeProfile?.id, 'default');
  assert.ok(result.sessions.every((session) => session.profileId === 'default'));
  assert.equal(getProfilesResponse().activeProfileId, 'default');

  resetHermesProfileCommandRunnerForTests();
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
});

test('profiles 响应包含激活 profile', () => {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-hermes-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(hermesHome, 'profiles', 'sami', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(hermesHome, 'active_profile'), 'sami\n');

  const response = getProfilesResponse();

  assert.ok(response.activeProfileId);
  assert.ok(response.profiles.some((profile) => profile.id === response.activeProfileId));

  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
});

test('prepare profile for storyline 补齐 session_reset 和基础 SOUL', () => {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-hermes-'));
  process.env.HERMES_HOME = hermesHome;
  const profileHome = path.join(hermesHome, 'profiles', 'empty');
  fs.mkdirSync(profileHome, { recursive: true });
  fs.writeFileSync(path.join(profileHome, 'config.yaml'), 'model:\n  default: test-model\nsession_reset:\n  mode: daily\n', 'utf8');

  const result = handlePrepareProfileForStoryline('empty');

  assert.equal(result.profileId, 'empty');
  assert.ok(result.changes.some((change) => change.includes('session_reset.mode')));
  assert.ok(result.changes.some((change) => change.includes('SOUL.md')));
  assert.match(fs.readFileSync(path.join(profileHome, 'config.yaml'), 'utf8'), /mode: none/);
  assert.match(fs.readFileSync(path.join(profileHome, 'SOUL.md'), 'utf8'), /Bubble Town runtime contract/);
  assert.equal(fs.existsSync(path.join(profileHome, 'sessions')), true);

  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
});

test('prepare profile for storyline 接受未规范化的 profile id', () => {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-hermes-'));
  process.env.HERMES_HOME = hermesHome;
  const profileHome = path.join(hermesHome, 'profiles', 'lumi');
  fs.mkdirSync(profileHome, { recursive: true });

  const result = handlePrepareProfileForStoryline('Lumi');

  assert.equal(result.profileId, 'lumi');
  assert.equal(fs.existsSync(path.join(profileHome, 'sessions')), true);
  assert.equal(fs.existsSync(path.join(profileHome, 'SOUL.md')), true);

  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
});
