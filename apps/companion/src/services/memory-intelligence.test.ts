import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildContextPack, renderContextPackInstructions } from './context-pack.js';
import { extractRuleBasedMemoryCandidates } from './memory-candidates.js';
import { recordStorylineTurnContinuity, waitForPendingWorldStateJobsForTests } from './story-memory-continuity.js';
import type { WorldStateCandidateExtractor } from './world-state-extractor.js';
import type { WorldStateSideChannelGate } from './world-state-side-channel.js';
import {
  createCharacter,
  createMemoryRecord,
  createStoryline,
  createSuppressedMemory,
  listAllMemoryRecords,
  listAllSuppressedMemories,
  resetStoryRuntimeForTests,
} from './story-runtime-store.js';
import { createWorldStateUpdateCandidate, getStorylineSceneId } from './world-state.js';

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

test('自动记忆写入携带 kind、lifespan 和 reason，并跳过临时玩笑', async () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });

    await recordStorylineTurnContinuity({
      storyline,
      userInput: '我喜欢晚饭后散步。',
      assistantOutput: '我记住啦。',
      sourceMessageIds: ['session-1', 'resp-1'],
    });
    await recordStorylineTurnContinuity({
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

test('用户要求不要提某话题时只写入 suppression，不写成普通长期记忆', async () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });

    await recordStorylineTurnContinuity({
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

test('连续性记录不会把“如果砸碎台灯”写成当前 world state', async () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
      currentSceneId: 'north_window_room',
    });

    await recordStorylineTurnContinuity({
      storyline,
      userInput: '如果我把旧台灯砸碎会怎样？',
      assistantOutput: '我会先担心你会不会受伤。',
      sourceMessageIds: ['session-1', 'resp-1'],
    });

    assert.equal(
      listAllMemoryRecords(storyline.id).some((memory) => memory.kind === 'world_object_state'),
      false,
    );
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('连续性记录可写入物体位置状态，并在 Scene Projection 中保留当前位置', async () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
      currentSceneId: 'apartment_entry',
    });
    const worldStateGate: WorldStateSideChannelGate = {
      async decide(input) {
        const candidate = createWorldStateUpdateCandidate({
          sceneId: getStorylineSceneId(input.storyline),
          objectLabel: '家门钥匙',
          stateKind: 'location',
          state: 'located',
          locationText: '玄关柜第二层抽屉里',
          actionType: 'place',
          sourceSpan: '把家门钥匙放在玄关柜第二层抽屉里了',
          isCurrentStableState: true,
          reason: '主模型 side-channel 已经明确说明了物体当前位置。',
          confidence: 0.93,
          sourceMessageIds: input.sourceMessageIds,
          sourceActivityIds: input.sourceActivityIds,
        });
        return {
          decision: 'direct_apply',
          reason: '当前 turn 明确描述了钥匙的新位置。',
          confidence: 0.93,
          candidates: candidate ? [candidate] : [],
        };
      },
    };

    await recordStorylineTurnContinuity({
      storyline,
      userInput: '我把家门钥匙放在玄关柜第二层抽屉里了。',
      assistantOutput: '好，我记住钥匙现在在玄关柜第二层抽屉里。',
      sourceMessageIds: ['session-1', 'resp-1'],
      worldStateGate,
    });

    const contextPack = buildContextPack(storyline.id, { input: '钥匙现在放在哪里？' });
    const rendered = renderContextPackInstructions(contextPack);

    assert.match(contextPack.sceneProjection?.summary ?? '', /玄关柜第二层抽屉/);
    assert.match(rendered, /家门钥匙现在放在玄关柜第二层抽屉里/);
    assert.equal(
      listAllMemoryRecords(storyline.id).some((memory) => memory.kind === 'world_object_state'),
      true,
    );
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('连续性记录在 uncertain 时异步触发 fallback extractor，并且不阻塞当前返回', async () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
      currentSceneId: 'community_hall',
    });
    let extractorInvoked = false;
    const worldStateGate: WorldStateSideChannelGate = {
      async decide() {
        return {
          decision: 'uncertain',
          reason: '当前 turn 提到了可能的世界状态变化，但仍需要 fallback extractor 补全。',
          confidence: 0.58,
          candidates: [],
        };
      },
    };
    const worldStateExtractor: WorldStateCandidateExtractor = {
      async extract(input) {
        extractorInvoked = true;
        const candidate = createWorldStateUpdateCandidate({
          sceneId: getStorylineSceneId(input.storyline),
          objectLabel: '手机',
          stateKind: 'location',
          state: 'located',
          locationText: '垃圾站洗手台',
          actionType: 'place',
          sourceSpan: '手机好像放在垃圾站洗手台了',
          isCurrentStableState: true,
          reason: 'fallback extractor 根据当前 turn 识别出稳定位置状态。',
          confidence: 0.86,
          sourceMessageIds: input.sourceMessageIds,
          sourceActivityIds: input.sourceActivityIds,
        });
        return candidate ? [candidate] : [];
      },
    };

    const result = await recordStorylineTurnContinuity({
      storyline,
      userInput: '完了，我发现手机丢了，好像放在垃圾站洗手台了！',
      assistantOutput: '你先回去看看洗手台上还在不在。',
      sourceMessageIds: ['session-1', 'resp-1'],
      worldStateGate,
      worldStateExtractor,
    });

    assert.equal(result.worldStateDebug.processingStatus, 'scheduled');
    assert.equal(result.worldStateDebug.processingPath, 'uncertain_fallback_extractor');
    assert.equal(result.worldStateDebug.updated, false);
    assert.equal(extractorInvoked, false);
    assert.equal(
      listAllMemoryRecords(storyline.id).some((memory) => memory.kind === 'world_object_state'),
      false,
    );

    await waitForPendingWorldStateJobsForTests();

    assert.equal(extractorInvoked, true);
    assert.equal(result.worldStateDebug.processingStatus, 'completed');
    assert.equal(result.worldStateDebug.updated, true);
    assert.match(buildContextPack(storyline.id).sceneProjection?.summary ?? '', /垃圾站洗手台/);
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
