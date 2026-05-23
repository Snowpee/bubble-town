import type { RuntimeSession, Storyline } from '@bubble-town/shared';
import { getSessionDetail } from './session-store.js';
import { clearRuntimeSessionContinuation, createActivityLog } from './story-runtime-store.js';
import { summarizeSessionRollover } from './story-memory-continuity.js';

export interface StorySessionRolloverPolicy {
  maxMessages: number;
  maxAgeDays: number;
}

export interface StorySessionRolloverDecision {
  shouldRollover: boolean;
  reason?: 'message_count' | 'age';
  messageCount?: number;
  ageDays?: number;
}

export const DEFAULT_STORY_SESSION_ROLLOVER_POLICY: StorySessionRolloverPolicy = {
  maxMessages: Number(process.env.BUBBLE_TOWN_STORY_SESSION_MAX_MESSAGES ?? 200),
  maxAgeDays: Number(process.env.BUBBLE_TOWN_STORY_SESSION_MAX_AGE_DAYS ?? 7),
};

function differenceDays(left: string | undefined, right = new Date()): number | undefined {
  if (!left) {
    return undefined;
  }
  const time = new Date(left).getTime();
  if (Number.isNaN(time)) {
    return undefined;
  }
  return Math.max(0, (right.getTime() - time) / 86_400_000);
}

export function evaluateStorySessionRollover(
  storyline: Storyline,
  runtimeSession: RuntimeSession | undefined,
  policy: StorySessionRolloverPolicy = DEFAULT_STORY_SESSION_ROLLOVER_POLICY,
): StorySessionRolloverDecision {
  if (!runtimeSession?.hermesSessionId) {
    return { shouldRollover: false };
  }

  const detail = getSessionDetail(runtimeSession.hermesSessionId, storyline.hermesProfileId);
  if (!detail) {
    return { shouldRollover: false };
  }

  const messageCount = detail.summary.messageCount || detail.messages.length;
  if (messageCount >= policy.maxMessages) {
    return { shouldRollover: true, reason: 'message_count', messageCount };
  }

  const ageDays = differenceDays(detail.summary.startedAt);
  if (ageDays !== undefined && ageDays >= policy.maxAgeDays) {
    return { shouldRollover: true, reason: 'age', messageCount, ageDays };
  }

  return { shouldRollover: false, messageCount, ageDays };
}

export function rolloverStoryRuntimeSessionIfNeeded(
  storyline: Storyline,
  runtimeSession: RuntimeSession | undefined,
  policy: StorySessionRolloverPolicy = DEFAULT_STORY_SESSION_ROLLOVER_POLICY,
): RuntimeSession | undefined {
  const decision = evaluateStorySessionRollover(storyline, runtimeSession, policy);
  if (!decision.shouldRollover || !runtimeSession?.hermesSessionId) {
    return runtimeSession;
  }

  const detail = getSessionDetail(runtimeSession.hermesSessionId, storyline.hermesProfileId);
  createActivityLog(storyline.id, {
    summary: summarizeSessionRollover({
      previousHermesSessionId: runtimeSession.hermesSessionId,
      messageCount: decision.messageCount ?? detail?.summary.messageCount ?? detail?.messages.length ?? 0,
      startedAt: detail?.summary.startedAt,
      updatedAt: detail?.summary.updatedAt,
    }),
    tags: ['system', 'context_rollover', decision.reason ?? 'rollover'],
    sourceMessageIds: [runtimeSession.hermesSessionId],
  });

  return clearRuntimeSessionContinuation({
    storylineId: storyline.id,
    hermesProfileId: storyline.hermesProfileId,
    reason: 'context_rollover',
  });
}
