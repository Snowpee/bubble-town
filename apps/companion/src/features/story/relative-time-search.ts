import type { ActivityLog, ChatMessage, MemoryRecord, RelativeTimeReference, RelativeTimeSearchResult, SuppressedMemory, TimeContext } from '@bubble-town/shared';
import { getSessionDetail } from '../../store/session-store.js';
import type { StorylineRuntimeContext } from '../../services/runtime-service.js';
import { getStorylineRuntimeContext } from '../../services/runtime-service.js';
import { matchesSuppressionText } from '../memory/suppression-filter.js';
import { detectRecallRelativeTimeReferences, removeRecallQueryFillerTerms } from './recall-language.js';

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function getRangeForReference(reference: RelativeTimeReference, time: TimeContext): [string, string] | undefined {
  if (reference === 'today') {
    return time.today;
  }
  if (reference === 'yesterday') {
    return time.yesterday;
  }
  if (reference === 'day_before_yesterday') {
    return time.dayBeforeYesterday;
  }
  if (reference === 'last_night') {
    return time.lastNight;
  }
  if (reference === 'tonight') {
    return time.tonight;
  }
  return undefined;
}

function isWithinRange(value: string | undefined, range?: [string, string]): boolean {
  if (!range || !value) {
    return false;
  }
  const time = new Date(value).getTime();
  return !Number.isNaN(time) && time >= new Date(range[0]).getTime() && time < new Date(range[1]).getTime();
}

function memoryMatchesRange(memory: MemoryRecord, range?: [string, string]): boolean {
  if (!range) {
    return false;
  }
  if (memory.sourceHappenedAtStart || memory.sourceHappenedAtEnd) {
    const startValue = memory.sourceHappenedAtStart ?? memory.sourceHappenedAtEnd;
    const endValue = memory.sourceHappenedAtEnd ?? memory.sourceHappenedAtStart;
    const start = new Date(startValue!).getTime();
    const end = new Date(endValue!).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) {
      return false;
    }
    return end >= new Date(range[0]).getTime() && start < new Date(range[1]).getTime();
  }
  return isWithinRange(memory.updatedAt, range) || isWithinRange(memory.createdAt, range);
}

function matchesQuery(value: string, input: string): boolean {
  const normalizedValue = normalizeText(value);
  const keywords = removeRecallQueryFillerTerms(normalizeText(input))
    .split(/\s+/)
    .filter((keyword) => keyword.length >= 2);
  return keywords.length === 0 || keywords.some((keyword) => normalizedValue.includes(keyword));
}

function filterMessages(messages: ChatMessage[], input: string, range?: [string, string], suppressedMemories: SuppressedMemory[] = []): ChatMessage[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message) => !range || isWithinRange(message.createdAt, range))
    .filter((message) => matchesQuery(message.content, input))
    .filter((message) => !matchesSuppressionText(message.content, suppressedMemories))
    .slice(-8);
}

function searchPrevious(
  runtimeContext: StorylineRuntimeContext,
  input: string,
  suppressedMemories: SuppressedMemory[],
): Omit<RelativeTimeSearchResult, 'reference' | 'label' | 'range' | 'query'> {
  const messages = runtimeContext.runtimeSession?.hermesSessionId
    ? filterMessages(
        getSessionDetail(runtimeContext.runtimeSession.hermesSessionId, runtimeContext.storyline.hermesProfileId)?.messages ?? [],
        input,
        undefined,
        suppressedMemories,
      ).slice(-12)
    : [];
  const activityLogs = runtimeContext.allActivityLogs
    .filter((entry) => entry.status === 'active')
    .filter((entry) => !matchesSuppressionText(entry.summary, suppressedMemories))
    .slice(0, 8);
  const memories = runtimeContext.allMemoryRecords
    .filter((memory) => memory.status === 'active')
    .filter((memory) => !matchesSuppressionText(memory.content, suppressedMemories))
    .slice(0, 8);
  return {
    activityLogs,
    memories,
    messages,
    hit: messages.length > 0 || activityLogs.length > 0 || memories.length > 0,
  };
}

export function detectRelativeTimeReferences(input: string): Array<{ reference: RelativeTimeReference; label: string }> {
  return detectRecallRelativeTimeReferences(input);
}

export function searchRelativeTimeInRuntimeContext(
  runtimeContext: StorylineRuntimeContext,
  input: string,
  time: TimeContext,
  suppressedMemories: SuppressedMemory[] = [],
): RelativeTimeSearchResult[] {
  const references = detectRelativeTimeReferences(input);
  const sessionMessages = runtimeContext.runtimeSession?.hermesSessionId
    ? getSessionDetail(runtimeContext.runtimeSession.hermesSessionId, runtimeContext.storyline.hermesProfileId)?.messages ?? []
    : [];

  return references.map(({ reference, label }) => {
    if (reference === 'previous') {
      const result = searchPrevious(runtimeContext, input, suppressedMemories);
      return {
        reference,
        label,
        query: input,
        ...result,
      };
    }

    const range = getRangeForReference(reference, time);
    const activityLogs = runtimeContext.allActivityLogs
      .filter((entry) => entry.status === 'active')
      .filter((entry) => isWithinRange(entry.happenedAt, range))
      .filter((entry) => !matchesSuppressionText(entry.summary, suppressedMemories))
      .slice(0, 8);
    const memories = runtimeContext.allMemoryRecords
      .filter((memory) => memory.status === 'active')
      .filter((memory) => memoryMatchesRange(memory, range))
      .filter((memory) => !matchesSuppressionText(memory.content, suppressedMemories))
      .slice(0, 8);
    const messages = filterMessages(sessionMessages, input, range, suppressedMemories);

    return {
      reference,
      label,
      range,
      query: input,
      activityLogs,
      memories,
      messages,
      hit: activityLogs.length > 0 || memories.length > 0 || messages.length > 0,
    };
  });
}

export function searchRelativeTime(
  storylineId: string,
  input: string,
  time: TimeContext,
  suppressedMemories: SuppressedMemory[] = [],
): RelativeTimeSearchResult[] {
  const runtimeContext = getStorylineRuntimeContext(storylineId);
  if (!runtimeContext) {
    return [];
  }
  return searchRelativeTimeInRuntimeContext(runtimeContext, input, time, suppressedMemories);
}
