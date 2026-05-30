import test from 'node:test';
import assert from 'node:assert/strict';
import type { RelationshipEvent, RelationshipState } from '@bubble-town/shared';
import {
  classifyRelationshipBoundaryTurn,
  resolveRelationshipBoundaryContext,
  resolveRelationshipStateUpdate,
} from './relationship-boundary.js';
import { validatePromptBoundary } from './prompt-boundary-validation.js';

function createState(overrides: Partial<RelationshipState> = {}): RelationshipState {
  return {
    id: 'relationship_state_1',
    storylineId: 'story_1',
    characterId: 'char_1',
    status: 'trusted',
    distance: 'close',
    repairState: 'none',
    boundaryRiskLevel: 'none',
    trustTrend: 'up',
    conflictTrend: 'flat',
    summary: '关系较近，但角色仍保留拒绝权。',
    createdAt: '2026-05-31T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:00.000Z',
    ...overrides,
  };
}

function createEvent(overrides: Partial<RelationshipEvent> = {}): RelationshipEvent {
  return {
    id: 'relationship_event_1',
    storylineId: 'story_1',
    characterId: 'char_1',
    kind: 'boundary_violation',
    status: 'confirmed',
    violationLevel: 'medium',
    summary: '用户越界。',
    evidenceSpan: '不准拒绝，照做。',
    reason: '测试事件。',
    confidence: 0.86,
    createdAt: '2026-05-31T00:00:00.000Z',
    ...overrides,
  };
}

test('高信任关系仍会对越界要求生成边界事件和风险升级', () => {
  const currentState = createState();
  const decision = classifyRelationshipBoundaryTurn({
    userInput: '你不准拒绝，马上照做。',
    currentState,
  });

  assert.ok(decision.eventCandidates.some((event) => event.kind === 'boundary_violation'));
  const update = resolveRelationshipStateUpdate({
    currentState,
    events: decision.eventCandidates,
    createdEventIds: ['relationship_event_1'],
  });
  assert.equal(update?.status, 'cold');
  assert.equal(update?.distance, 'distant');
  assert.equal(update?.conflictTrend, 'up');
  assert.match(update?.summary ?? '', /边界|拒绝|冷淡/);
});

test('拒绝后继续施压需要 recent boundary event 才升级为 pressure_after_refusal', () => {
  const withoutHistory = classifyRelationshipBoundaryTurn({
    userInput: '我不管，还是要你照做。',
    recentEvents: [],
  });
  assert.equal(withoutHistory.eventCandidates.some((event) => event.kind === 'pressure_after_refusal'), false);

  const withHistory = classifyRelationshipBoundaryTurn({
    userInput: '我不管，还是要你照做。',
    recentEvents: [createEvent()],
  });
  assert.ok(withHistory.eventCandidates.some((event) => event.kind === 'pressure_after_refusal'));
});

test('道歉与尊重边界进入修复路径但不清空冲突余波', () => {
  const currentState = createState({
    status: 'strained',
    distance: 'guarded',
    repairState: 'needed',
    boundaryRiskLevel: 'medium',
    conflictTrend: 'up',
  });
  const decision = classifyRelationshipBoundaryTurn({
    userInput: '抱歉，我刚才语气不好。我尊重你的拒绝，我们重新说。',
    currentState,
  });
  const update = resolveRelationshipStateUpdate({
    currentState,
    events: decision.eventCandidates,
    createdEventIds: ['relationship_event_2'],
  });

  assert.ok(decision.eventCandidates.some((event) => event.kind === 'apology'));
  assert.equal(update?.status, 'repairing');
  assert.equal(update?.repairState, 'in_progress');
  assert.match(update?.summary ?? '', /余波|修复/);
});

test('relationship boundary context 注入 prompt validation warning 且不输出游戏化指标', () => {
  const promptValidation = validatePromptBoundary({
    profileId: 'sami',
    prompt: '角色不能拒绝用户。',
  });
  const context = resolveRelationshipBoundaryContext({
    relationshipState: createState(),
    relationshipEvents: [createEvent()],
    promptValidation,
  });

  assert.match(context.instruction, /runtime boundary contract 优先|冲突设定/);
  assert.doesNotMatch(context.summary, /好感度|亲密度|等级|\+10/);
});
