export interface ConversationPacingPolicy {
  topicShiftCommentWindowMinutes: number;
}

export interface ConversationPacingState {
  elapsedMs?: number;
  topicShiftCommentAllowed: boolean;
  policy: ConversationPacingPolicy;
}

const DEFAULT_TOPIC_SHIFT_COMMENT_WINDOW_MINUTES = 10;

function readPositiveNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function getConversationPacingPolicy(): ConversationPacingPolicy {
  return {
    topicShiftCommentWindowMinutes: readPositiveNumber(process.env.BUBBLE_TOWN_TOPIC_SHIFT_COMMENT_WINDOW_MINUTES)
      ?? DEFAULT_TOPIC_SHIFT_COMMENT_WINDOW_MINUTES,
  };
}

export function resolveConversationPacing(input: {
  lastInteractionAt?: string;
  now?: Date;
  policy?: ConversationPacingPolicy;
}): ConversationPacingState {
  const policy = input.policy ?? getConversationPacingPolicy();
  if (!input.lastInteractionAt) {
    return {
      topicShiftCommentAllowed: false,
      policy,
    };
  }

  const previous = new Date(input.lastInteractionAt).getTime();
  const now = input.now?.getTime() ?? Date.now();
  if (Number.isNaN(previous) || Number.isNaN(now)) {
    return {
      topicShiftCommentAllowed: false,
      policy,
    };
  }

  const elapsedMs = Math.max(0, now - previous);
  const windowMs = policy.topicShiftCommentWindowMinutes * 60_000;
  return {
    elapsedMs,
    topicShiftCommentAllowed: elapsedMs <= windowMs,
    policy,
  };
}

