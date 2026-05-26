import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildContextPack, renderContextPackInstructions } from '../story/context-pack.js';
import { extractLegacyRuleBasedMemoryCandidates } from './memory-candidates.js';
import { recordStorylineTurnContinuity, waitForPendingWorldStateJobsForTests } from '../story/story-memory-continuity.js';
import type { WorldStateCandidateExtractor } from '../world-state/world-state-extractor.js';
import type { WorldStateSideChannelGate } from '../world-state/world-state-side-channel.js';
import {
  createCharacter,
  createActivityLog,
  createMemoryRecord,
  createStoryline,
  createSuppressedMemory,
  listAllActivityLogs,
  listAllMemoryRecords,
  listPendingSemanticFrames,
  listAllSuppressedMemories,
  resetStoryRuntimeForTests,
} from '../../store/story-runtime-store.js';
import { createWorldStateUpdateCandidate, getStorylineSceneId } from '../world-state/world-state.js';

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

test('legacy 规则 fallback 生成带 legacy 标记的 MemoryCandidate', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });

    const candidates = extractLegacyRuleBasedMemoryCandidates({
      storyline,
      userInput: '我更希望你以后直接一点说重点。',
      sourceMessageIds: ['session-1', 'resp-1'],
    });

    assert.equal(candidates[0]?.kind, 'commitment');
    assert.equal(candidates[1]?.kind, 'preference');
    assert.equal(candidates[0]?.lifespan, 'long_term');
    assert.equal(candidates[0]?.shouldPersist, true);
    assert.match(candidates[0]?.reason ?? '', /长期延续/);
    assert.equal(candidates[0]?.semanticSource, 'legacy');
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

