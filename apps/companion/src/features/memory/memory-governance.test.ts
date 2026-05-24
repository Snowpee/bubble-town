import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildContextPack } from '../story/context-pack.js';
import { consolidateStorylineMemory, correctMemory } from './memory-governance.js';
import {
  createActivityLog,
  createCharacter,
  createMemoryRecord,
  createStoryline,
  listAllActivityLogs,
  listAllMemoryRecords,
  resetStoryRuntimeForTests,
  updateMemoryRecord,
} from '../../store/story-runtime-store.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-memory-governance-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  resetStoryRuntimeForTests();
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

function createTestStoryline() {
  const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
  return createStoryline({
    characterId: character.id,
    hermesProfileId: `sami-${crypto.randomUUID()}`,
    title: '治理测试',
  });
}

test('memory governance 将 ActivityLog 巩固为 summary memory 并保留来源引用', () => {
  const hermesHome = createHermesHome();

  try {
    const storyline = createTestStoryline();
    const logs = [
      createActivityLog(storyline.id, { summary: '凌晨检查了下载记录。', tags: ['test'] }),
      createActivityLog(storyline.id, { summary: '看了 Seedance 页面截图。', tags: ['test'] }),
      createActivityLog(storyline.id, { summary: '确认了比价内容。', tags: ['test'] }),
    ];

    const result = consolidateStorylineMemory({ storylineId: storyline.id });
    const allLogs = listAllActivityLogs(storyline.id);

    assert.equal(result.summaryMemory?.source, 'summary');
    assert.equal(result.summaryMemory?.scope, 'activity');
    assert.deepEqual(result.summaryMemory?.sourceActivityIds?.sort(), logs.map((entry) => entry.id).sort());
    assert.ok(allLogs.every((entry) => entry.tags.includes('consolidated')));
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('memory governance 合并重复记忆并保留 supersede 审计链', () => {
  const hermesHome = createHermesHome();

  try {
    const storyline = createTestStoryline();
    const first = createMemoryRecord(storyline.id, {
      content: '用户喜欢晚饭后散步。',
      kind: 'preference',
      importance: 0.7,
      confidence: 0.7,
    });
    const second = createMemoryRecord(storyline.id, {
      content: '用户喜欢晚饭后散步。',
      kind: 'preference',
      importance: 0.8,
      confidence: 0.8,
    });

    const result = consolidateStorylineMemory({ storylineId: storyline.id });
    const memories = listAllMemoryRecords(storyline.id);
    const active = memories.filter((memory) => memory.status === 'active');
    const hidden = memories.filter((memory) => memory.status === 'hidden');

    assert.equal(result.duplicateKeepers.length, 1);
    assert.equal(result.hiddenDuplicates.length, 1);
    assert.equal(active.length, 1);
    assert.equal(hidden.length, 1);
    assert.deepEqual(active[0]?.supersedes, [hidden[0]?.id]);
    assert.equal(hidden[0]?.supersededBy, active[0]?.id);
    assert.ok([first.id, second.id].includes(active[0]!.id));
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('memory governance 用户纠正旧记忆后旧记录不再进入 ContextPack', () => {
  const hermesHome = createHermesHome();

  try {
    const storyline = createTestStoryline();
    const oldMemory = createMemoryRecord(storyline.id, {
      content: '用户喜欢手冲咖啡。',
      kind: 'preference',
      importance: 0.7,
      confidence: 0.7,
    });

    const correction = correctMemory({
      memoryId: oldMemory.id,
      content: '用户现在更喜欢茶。',
      reason: '用户明确纠正旧偏好。',
    });
    const contextPack = buildContextPack(storyline.id, { input: '我现在喜欢喝什么？' });

    assert.equal(correction.replacement.supersedes?.[0], oldMemory.id);
    assert.equal(correction.superseded.status, 'hidden');
    assert.equal(correction.superseded.supersededBy, correction.replacement.id);
    assert.deepEqual(contextPack.memories.map((memory) => memory.content), ['用户现在更喜欢茶。']);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('ContextPack 过滤过期记忆并更新访问统计', () => {
  const hermesHome = createHermesHome();

  try {
    const storyline = createTestStoryline();
    const expired = createMemoryRecord(storyline.id, {
      content: '用户短期喜欢薄荷糖。',
      kind: 'preference',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const active = createMemoryRecord(storyline.id, {
      content: '用户喜欢晚饭后散步。',
      kind: 'preference',
      importance: 0.8,
      confidence: 0.8,
    });

    const contextPack = buildContextPack(storyline.id, { input: '等下出去走走吧。' });
    const memories = listAllMemoryRecords(storyline.id);
    const updatedExpired = memories.find((memory) => memory.id === expired.id);
    const updatedActive = memories.find((memory) => memory.id === active.id);

    assert.deepEqual(contextPack.memories.map((memory) => memory.content), ['用户喜欢晚饭后散步。']);
    assert.equal(updatedExpired?.accessCount, undefined);
    assert.equal(updatedActive?.accessCount, 1);
    assert.match(updatedActive?.lastAccessedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);

    updateMemoryRecord(active.id, { supersededBy: 'mem_replacement' });
    const secondContextPack = buildContextPack(storyline.id, { input: '等下出去走走吧。' });
    assert.deepEqual(secondContextPack.memories, []);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});
