import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetHermesProfileCommandRunnerForTests, setHermesProfileCommandRunnerForTests } from './profile-cli.js';
import {
  resetHermesGatewayHealthCheckerForTests,
  resetHermesGatewaySpawnerForTests,
  resetManagedHermesGatewayStateForTests,
  setHermesGatewayHealthCheckerForTests,
  setHermesGatewaySpawnerForTests,
} from '../adapters/hermes/hermes-gateway.js';
import { ensureMemoryEmbedding, removeEmbeddingsForStorylines, resetMemoryEmbeddingsForTests } from '../features/memory/memory-embeddings.js';
import { handlePrepareProfileForStoryline, handleResetProfileForStoryline, handleSwitchProfile, getProfilesResponse } from './profile-service.js';
import {
  createActivityLog,
  createCharacter,
  createMemoryRecord,
  createStoryline,
  createSuppressedMemory,
  getActiveStoryline,
  listAllActivityLogs,
  listAllMemoryRecords,
  listAllSuppressedMemories,
  listStorylines,
  resetProfileRuntimeState,
  resetStoryRuntimeForTests,
  upsertRuntimeSession,
} from '../store/story-runtime-store.js';

function cleanupTestState(hermesHome: string) {
  resetHermesProfileCommandRunnerForTests();
  resetHermesGatewaySpawnerForTests();
  resetHermesGatewayHealthCheckerForTests();
  resetManagedHermesGatewayStateForTests();
  resetStoryRuntimeForTests();
  resetMemoryEmbeddingsForTests();
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

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

test('reset profile for storyline 会清理 runtime 数据和 Hermes 目录，并恢复项目要求的初始状态', async () => {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-hermes-'));
  process.env.HERMES_HOME = hermesHome;
  const profileHome = path.join(hermesHome, 'profiles', 'sami');
  fs.mkdirSync(path.join(profileHome, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(profileHome, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(profileHome, 'config.yaml'), 'model:\n  default: test-model\nsession_reset:\n  mode: daily\n', 'utf8');
  fs.writeFileSync(path.join(profileHome, 'SOUL.md'), '# custom soul\n', 'utf8');
  fs.writeFileSync(path.join(profileHome, 'state.db'), 'state', 'utf8');
  fs.writeFileSync(path.join(profileHome, 'response_store.db'), 'responses', 'utf8');
  fs.writeFileSync(path.join(profileHome, 'sessions', 'session_test.json'), '{}\n', 'utf8');
  fs.writeFileSync(path.join(profileHome, 'logs', 'agent.log'), 'log\n', 'utf8');

  setHermesGatewaySpawnerForTests(({ profileId: _profileId, port }) => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const child = {
      pid: 12345,
      exitCode: null as number | null,
      killed: false,
      stdout,
      stderr,
      once(event: string, listener: (...args: unknown[]) => void) {
        const current = listeners.get(event) ?? [];
        listeners.set(event, [...current, listener]);
        return this;
      },
      on(event: string, listener: (...args: unknown[]) => void) {
        return this.once(event, listener);
      },
      kill() {
        child.killed = true;
        child.exitCode = 0;
        for (const listener of listeners.get('exit') ?? []) {
          listener(0);
        }
        return true;
      },
    };

    return {
      child: child as unknown as import('node:child_process').ChildProcessByStdio<null, PassThrough, PassThrough>,
      apiBaseUrl: `http://127.0.0.1:${port}/v1`,
      healthUrl: `http://127.0.0.1:${port}/health`,
      port,
    };
  });
  setHermesGatewayHealthCheckerForTests(async () => true);

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami',
      title: 'Sami 当前 Timeline',
    });
    const memory = createMemoryRecord(storyline.id, {
      content: '手机当前状态为 lost。',
      source: 'auto_extract',
      kind: 'world_object_state',
      worldState: {
        sceneId: 'default_scene',
        objectId: 'obj_phone',
        objectLabel: '手机',
        stateKind: 'status',
        state: 'lost',
        version: 1,
      },
    });
    createSuppressedMemory(storyline.id, {
      pattern: '不要提手机',
      reason: '测试',
    });
    createActivityLog(storyline.id, {
      summary: '用户提到手机丢了。',
      tags: ['conversation'],
    });
    upsertRuntimeSession({
      storylineId: storyline.id,
      hermesProfileId: 'sami',
      hermesSessionId: 'native-session-1',
      previousResponseId: 'resp_1',
      reason: 'continue',
    });
    ensureMemoryEmbedding(memory);

    const result = await handleResetProfileForStoryline('sami', 'sami');

    assert.equal(result.profileId, 'sami');
    assert.equal(result.runtimeReset.removedStorylineCount, 1);
    assert.equal(result.runtimeReset.removedMemoryCount, 1);
    assert.equal(result.runtimeReset.removedSuppressedMemoryCount, 1);
    assert.equal(result.runtimeReset.removedActivityLogCount, 1);
    assert.equal(result.runtimeReset.removedRuntimeSessionCount, 1);
    assert.equal(result.runtimeReset.removedCharacterCount, 1);
    assert.equal(result.runtimeReset.removedEmbeddingCount, 1);
    assert.deepEqual(listStorylines().filter((item) => item.hermesProfileId === 'sami'), []);
    assert.deepEqual(listAllMemoryRecords(storyline.id), []);
    assert.deepEqual(listAllSuppressedMemories(storyline.id), []);
    assert.deepEqual(listAllActivityLogs(storyline.id), []);
    assert.equal(getActiveStoryline(), undefined);
    assert.equal(fs.existsSync(path.join(profileHome, 'state.db')), false);
    assert.equal(fs.existsSync(path.join(profileHome, 'response_store.db')), false);
    assert.equal(fs.existsSync(path.join(profileHome, 'logs')), false);
    assert.equal(fs.existsSync(path.join(profileHome, 'sessions')), true);
    assert.deepEqual(fs.readdirSync(path.join(profileHome, 'sessions')), []);
    assert.match(fs.readFileSync(path.join(profileHome, 'config.yaml'), 'utf8'), /mode: none/);
    assert.match(fs.readFileSync(path.join(profileHome, 'SOUL.md'), 'utf8'), /Bubble Town runtime contract/);
    assert.match(fs.readFileSync(path.join(profileHome, 'SOUL.md'), 'utf8'), /拟人化的本地陪伴助手/);
    assert.equal(removeEmbeddingsForStorylines(result.runtimeReset.storylineIds), 0);
    assert.deepEqual(resetProfileRuntimeState('sami'), {
      storylineIds: [],
      removedStorylineCount: 0,
      removedRuntimeSessionCount: 0,
      removedMemoryCount: 0,
      removedSuppressedMemoryCount: 0,
      removedActivityLogCount: 0,
      removedCharacterCount: 0,
    });
  } finally {
    cleanupTestState(hermesHome);
  }
});
