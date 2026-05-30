import test from 'node:test';
import assert from 'node:assert/strict';
import type { PendingSemanticFrame, SceneState } from '@bubble-town/shared';
import { resolveSceneClosureContext } from './scene-closure.js';

function createSceneState(overrides: Partial<SceneState> = {}): SceneState {
  return {
    id: overrides.id ?? 'scene_state_1',
    storylineId: overrides.storylineId ?? 'story_1',
    sceneId: overrides.sceneId ?? 'default_scene',
    kind: overrides.kind ?? 'casual_life',
    status: overrides.status ?? 'active',
    inWorldTimeMode: overrides.inWorldTimeMode ?? 'compressed',
    lastBeatSummary: overrides.lastBeatSummary ?? '用户和角色在餐厅吃饭。',
    nextBeatOptions: overrides.nextBeatOptions ?? ['自然结束这一幕'],
    closurePolicy: overrides.closurePolicy ?? 'soft_close',
    createdAt: overrides.createdAt ?? '2026-05-30T12:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-05-30T12:00:00.000Z',
    sourceActivityIds: overrides.sourceActivityIds,
    sourceMessageIds: overrides.sourceMessageIds,
  };
}

function createPendingFrame(kind: PendingSemanticFrame['kind']): PendingSemanticFrame {
  return {
    id: 'pending_1',
    storylineId: 'story_1',
    kind,
    candidate: {
      kind: kind === 'relationship_confirm' ? 'relationship' : 'commitment',
      content: '待确认高敏感关系事项。',
      scope: 'story',
      importance: 0.8,
      confidence: 0.62,
      lifespan: 'long_term',
      source: 'auto_extract',
      reason: '测试用待确认语义。',
      shouldPersist: true,
      confirmationRequired: true,
    },
    prompt: '确认这条高敏感事项。',
    status: 'pending',
    createdAt: '2026-05-30T12:00:00.000Z',
    updatedAt: '2026-05-30T12:00:00.000Z',
  };
}

test('casual_life 长间隔可生成 soft close decision', () => {
  const result = resolveSceneClosureContext({
    resumeMode: 'reopen_thread',
    sceneState: createSceneState(),
  });

  assert.equal(result.mode, 'soft_close');
  assert.equal(result.shouldCreateResolution, true);
  assert.equal(result.canonLevel, 'non_canon');
  assert.match(result.summary ?? '', /自然结束/);
  assert.match(result.instruction, /镜头外自然淡出/);
});

test('conflict / decision / story 场景不会自动 soft close', () => {
  for (const kind of ['conflict', 'decision', 'story', 'emotional'] as const) {
    const result = resolveSceneClosureContext({
      resumeMode: 'reopen_thread',
      sceneState: createSceneState({
        kind,
        closurePolicy: kind === 'story' ? 'pause_exact' : 'ask_on_resume',
      }),
    });

    assert.equal(result.shouldCreateResolution, false);
    assert.notEqual(result.mode, 'soft_close');
  }
});

test('pending commitment / relationship 会阻止 soft close', () => {
  const result = resolveSceneClosureContext({
    resumeMode: 'reopen_thread',
    sceneState: createSceneState(),
    pendingSemanticFrames: [createPendingFrame('commitment_confirm')],
  });

  assert.equal(result.mode, 'ask_user');
  assert.equal(result.shouldCreateResolution, false);
  assert.match(result.instruction, /高敏感待确认语义/);
});

test('缺少 SceneState 时安全降级为 none', () => {
  const result = resolveSceneClosureContext({
    resumeMode: 'fresh_start_with_memory',
  });

  assert.equal(result.mode, 'none');
  assert.equal(result.shouldCreateResolution, false);
  assert.match(result.instruction, /当前没有 sceneState/);
});
