import type { MemoryCandidate, MemoryKind, MemoryLifespan, MemoryScope, Storyline } from '@bubble-town/shared';

function compact(value: string, maxLength = 140): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}...`;
}

function isQuestion(value: string): boolean {
  return /[？?]$|吗|什么|哪|几|是否/.test(value);
}

function createCandidate(input: {
  kind: MemoryKind;
  content: string;
  scope?: MemoryScope;
  importance: number;
  confidence: number;
  lifespan?: MemoryLifespan;
  reason: string;
  shouldPersist?: boolean;
  sourceMessageIds?: string[];
}): MemoryCandidate {
  return {
    kind: input.kind,
    content: input.content,
    scope: input.scope ?? 'user',
    importance: input.importance,
    confidence: input.confidence,
    lifespan: input.lifespan ?? 'long_term',
    source: 'auto_extract',
    reason: input.reason,
    shouldPersist: input.shouldPersist ?? true,
    sourceMessageIds: input.sourceMessageIds,
  };
}

export function extractRuleBasedMemoryCandidates(input: {
  storyline: Storyline;
  userInput: string;
  assistantOutput?: string;
  sourceMessageIds?: string[];
}): MemoryCandidate[] {
  const normalized = input.userInput.replace(/\s+/g, ' ').trim();
  const candidates: MemoryCandidate[] = [];
  const asksQuestion = isQuestion(normalized);

  if (!normalized || asksQuestion) {
    return candidates;
  }

  if (/开玩笑|随口说|今天临时|只是现在|暂时/.test(normalized)) {
    return [
      createCandidate({
        kind: 'emotion_state',
        content: `用户临时状态或低稳定性表达：${compact(normalized)}`,
        scope: 'activity',
        importance: 0.35,
        confidence: 0.35,
        lifespan: 'temporary',
        reason: '用户表达包含临时、玩笑或不稳定信号，不应作为高置信长期记忆。',
        shouldPersist: false,
        sourceMessageIds: input.sourceMessageIds,
      }),
    ];
  }

  if (/记住|请记得|帮我记|以后|约定|答应|别忘/.test(normalized)) {
    candidates.push(createCandidate({
      kind: 'commitment',
      content: `用户明确提出需要记住或延续的约定：${compact(normalized)}`,
      importance: 0.85,
      confidence: 0.78,
      reason: '用户使用了记住、约定、以后或别忘等长期延续表达。',
      sourceMessageIds: input.sourceMessageIds,
    }));
  }

  if (/我喜欢|我偏好|我爱|我想要|我希望|我更希望|我习惯/.test(normalized)) {
    candidates.push(createCandidate({
      kind: 'preference',
      content: `用户偏好：${compact(normalized)}`,
      importance: 0.75,
      confidence: 0.72,
      reason: '用户表达了偏好、希望或习惯。',
      sourceMessageIds: input.sourceMessageIds,
    }));
  }

  if (/我不喜欢|我讨厌|不要|别.*(这样|这么|再)|不想.*(要|再)|以后别/.test(normalized)) {
    candidates.push(createCandidate({
      kind: 'boundary',
      content: `用户边界或负向偏好：${compact(normalized)}`,
      importance: 0.8,
      confidence: 0.7,
      reason: '用户表达了负向偏好、边界或避免事项。',
      sourceMessageIds: input.sourceMessageIds,
    }));
  }

  if (/我是|我叫|叫我|我的生日|我住|我在.*工作|我的.*是/.test(normalized)) {
    candidates.push(createCandidate({
      kind: 'identity',
      content: `用户身份或稳定事实：${compact(normalized)}`,
      importance: 0.7,
      confidence: 0.68,
      reason: '用户表达了身份、称呼、生日、住处、工作或稳定事实。',
      sourceMessageIds: input.sourceMessageIds,
    }));
  }

  return candidates;
}
