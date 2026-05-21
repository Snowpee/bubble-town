import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildContextPack, buildTimeContext, renderContextPackInstructions } from './context-pack.js';
import {
  createActivityLog,
  createCharacter,
  createMemoryRecord,
  createStoryline,
  createSuppressedMemory,
  resetStoryRuntimeForTests,
  updateActivityLog,
  updateMemoryRecord,
} from './story-runtime-store.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-context-pack-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  resetStoryRuntimeForTests();
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('TimeContext 生成相对时间范围和 elapsedSinceLastInteraction', () => {
  const time = buildTimeContext(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), 'UTC');

  assert.equal(time.timezone, 'UTC');
  assert.equal(time.today.length, 2);
  assert.equal(time.yesterday.length, 2);
  assert.match(time.elapsedSinceLastInteraction ?? '', /小时|分钟/);
});

test('ContextPack 只包含当前 Storyline 基础信息并可渲染 instructions', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });
    const contextPack = buildContextPack(storyline.id);
    const rendered = renderContextPackInstructions(contextPack);

    assert.equal(contextPack.storylineId, storyline.id);
    assert.equal(contextPack.characterId, character.id);
    assert.equal(contextPack.hermesProfileId, storyline.hermesProfileId);
    assert.equal(contextPack.memories.length, 0);
    assert.match(rendered, /BubbleTownContextPack/);
    assert.match(rendered, new RegExp(storyline.id));
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('ContextPack 注入当前 Storyline active 记忆、活动日志和抑制规则，并过滤隐藏项', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });
    createMemoryRecord(storyline.id, { content: '用户喜欢晚饭后散步。' });
    const hiddenMemory = createMemoryRecord(storyline.id, { content: '不应该注入的隐藏记忆。' });
    updateMemoryRecord(hiddenMemory.id, { status: 'hidden' });
    createSuppressedMemory(storyline.id, { pattern: '不要主动提昨晚争吵。' });
    createActivityLog(storyline.id, { summary: '用户和 Sami 晚饭后短暂聊天。', tags: ['daily'] });
    const hiddenActivity = createActivityLog(storyline.id, { summary: '不应该注入的隐藏活动。' });
    updateActivityLog(hiddenActivity.id, { status: 'hidden' });

    const contextPack = buildContextPack(storyline.id);
    const rendered = renderContextPackInstructions(contextPack);

    assert.deepEqual(contextPack.memories.map((memory) => memory.content), ['用户喜欢晚饭后散步。']);
    assert.deepEqual(contextPack.suppressedMemories.map((memory) => memory.pattern), ['不要主动提昨晚争吵。']);
    assert.deepEqual(contextPack.activityLogs.map((activity) => activity.summary), ['用户和 Sami 晚饭后短暂聊天。']);
    assert.match(rendered, /用户喜欢晚饭后散步/);
    assert.doesNotMatch(rendered, /隐藏记忆/);
    assert.doesNotMatch(rendered, /隐藏活动/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});
