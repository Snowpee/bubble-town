import type { MemoryCandidate, Storyline } from '@bubble-town/shared';
import { createActivityLog, createMemoryRecord, createSuppressedMemory, listAllMemoryRecords, listAllSuppressedMemories } from './story-runtime-store.js';
import { extractRuleBasedMemoryCandidates } from './memory-candidates.js';

function compact(value: string, maxLength = 140): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}...`;
}

export function summarizeSessionRollover(input: {
  previousHermesSessionId: string;
  messageCount: number;
  startedAt?: string;
  updatedAt?: string;
}): string {
  const range = input.startedAt && input.updatedAt
    ? `，时间范围 ${input.startedAt} 至 ${input.updatedAt}`
    : '';
  return `底层 Hermes session ${input.previousHermesSessionId} 已滚动归档，共 ${input.messageCount} 条消息${range}；后续连续性以 ActivityLog、MemoryRecord 和新的运行 session 维持。`;
}

function isLowInformation(input: string, output: string): boolean {
  const normalized = `${input} ${output}`.replace(/\s+/g, '').toLowerCase();
  if (normalized.length < 16) {
    return true;
  }
  return /^(hi|hello|你好|在吗|嗯|哦|好|ok|test|测试)+$/i.test(normalized);
}

function hasDuplicateMemory(storylineId: string, content: string): boolean {
  return listAllMemoryRecords(storylineId).some((memory) => memory.status === 'active' && memory.content === content);
}

function hasDuplicateSuppression(storylineId: string, pattern: string): boolean {
  return listAllSuppressedMemories(storylineId).some((memory) => memory.status === 'active' && memory.pattern === pattern);
}

function createMemoryIfNew(storyline: Storyline, candidate: MemoryCandidate) {
  if (!candidate.shouldPersist || candidate.confidence < 0.45) {
    return undefined;
  }
  if (hasDuplicateMemory(storyline.id, candidate.content)) {
    return undefined;
  }
  return createMemoryRecord(storyline.id, {
    content: candidate.content,
    scope: candidate.scope,
    source: candidate.source,
    kind: candidate.kind,
    lifespan: candidate.lifespan,
    reason: candidate.reason,
    importance: candidate.importance,
    confidence: candidate.confidence,
    sourceMessageIds: candidate.sourceMessageIds,
  });
}

function extractSuppression(input: string): { pattern: string; reason: string } | undefined {
  if (!/不要.*提|别.*提|不想.*提|以后别提/.test(input)) {
    return undefined;
  }
  return {
    pattern: compact(input, 100),
    reason: '用户在对话中表达了不要主动提及该内容的意图。',
  };
}

function createActivitySummary(input: string, output: string): string {
  return `用户提到「${compact(input, 64)}」，角色回应「${compact(output, 72)}」。`;
}

export function recordStorylineTurnContinuity(input: {
  storyline: Storyline;
  userInput: string;
  assistantOutput: string;
  sourceMessageIds?: string[];
}) {
  const created = {
    activityLog: undefined as ReturnType<typeof createActivityLog> | undefined,
    memories: [] as NonNullable<ReturnType<typeof createMemoryRecord>>[],
    suppressedMemory: undefined as ReturnType<typeof createSuppressedMemory> | undefined,
  };

  if (!isLowInformation(input.userInput, input.assistantOutput)) {
    created.activityLog = createActivityLog(input.storyline.id, {
      summary: createActivitySummary(input.userInput, input.assistantOutput),
      tags: ['conversation', 'auto'],
      sourceMessageIds: input.sourceMessageIds,
    });
  }

  const suppression = extractSuppression(input.userInput);
  if (!suppression) {
    for (const candidate of extractRuleBasedMemoryCandidates({
      storyline: input.storyline,
      userInput: input.userInput,
      assistantOutput: input.assistantOutput,
      sourceMessageIds: input.sourceMessageIds,
    })) {
      const memory = createMemoryIfNew(input.storyline, candidate);
      if (memory) {
        created.memories.push(memory);
      }
    }
  }

  if (suppression && !hasDuplicateSuppression(input.storyline.id, suppression.pattern)) {
    created.suppressedMemory = createSuppressedMemory(input.storyline.id, suppression);
  }

  return created;
}
