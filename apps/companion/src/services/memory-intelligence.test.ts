import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildContextPack, renderContextPackInstructions } from './context-pack.js';
import { extractRuleBasedMemoryCandidates } from './memory-candidates.js';
import { recordStorylineTurnContinuity } from './story-memory-continuity.js';
import {
  createCharacter,
  createMemoryRecord,
  createStoryline,
  createSuppressedMemory,
  listAllMemoryRecords,
  listAllSuppressedMemories,
  resetStoryRuntimeForTests,
} from './story-runtime-store.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-memory-intelligence-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  resetStoryRuntimeForTests();
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('规则 extractor 生成结构化 MemoryCandidate', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });

    const candidates = extractRuleBasedMemoryCandidates({
      storyline,
      userInput: '我更希望你以后直接一点说重点。',
      sourceMessageIds: ['session-1', 'resp-1'],
    });

    assert.equal(candidates[0]?.kind, 'commitment');
    assert.equal(candidates[1]?.kind, 'preference');
    assert.equal(candidates[0]?.lifespan, 'long_term');
    assert.equal(candidates[0]?.shouldPersist, true);
    assert.match(candidates[0]?.reason ?? '', /长期延续/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('自动记忆写入携带 kind、lifespan 和 reason，并跳过临时玩笑', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });

    recordStorylineTurnContinuity({
      storyline,
      userInput: '我喜欢晚饭后散步。',
      assistantOutput: '我记住啦。',
      sourceMessageIds: ['session-1', 'resp-1'],
    });
    recordStorylineTurnContinuity({
      storyline,
      userInput: '我只是现在开玩笑说我讨厌散步。',
      assistantOutput: '知道，只是玩笑。',
      sourceMessageIds: ['session-1', 'resp-2'],
    });

    const memories = listAllMemoryRecords(storyline.id);
    assert.equal(memories.length, 1);
    assert.equal(memories[0]?.kind, 'preference');
    assert.equal(memories[0]?.lifespan, 'long_term');
    assert.match(memories[0]?.reason ?? '', /偏好/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('用户要求不要提某话题时只写入 suppression，不写成普通长期记忆', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });

    recordStorylineTurnContinuity({
      storyline,
      userInput: '不要主动再提起上次整理 Skill 的事情',
      assistantOutput: '好的，记住了。',
      sourceMessageIds: ['session-1', 'resp-1'],
    });

    assert.deepEqual(listAllMemoryRecords(storyline.id), []);
    assert.deepEqual(
      listAllSuppressedMemories(storyline.id).map((memory) => memory.pattern),
      ['不要主动再提起上次整理 Skill 的事情'],
    );
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('ContextPack 按当前输入预算化注入相关记忆', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });
    createMemoryRecord(storyline.id, {
      content: '用户喜欢晚饭后散步。',
      kind: 'preference',
      importance: 0.75,
      confidence: 0.72,
    });
    createMemoryRecord(storyline.id, {
      content: '用户喜欢手冲咖啡。',
      kind: 'preference',
      importance: 0.75,
      confidence: 0.72,
    });

    const contextPack = buildContextPack(storyline.id, { input: '我们等下去散步吧。' });
    const rendered = renderContextPackInstructions(contextPack);

    assert.deepEqual(contextPack.memories.map((memory) => memory.content), ['用户喜欢晚饭后散步。']);
    assert.equal(contextPack.memoryRetrievals?.length, 1);
    assert.match(rendered, /用户喜欢晚饭后散步/);
    assert.doesNotMatch(rendered, /手冲咖啡/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('ContextPack 使用 semantic score 召回不同表达的相关记忆', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });
    createMemoryRecord(storyline.id, {
      content: '用户喜欢晚饭后散步。',
      kind: 'preference',
      importance: 0.75,
      confidence: 0.72,
    });
    createMemoryRecord(storyline.id, {
      content: '用户喜欢手冲咖啡。',
      kind: 'preference',
      importance: 0.75,
      confidence: 0.72,
    });

    const contextPack = buildContextPack(storyline.id, { input: '我们等下出去走走吧。' });

    assert.equal(contextPack.memories[0]?.content, '用户喜欢晚饭后散步。');
    assert.ok((contextPack.memoryRetrievals?.[0]?.semantic ?? 0) > 0);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('ContextPack 在用户未主动询问时不注入命中抑制规则的记忆', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });
    createMemoryRecord(storyline.id, {
      content: '昨晚争吵后用户希望先冷静。',
      kind: 'relationship',
      importance: 0.8,
      confidence: 0.7,
    });
    createSuppressedMemory(storyline.id, { pattern: '不要主动提昨晚争吵。' });

    const contextPack = buildContextPack(storyline.id, { input: '昨晚争吵之后怎么办？' });
    const rendered = renderContextPackInstructions(contextPack);

    assert.equal(contextPack.memories.length, 0);
    assert.doesNotMatch(rendered, /昨晚争吵后用户希望先冷静/);
    assert.doesNotMatch(rendered, /不要主动提昨晚争吵/);
    assert.match(rendered, /suppressed_topic_1/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});