test('story_fact 可通过连续性流水线独立派生，而不依赖手动 consolidation', async () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '阶段摘要',
    });

    await recordStorylineTurnContinuity({
      storyline,
      userInput: '今天早上我先整理了下载记录。',
      assistantOutput: '好，我记住你先看了下载记录。',
      sourceMessageIds: ['session-1', 'resp-1'],
    });
    await recordStorylineTurnContinuity({
      storyline,
      userInput: '后来我又核对了 Seedance 的截图细节。',
      assistantOutput: '明白，这轮还检查了截图。',
      sourceMessageIds: ['session-1', 'resp-2'],
    });
    await recordStorylineTurnContinuity({
      storyline,
      userInput: '最后我把比价结果也重新确认了一遍。',
      assistantOutput: '好，这样今天的检查过程就完整了。',
      sourceMessageIds: ['session-1', 'resp-3'],
    });

    const storyFacts = listAllMemoryRecords(storyline.id).filter((memory) => memory.kind === 'story_fact');
    const activityLogs = listAllActivityLogs(storyline.id);

    assert.equal(storyFacts.length, 1);
    assert.equal(storyFacts[0]?.source, 'summary');
    assert.match(storyFacts[0]?.content ?? '', /阶段摘要/);
    assert.doesNotMatch(storyFacts[0]?.content ?? '', /角色回应/);
    assert.doesNotMatch(storyFacts[0]?.content ?? '', /\.\.\.|…/);
    assert.match(storyFacts[0]?.sourceHappenedAtStart ?? '', /^\d{4}-\d{2}-\d{2}T/);
    assert.match(storyFacts[0]?.sourceHappenedAtEnd ?? '', /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(activityLogs.every((entry) => entry.tags.includes('consolidated')));
    assert.ok(buildContextPack(storyline.id, { input: '今天我都做了什么？' }).memories.some((memory) => memory.kind === 'story_fact'));
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('story_fact consolidation 使用多语言结构化 evidenceSpan 而不是中文关键词', async () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: 'Multilingual semantic events',
    });

    const logs = [
      createActivityLog(storyline.id, {
        summary: 'legacy display text 1',
        tags: ['conversation', 'auto', 'memory-solidification-v2'],
        semanticEvents: [{
          id: 'semantic_en_1',
          eventType: 'story_event',
          temporalScope: 'session',
          stability: 'stable',
          evidenceSpan: 'I put my keys in the hallway drawer.',
          confidence: 0.9,
        }],
      }),
      createActivityLog(storyline.id, {
        summary: 'legacy display text 2',
        tags: ['conversation', 'auto', 'memory-solidification-v2'],
        semanticEvents: [{
          id: 'semantic_es_1',
          eventType: 'story_event',
          temporalScope: 'session',
          stability: 'stable',
          evidenceSpan: 'Puse mi bolso en la recepción.',
          confidence: 0.9,
        }],
      }),
      createActivityLog(storyline.id, {
        summary: 'legacy display text 3',
        tags: ['conversation', 'auto', 'memory-solidification-v2'],
        semanticEvents: [{
          id: 'semantic_ja_1',
          eventType: 'story_event',
          temporalScope: 'session',
          stability: 'stable',
          evidenceSpan: '鍵は玄関の引き出しに戻した。',
          confidence: 0.9,
        }],
      }),
    ];

    await recordStorylineTurnContinuity({
      storyline,
      userInput: 'continue',
      assistantOutput: 'ok',
      skipActivityLogCreation: true,
    });

    const storyFact = listAllMemoryRecords(storyline.id).find((memory) => memory.kind === 'story_fact');

    assert.equal(storyFact?.sourceActivityIds?.length, logs.length);
    assert.match(storyFact?.content ?? '', /I put my keys in the hallway drawer/);
    assert.match(storyFact?.content ?? '', /Puse mi bolso en la recepción/);
    assert.match(storyFact?.content ?? '', /鍵は玄関の引き出しに戻した/);
    assert.equal(storyFact?.semanticEvents?.length, 3);
    assert.doesNotMatch(storyFact?.content ?? '', /legacy display text/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('自动 story_fact 不会固化缺少新资格参数的旧 ActivityLog backlog', async () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '旧日志隔离',
    });

    createActivityLog(storyline.id, {
      happenedAt: '2026-05-21T10:00:00.000Z',
      summary: '旧日志：用户整理了下载记录。',
      tags: ['conversation', 'auto'],
    });
    createActivityLog(storyline.id, {
      happenedAt: '2026-05-21T10:05:00.000Z',
      summary: '旧日志：用户核对了截图。',
      tags: ['conversation', 'auto'],
    });
    createActivityLog(storyline.id, {
      happenedAt: '2026-05-21T10:10:00.000Z',
      summary: '旧日志：用户确认了比价。',
      tags: ['conversation', 'auto'],
    });

    await recordStorylineTurnContinuity({
      storyline,
      userInput: '今天我只是在继续聊天。',
      assistantOutput: '收到，我们继续。',
      sourceMessageIds: ['session-1', 'resp-new'],
    });

    assert.deepEqual(
      listAllMemoryRecords(storyline.id).filter((memory) => memory.kind === 'story_fact'),
      [],
    );
    assert.equal(
      listAllActivityLogs(storyline.id).filter((entry) => entry.summary.startsWith('旧日志')).some((entry) => entry.tags.includes('consolidated')),
      false,
    );
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('未完成的答应提示不会被写成 commitment', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '半句提示',
    });

    assert.deepEqual(
      extractLegacyRuleBasedMemoryCandidates({
        storyline,
        userInput: 'sami 不是答应我说……',
        sourceMessageIds: ['session-1', 'resp-1'],
      }),
      [],
    );
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('relationship 不确定表达先进入 pending frame，短确认后再正式写入', async () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '关系确认',
    });

    await recordStorylineTurnContinuity({
      storyline,
      userInput: '我和她最近算是和好了',
      assistantOutput: '我先记着这是一条待确认的关系变化。',
      sourceMessageIds: ['session-1', 'resp-1'],
    });

    const pendingBeforeConfirm = listPendingSemanticFrames(storyline.id);
    const preview = buildContextPack(storyline.id, { input: '嗯' });
    const rendered = renderContextPackInstructions(preview);

    assert.equal(listAllMemoryRecords(storyline.id).filter((memory) => memory.kind === 'relationship').length, 0);
    assert.equal(pendingBeforeConfirm.length, 1);
    assert.equal(pendingBeforeConfirm[0]?.kind, 'relationship_confirm');
    assert.match(rendered, /pendingSemanticFrames/);
    assert.match(rendered, /关系变化/);

    await recordStorylineTurnContinuity({
      storyline,
      userInput: '嗯',
      assistantOutput: '好，那我就按和好了来记住。',
      sourceMessageIds: ['session-1', 'resp-2'],
    });

    const relationships = listAllMemoryRecords(storyline.id).filter((memory) => memory.kind === 'relationship');
    assert.equal(listPendingSemanticFrames(storyline.id).length, 0);
    assert.equal(relationships.length, 1);
    assert.match(relationships[0]?.content ?? '', /和好了/);
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

