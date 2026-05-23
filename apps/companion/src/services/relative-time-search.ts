import type { ActivityLog, ChatMessage, MemoryRecord, RelativeTimeReference, RelativeTimeSearchResult, SuppressedMemory, TimeContext } from '@bubble-town/shared';
import { getSessionDetail } from './session-store.js';
import {
  getRuntimeSessionForStoryline,
  getStoryline,
  listAllActivityLogs,
  listAllMemoryRecords,
} from './story-runtime-store.js';
import { matchesSuppressionText } from './suppression-filter.js';
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

function searchPrevious(storylineId: string, input: string, suppressedMemories: SuppressedMemory[]): Omit<RelativeTimeSearchResult, 'reference' | 'label' | 'range' | 'query'> {
  const storyline = getStoryline(storylineId);
  const runtimeSession = getRuntimeSessionForStoryline(storylineId);
  const messages = storyline && runtimeSession?.hermesSessionId
    ? filterMessages(getSessionDetail(runtimeSession.hermesSessionId, storyline.hermesProfileId)?.messages ?? [], input, undefined, suppressedMemories).slice(-12)
    : [];
  const activityLogs = listAllActivityLogs(storylineId)
    .filter((entry) => entry.status === 'active')
    .filter((entry) => !matchesSuppressionText(entry.summary, suppressedMemories))
    .slice(0, 8);
  const memories = listAllMemoryRecords(storylineId)
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

export function searchRelativeTime(storylineId: string, input: string, time: TimeContext, suppressedMemories: SuppressedMemory[] = []): RelativeTimeSearchResult[] {
  const references = detectRelativeTimeReferences(input);
  const storyline = getStoryline(storylineId);
  const runtimeSession = getRuntimeSessionForStoryline(storylineId);
  const sessionMessages = storyline && runtimeSession?.hermesSessionId
    ? getSessionDetail(runtimeSession.hermesSessionId, storyline.hermesProfileId)?.messages ?? []
    : [];

  return references.map(({ reference, label }) => {
    if (reference === 'previous') {
      const result = searchPrevious(storylineId, input, suppressedMemories);
      return {
        reference,
        label,
        query: input,
        ...result,
      };
    }

    const range = getRangeForReference(reference, time);
    const activityLogs = listAllActivityLogs(storylineId)
      .filter((entry) => entry.status === 'active')
      .filter((entry) => isWithinRange(entry.happenedAt, range))
      .filter((entry) => !matchesSuppressionText(entry.summary, suppressedMemories))
      .slice(0, 8);
    const memories = listAllMemoryRecords(storylineId)
      .filter((memory) => memory.status === 'active')
      .filter((memory) => isWithinRange(memory.updatedAt, range) || isWithinRange(memory.createdAt, range))
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
