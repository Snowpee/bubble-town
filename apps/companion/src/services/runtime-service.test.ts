import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createActivityLog,
  createCharacter,
  createMemoryRecord,
  createStoryline,
  createSuppressedMemory,
  resetStoryRuntimeForTests,
  upsertRuntimeSession,
} from '../store/story-runtime-store.js';
import {
  getActiveStorylineFromRuntime,
  getActiveStorylineIdFromRuntime,
  getStorylineRuntimeContext,
  listStorylinesFromRuntime,
} from './runtime-service.js';
import { getStoryRuntimeStorePath } from '../runtime/story-runtime-repository.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-runtime-service-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  resetStoryRuntimeForTests();
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('RuntimeService 提供按 storyline 聚合的统一读模型', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Lumi', templateProfileId: 'lumi-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'lumi-story-001',
      title: '新剧情',
    });

    createMemoryRecord(storyline.id, {
      content: '用户喜欢半夜聊天。',
      scope: 'story',
      source: 'manual',
      kind: 'preference',
    });
    createMemoryRecord(storyline.id, {
      content: '钥匙现在放在门口柜里。',
      scope: 'story',
      source: 'auto_extract',
      kind: 'world_object_state',
      worldState: {
        sceneId: 'default_scene',
        objectId: 'obj_key_1',
        objectLabel: '钥匙',
        stateKind: 'location',
        state: 'located',
        locationText: '门口柜里',
        version: 1,
      },
    });
    createSuppressedMemory(storyline.id, {
      pattern: '不要主动提起昨天半夜哭过',
    });
    createActivityLog(storyline.id, {
      summary: '用户提到今晚在找钥匙。',
      tags: ['story'],
    });
    upsertRuntimeSession({
      storylineId: storyline.id,
      hermesProfileId: storyline.hermesProfileId,
      hermesSessionId: 'session-1',
      previousResponseId: 'resp-1',
      reason: 'continue',
    });

    const context = getStorylineRuntimeContext(storyline.id);

    assert.ok(context);
    assert.equal(context.storyline.id, storyline.id);
    assert.equal(context.character.id, character.id);
    assert.equal(context.runtimeSession?.hermesSessionId, 'session-1');
    assert.equal(context.activeMemories.length, 2);
    assert.equal(context.suppressedMemories.length, 1);
    assert.equal(context.activityLogs.length, 1);
    assert.equal(context.sceneProjection?.items.length, 1);
    assert.match(context.sceneProjection?.summary ?? '', /钥匙现在放在门口柜里/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('RuntimeService 可提供 active storyline 和 storylines 列表读取入口', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Lumi', templateProfileId: 'lumi-template' });
    const first = createStoryline({
      characterId: character.id,
      hermesProfileId: 'lumi-story-001',
      title: '第一章',
    });
    const second = createStoryline({
      characterId: character.id,
      hermesProfileId: 'lumi-story-002',
      title: '第二章',
    });

    assert.equal(getActiveStorylineIdFromRuntime(), second.id);
    assert.equal(getActiveStorylineFromRuntime()?.id, second.id);
    assert.deepEqual(
      new Set(listStorylinesFromRuntime().map((storyline) => storyline.id)),
      new Set([first.id, second.id]),
    );
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('RuntimeService 兼容旧 bubble-town-runtime.json 缺失部分数组字段的情况', () => {
  const hermesHome = createHermesHome();

  try {
    const now = new Date().toISOString();
    fs.writeFileSync(
      getStoryRuntimeStorePath(),
      `${JSON.stringify({
        version: 1,
        activeStorylineId: 'story_legacy_1',
        characters: [
          {
            id: 'char_legacy_1',
            name: 'Lumi',
            templateProfileId: 'lumi-template',
            createdAt: now,
            updatedAt: now,
          },
        ],
        storylines: [
          {
            id: 'story_legacy_1',
            characterId: 'char_legacy_1',
            hermesProfileId: 'legacy-profile',
            title: 'Legacy Story',
            createdAt: now,
            updatedAt: now,
            status: 'active',
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    const context = getStorylineRuntimeContext('story_legacy_1');

    assert.ok(context);
    assert.equal(context.storyline.id, 'story_legacy_1');
    assert.equal(context.character.id, 'char_legacy_1');
    assert.equal(context.activeMemories.length, 0);
    assert.equal(context.suppressedMemories.length, 0);
    assert.equal(context.activityLogs.length, 0);
    assert.equal(context.sceneProjection, undefined);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});