test('suppression 会阻断后续命中相同主题的自动 memory candidate', async () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '抑制阻断',
    });

    createSuppressedMemory(storyline.id, { pattern: '不要主动提昨晚争吵。' });

    await recordStorylineTurnContinuity({
      storyline,
      userInput: '昨晚争吵后我们现在只是朋友了。',
      assistantOutput: '我先不主动记录这条关系变化。',
      sourceMessageIds: ['session-1', 'resp-1'],
    });

    assert.equal(listAllMemoryRecords(storyline.id).filter((memory) => memory.kind === 'relationship').length, 0);
    assert.equal(listPendingSemanticFrames(storyline.id).length, 0);
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

test('连续性记录通过结构化 world-state candidate 收敛省略主语的找回状态', async () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Lumi', templateProfileId: 'lumi-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'lumi-story-001',
      title: 'Lumi 当前 Timeline',
      currentSceneId: 'default_scene',
    });

    const worldStateGate: WorldStateSideChannelGate = {
      async decide(input) {
        if (input.userInput === '放门卫那里了') {
          assert.match(input.recentActivityLogs?.map((entry) => entry.summary).join('\n') ?? '', /我钥匙没了/);
          const candidate = createWorldStateUpdateCandidate({
            sceneId: getStorylineSceneId(input.storyline),
            objectLabel: '钥匙',
            stateKind: 'location',
            state: 'located',
            locationText: '门卫那里',
            actionType: 'place',
            sourceSpan: '放门卫那里了',
            isCurrentStableState: true,
            reason: '根据最近一轮“钥匙没了”补全省略主语。',
            confidence: 0.9,
            sourceMessageIds: input.sourceMessageIds,
            sourceActivityIds: input.sourceActivityIds,
          });
          return {
            decision: 'direct_apply',
            confidence: 0.9,
            candidates: candidate ? [candidate] : [],
          };
        }
        if (input.userInput === '拿回来了。不过我发现我包没了') {
          const keyCandidate = createWorldStateUpdateCandidate({
            sceneId: getStorylineSceneId(input.storyline),
            objectLabel: '钥匙',
            stateKind: 'status',
            state: 'found',
            actionType: 'move',
            sourceSpan: '拿回来了',
            isCurrentStableState: true,
            temporalScope: 'stable',
            stability: 'stable',
            reason: '测试 gate 用结构化上下文确认钥匙已取回。',
            confidence: 0.86,
            sourceMessageIds: input.sourceMessageIds,
            sourceActivityIds: input.sourceActivityIds,
          });
          const bagCandidate = createWorldStateUpdateCandidate({
            sceneId: getStorylineSceneId(input.storyline),
            objectLabel: '包',
            stateKind: 'status',
            state: 'lost',
            actionType: 'unknown',
            sourceSpan: '我发现我包没了',
            isCurrentStableState: true,
            reason: '用户明确说明包丢失。',
            confidence: 0.88,
            sourceMessageIds: input.sourceMessageIds,
            sourceActivityIds: input.sourceActivityIds,
          });
          const candidates = [];
          if (keyCandidate) {
            candidates.push(keyCandidate);
          }
          if (bagCandidate) {
            candidates.push(bagCandidate);
          }
          return {
            decision: 'direct_apply',
            confidence: 0.88,
            candidates,
          };
        }
        if (input.userInput === '我记得了，放在水果店了，我去拿') {
          assert.match(input.recentActivityLogs?.map((entry) => entry.summary).join('\n') ?? '', /包没了/);
          const candidate = createWorldStateUpdateCandidate({
            sceneId: getStorylineSceneId(input.storyline),
            objectLabel: '包',
            stateKind: 'location',
            state: 'located',
            locationText: '水果店',
            actionType: 'place',
            sourceSpan: '放在水果店了',
            isCurrentStableState: true,
            reason: '根据最近一轮“包没了”补全省略主语。',
            confidence: 0.9,
            sourceMessageIds: input.sourceMessageIds,
            sourceActivityIds: input.sourceActivityIds,
          });
          return {
            decision: 'direct_apply',
            confidence: 0.9,
            candidates: candidate ? [candidate] : [],
          };
        }
        if (input.userInput === '拿到了') {
          const candidate = createWorldStateUpdateCandidate({
            sceneId: getStorylineSceneId(input.storyline),
            objectLabel: '包',
            stateKind: 'status',
            state: 'found',
            actionType: 'move',
            sourceSpan: '拿到了',
            isCurrentStableState: true,
            temporalScope: 'stable',
            stability: 'stable',
            reason: '测试 gate 用结构化上下文确认包已找回。',
            confidence: 0.86,
            sourceMessageIds: input.sourceMessageIds,
            sourceActivityIds: input.sourceActivityIds,
          });
          return {
            decision: 'direct_apply',
            confidence: 0.86,
            candidates: candidate ? [candidate] : [],
          };
        }
        return {
          decision: 'skip',
          confidence: 1,
          candidates: [],
        };
      },
    };

    await recordStorylineTurnContinuity({
      storyline,
      userInput: '我钥匙没了',
      assistantOutput: '钥匙不见了？先想想最后一次用是什么时候。',
      sourceMessageIds: ['session-1', 'resp-1'],
      worldStateGate,
    });
    await recordStorylineTurnContinuity({
      storyline,
      userInput: '放门卫那里了',
      assistantOutput: '那就好，去门卫那儿拿一下就行。',
      sourceMessageIds: ['session-1', 'resp-2'],
      worldStateGate,
    });
    await recordStorylineTurnContinuity({
      storyline,
      userInput: '拿回来了。不过我发现我包没了',
      assistantOutput: '包也没了？你还记得可能落在哪儿了吗？',
      sourceMessageIds: ['session-1', 'resp-3'],
      worldStateGate,
    });
    await recordStorylineTurnContinuity({
      storyline,
      userInput: '我记得了，放在水果店了，我去拿',
      assistantOutput: '想起来了就好，快去拿吧。',
      sourceMessageIds: ['session-1', 'resp-4'],
      worldStateGate,
    });
    await recordStorylineTurnContinuity({
      storyline,
      userInput: '拿到了',
      assistantOutput: '好，钥匙和包都找回来了。',
      sourceMessageIds: ['session-1', 'resp-5'],
      worldStateGate,
    });

    const activeWorldStates = listAllMemoryRecords(storyline.id)
      .filter((memory) => memory.kind === 'world_object_state' && memory.status === 'active')
      .sort((left, right) => left.worldState!.objectLabel.localeCompare(right.worldState!.objectLabel));

    assert.deepEqual(
      activeWorldStates.map((memory) => ({
        objectLabel: memory.worldState?.objectLabel,
        state: memory.worldState?.state,
      })),
      [
        { objectLabel: '包', state: 'found' },
        { objectLabel: '钥匙', state: 'found' },
      ],
    );
    assert.equal(
      listAllMemoryRecords(storyline.id).some((memory) => memory.worldState?.objectLabel === 'object'),
      false,
    );
    assert.ok(activeWorldStates.every((memory) => memory.sourceHappenedAtStart && memory.sourceHappenedAtEnd));
    assert.match(buildContextPack(storyline.id).sceneProjection?.summary ?? '', /钥匙当前状态为 found/);
    assert.match(buildContextPack(storyline.id).sceneProjection?.summary ?? '', /包当前状态为 found/);

    const storyFacts = listAllMemoryRecords(storyline.id)
      .filter((memory) => memory.kind === 'story_fact')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const activeStoryFact = storyFacts.find((memory) => memory.status === 'active');
    const hiddenStoryFact = storyFacts.find((memory) => memory.status === 'hidden');

    assert.equal(storyFacts.length, 2);
    assert.equal(hiddenStoryFact?.supersededBy, activeStoryFact?.id);
    assert.deepEqual(activeStoryFact?.supersedes, hiddenStoryFact ? [hiddenStoryFact.id] : undefined);
    assert.equal(activeStoryFact?.sourceActivityIds?.length, 5);
    assert.match(activeStoryFact?.content ?? '', /我钥匙没了/);
    assert.match(activeStoryFact?.content ?? '', /放门卫那里了/);
    assert.match(activeStoryFact?.content ?? '', /拿回来了/);
    assert.match(activeStoryFact?.content ?? '', /我发现我包没了/);
    assert.match(activeStoryFact?.content ?? '', /放在水果店了/);
    assert.match(activeStoryFact?.content ?? '', /拿到了/);
    assert.equal(activeStoryFact?.semanticEvents?.length, 5);
    assert.ok(activeStoryFact?.semanticEvents?.every((event) => event.evidenceSpan && event.eventType === 'story_event'));
    assert.doesNotMatch(activeStoryFact?.content ?? '', /角色回应/);
    assert.doesNotMatch(activeStoryFact?.content ?? '', /\.\.\.|…/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('连续性记录不会把口袋里的瞬时位置写成稳定 Scene Projection', async () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '口袋瞬时状态',
      currentSceneId: 'apartment_entry',
    });
    const worldStateGate: WorldStateSideChannelGate = {
      async decide(input) {
        const candidate = createWorldStateUpdateCandidate({
          sceneId: getStorylineSceneId(input.storyline),
          objectLabel: '钥匙',
          stateKind: 'location',
          state: 'located',
          locationText: '另一个口袋里',
          actionType: 'move',
          sourceSpan: '摸摸另一个口袋，哦哦哦在这里',
          isCurrentStableState: true,
          temporalScope: 'instantaneous',
          stability: 'transient',
          stabilityReason: '测试 gate 将该位置标记为瞬时现场状态。',
          reason: '错误示例：瞬时口袋位置不应进入稳定 scene state。',
          confidence: 0.88,
          sourceMessageIds: input.sourceMessageIds,
          sourceActivityIds: input.sourceActivityIds,
        });
        return {
          decision: 'direct_apply',
          reason: '当前 turn 看起来提到了钥匙位置。',
          confidence: 0.88,
          candidates: candidate ? [candidate] : [],
        };
      },
    };

    await recordStorylineTurnContinuity({
      storyline,
      userInput: '摸摸另一个口袋，哦哦哦在这里。',
      assistantOutput: '原来钥匙在另一个口袋里。',
      sourceMessageIds: ['session-1', 'resp-1'],
      worldStateGate,
    });

    const contextPack = buildContextPack(storyline.id, { input: '我钥匙怎么没了？' });

    assert.equal(contextPack.sceneProjection, undefined);
    assert.equal(
      listAllMemoryRecords(storyline.id).some((memory) => memory.kind === 'world_object_state'),
      false,
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

test('同一 storyline 的 world-state 后台任务在前一个失败后仍按顺序继续执行', async () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '队列容错',
      currentSceneId: 'storage_room',
    });
    const executionOrder: string[] = [];
    const worldStateGate: WorldStateSideChannelGate = {
      async decide() {
        return {
          decision: 'uncertain',
          reason: '需要由 fallback extractor 补全稳定 world-state。',
          confidence: 0.61,
          candidates: [],
        };
      },
    };

    const failedResult = await recordStorylineTurnContinuity({
      storyline,
      userInput: '第一轮：我好像把旧信封弄丢了。',
      assistantOutput: '你再回想一下最后放在哪里。',
      sourceMessageIds: ['session-1', 'resp-1'],
      worldStateGate,
      worldStateExtractor: {
        async extract() {
          executionOrder.push('first');
          throw new Error('first extractor failed');
        },
      },
    });

    const succeededResult = await recordStorylineTurnContinuity({
      storyline,
      userInput: '第二轮：我后来想起来，旧信封在储物柜最下层。',
      assistantOutput: '好，我记住它现在在储物柜最下层。',
      sourceMessageIds: ['session-1', 'resp-2'],
      worldStateGate,
      worldStateExtractor: {
        async extract(input) {
          executionOrder.push('second');
          const candidate = createWorldStateUpdateCandidate({
            sceneId: getStorylineSceneId(input.storyline),
            objectLabel: '旧信封',
            stateKind: 'location',
            state: 'located',
            locationText: '储物柜最下层',
            actionType: 'place',
            sourceSpan: '旧信封在储物柜最下层',
            isCurrentStableState: true,
            reason: '第二个后台任务成功补全了旧信封的稳定位置。',
            confidence: 0.87,
            sourceMessageIds: input.sourceMessageIds,
            sourceActivityIds: input.sourceActivityIds,
          });
          return candidate ? [candidate] : [];
        },
      },
    });

    assert.equal(failedResult.worldStateDebug.processingStatus, 'scheduled');
    assert.equal(succeededResult.worldStateDebug.processingStatus, 'scheduled');

    await waitForPendingWorldStateJobsForTests();

    assert.deepEqual(executionOrder, ['first', 'second']);
    assert.equal(failedResult.worldStateDebug.processingStatus, 'completed');
    assert.match(failedResult.worldStateDebug.error ?? '', /first extractor failed/);
    assert.equal(failedResult.worldStateDebug.events?.some((event) => event.phase === 'failed'), true);
    assert.equal(succeededResult.worldStateDebug.processingStatus, 'completed');
    assert.equal(succeededResult.worldStateDebug.updated, true);
    assert.match(buildContextPack(storyline.id).sceneProjection?.summary ?? '', /储物柜最下层/);
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
