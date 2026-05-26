import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCharacter, createStoryline, listAllMemoryRecords, resetStoryRuntimeForTests } from '../../store/story-runtime-store.js';
import { decideWorldStateReject } from './world-state-policy.js';
import { applyWorldStateUpdateCandidate, buildSceneProjection, createWorldStateUpdateCandidate } from './world-state.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-world-state-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  resetStoryRuntimeForTests();
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('world object state 写入新状态时会隐藏旧状态并保留 supersedes 链路', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
      currentSceneId: 'north_window_room',
    });

    const first = applyWorldStateUpdateCandidate({
      storylineId: storyline.id,
      candidate: {
        sceneId: 'north_window_room',
        objectLabel: '旧台灯',
        stateKind: 'status',
        state: 'intact',
        actionType: 'unknown',
        sourceSpan: '旧台灯完好无损',
        isCurrentStableState: true,
        reason: '初始状态。',
        confidence: 0.9,
      },
    });
    const second = applyWorldStateUpdateCandidate({
      storylineId: storyline.id,
      candidate: {
        sceneId: 'north_window_room',
        objectLabel: '旧台灯',
        stateKind: 'status',
        state: 'broken',
        actionType: 'break',
        sourceSpan: '把旧台灯砸碎了',
        isCurrentStableState: true,
        reason: '用户明确撞倒台灯并导致损坏。',
        confidence: 0.9,
      },
    });

    const memories = listAllMemoryRecords(storyline.id)
      .filter((memory) => memory.kind === 'world_object_state')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    assert.equal(first.created?.worldState?.version, 1);
    assert.equal(second.created?.worldState?.version, 2);
    assert.equal(memories.length, 2);
    assert.equal(memories[0]?.status, 'hidden');
    assert.equal(memories[0]?.supersededBy, second.created?.id);
    assert.deepEqual(memories[1]?.supersedes, [first.created?.id]);
    assert.equal(memories[1]?.status, 'active');
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('Scene Projection 只汇总当前 scene 的 active world object state', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
      currentSceneId: 'north_window_room',
    });

    applyWorldStateUpdateCandidate({
      storylineId: storyline.id,
      candidate: {
        sceneId: 'north_window_room',
        objectLabel: '旧台灯',
        stateKind: 'status',
        state: 'broken',
        actionType: 'break',
        sourceSpan: '把旧台灯砸坏了',
        isCurrentStableState: true,
        reason: '用户明确砸坏台灯。',
        confidence: 0.9,
      },
    });
    applyWorldStateUpdateCandidate({
      storylineId: storyline.id,
      candidate: {
        sceneId: 'south_gate',
        objectLabel: '南门',
        stateKind: 'status',
        state: 'closed',
        actionType: 'close',
        sourceSpan: '把南门关上了',
        isCurrentStableState: true,
        reason: '用户明确关上南门。',
        confidence: 0.9,
      },
    });

    const projection = buildSceneProjection(storyline.id, 'north_window_room');
    assert.equal(projection?.sceneId, 'north_window_room');
    assert.equal(projection?.items.length, 1);
    assert.match(projection?.summary ?? '', /旧台灯已经损坏/);
    assert.doesNotMatch(projection?.summary ?? '', /南门/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('world state policy 会拒绝假设句、梦境和比喻', () => {
  const hermesHome = createHermesHome();

  try {
    assert.equal(decideWorldStateReject('如果我把旧台灯砸碎会怎样？').rejected, true);
    assert.equal(decideWorldStateReject('我梦见自己把旧台灯砸碎了。').rejected, true);
    assert.equal(decideWorldStateReject('这气氛像是把台灯砸碎了一样糟。').rejected, true);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('world state policy 不会把带有不确定语气的当前位置线索误判为非字面表达', () => {
  const hermesHome = createHermesHome();

  try {
    assert.equal(decideWorldStateReject('哦好像在门卫那里～').rejected, false);
    assert.equal(decideWorldStateReject('手机好像落在前台了').rejected, false);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('createWorldStateUpdateCandidate 通过结构化稳定性字段过滤瞬时位置', () => {
  const hermesHome = createHermesHome();

  try {
    const pocketCandidate = createWorldStateUpdateCandidate({
      sceneId: 'default_scene',
      objectLabel: '钥匙',
      stateKind: 'location',
      state: 'located',
      locationText: '另一个口袋里',
      actionType: 'move',
      sourceSpan: '摸摸另一个口袋，哦哦哦在这里',
      isCurrentStableState: true,
      temporalScope: 'instantaneous',
      stability: 'transient',
      stabilityReason: '测试候选标记为瞬时携带状态。',
      reason: '测试瞬时位置。',
      confidence: 0.82,
    });
    const handCandidate = createWorldStateUpdateCandidate({
      sceneId: 'default_scene',
      objectLabel: '手机',
      stateKind: 'location',
      state: 'located',
      locationText: '手里',
      actionType: 'move',
      sourceSpan: '手机现在就在我手里拿着',
      isCurrentStableState: true,
      temporalScope: 'instantaneous',
      stability: 'transient',
      stabilityReason: '测试候选标记为瞬时携带状态。',
      reason: '测试手持位置。',
      confidence: 0.82,
    });
    const drawerCandidate = createWorldStateUpdateCandidate({
      sceneId: 'default_scene',
      objectLabel: '钥匙',
      stateKind: 'location',
      state: 'located',
      locationText: '玄关柜第二层抽屉里',
      actionType: 'place',
      sourceSpan: '我把钥匙放在玄关柜第二层抽屉里了',
      isCurrentStableState: true,
      temporalScope: 'stable',
      stability: 'stable',
      reason: '测试稳定位置。',
      confidence: 0.91,
    });

    assert.equal(pocketCandidate, undefined);
    assert.equal(handCandidate, undefined);
    assert.equal(drawerCandidate?.locationText, '玄关柜第二层抽屉里');
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('createWorldStateUpdateCandidate 不依赖中文关键词识别稳定位置', () => {
  const hermesHome = createHermesHome();

  try {
    const englishCandidate = createWorldStateUpdateCandidate({
      sceneId: 'default_scene',
      objectLabel: 'keys',
      stateKind: 'location',
      state: 'located',
      locationText: 'hallway drawer',
      actionType: 'place',
      sourceSpan: 'I put my keys in the hallway drawer.',
      isCurrentStableState: true,
      temporalScope: 'stable',
      stability: 'stable',
      reason: 'Structured candidate marks a stable location.',
      confidence: 0.91,
    });
    const spanishTransient = createWorldStateUpdateCandidate({
      sceneId: 'default_scene',
      objectLabel: 'bolso',
      stateKind: 'location',
      state: 'located',
      locationText: 'mi mano',
      actionType: 'move',
      sourceSpan: 'Lo tengo en mi mano ahora.',
      isCurrentStableState: true,
      temporalScope: 'instantaneous',
      stability: 'transient',
      reason: 'Structured candidate marks an instantaneous carrying state.',
      confidence: 0.82,
    });

    assert.equal(englishCandidate?.locationText, 'hallway drawer');
    assert.equal(spanishTransient, undefined);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});


test('createWorldStateUpdateCandidate 会拒绝泛化对象占位词', () => {
  const hermesHome = createHermesHome();

  try {
    const genericCandidate = createWorldStateUpdateCandidate({
      sceneId: 'default_scene',
      objectLabel: 'object',
      stateKind: 'location',
      state: 'located',
      locationText: '门卫那里',
      actionType: 'place',
      sourceSpan: '放门卫那里了',
      isCurrentStableState: true,
      reason: '泛化对象不应进入稳定 world state。',
      confidence: 0.9,
    });
    const chineseGenericCandidate = createWorldStateUpdateCandidate({
      sceneId: 'default_scene',
      objectLabel: '某物',
      stateKind: 'location',
      state: 'located',
      locationText: '水果店',
      actionType: 'place',
      sourceSpan: '放水果店了',
      isCurrentStableState: true,
      reason: '泛化对象不应进入稳定 world state。',
      confidence: 0.9,
    });

    assert.equal(genericCandidate, undefined);
    assert.equal(chineseGenericCandidate, undefined);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});
