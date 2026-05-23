import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConversationPacing } from './conversation-pacing.js';

test('conversation pacing 在短间隔内允许轻量承接话题变化', () => {
  const now = new Date('2026-05-23T06:30:00.000Z');
  const state = resolveConversationPacing({
    now,
    lastInteractionAt: new Date(now.getTime() - 3 * 60_000).toISOString(),
    policy: { topicShiftCommentWindowMinutes: 10 },
  });

  assert.equal(state.topicShiftCommentAllowed, true);
});

test('conversation pacing 超过窗口后把新输入视为自然新话题', () => {
  const now = new Date('2026-05-23T06:30:00.000Z');
  const state = resolveConversationPacing({
    now,
    lastInteractionAt: new Date(now.getTime() - 20 * 60_000).toISOString(),
    policy: { topicShiftCommentWindowMinutes: 10 },
  });

  assert.equal(state.topicShiftCommentAllowed, false);
});

