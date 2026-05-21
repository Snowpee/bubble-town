import type { ContextPack, ContinuityMode, TimeContext } from '@bubble-town/shared';
import { getSessionDetail } from './session-store.js';
import {
  getCharacter,
  getRuntimeSessionForStoryline,
  getStoryline,
  listActivityLogs,
  listMemoryRecords,
  listSuppressedMemories,
} from './story-runtime-store.js';

function formatDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function dayRange(date: Date, timezone: string): [string, string] {
  const day = formatDateInTimezone(date, timezone);
  const start = new Date(`${day}T00:00:00.000`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return [start.toISOString(), end.toISOString()];
}

function shiftedDate(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function nightRange(date: Date, timezone: string, previous: boolean): [string, string] {
  const base = formatDateInTimezone(previous ? shiftedDate(date, -1) : date, timezone);
  const start = new Date(`${base}T18:00:00.000`);
  const end = new Date(start.getTime() + 11 * 60 * 60 * 1000);
  return [start.toISOString(), end.toISOString()];
}

function describeElapsedSince(value?: string, now = new Date()): string | undefined {
  if (!value) {
    return undefined;
  }

  const previous = new Date(value);
  if (Number.isNaN(previous.getTime())) {
    return undefined;
  }

  const elapsedMs = Math.max(0, now.getTime() - previous.getTime());
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时`;
  }
  return `${Math.floor(hours / 24)} 天`;
}

function resolveContinuityMode(lastInteractionAt?: string, now = new Date()): ContinuityMode {
  if (!lastInteractionAt) {
    return 'live';
  }

  const previous = new Date(lastInteractionAt);
  if (Number.isNaN(previous.getTime())) {
    return 'live';
  }

  const elapsedHours = Math.max(0, now.getTime() - previous.getTime()) / 3_600_000;
  if (elapsedHours < 1) {
    return 'live';
  }
  if (elapsedHours < 18) {
    return 'same_day';
  }
  if (elapsedHours < 72) {
    return 'new_day';
  }
  return 'long_gap';
}

export function buildTimeContext(lastInteractionAt?: string, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'): TimeContext {
  const now = new Date();
  return {
    now: now.toISOString(),
    timezone,
    today: dayRange(now, timezone),
    yesterday: dayRange(shiftedDate(now, -1), timezone),
    lastNight: nightRange(now, timezone, true),
    tonight: nightRange(now, timezone, false),
    elapsedSinceLastInteraction: describeElapsedSince(lastInteractionAt, now),
  };
}

export function buildContextPack(storylineId: string): ContextPack {
  const storyline = getStoryline(storylineId);
  if (!storyline || storyline.status !== 'active') {
    throw new Error('未找到可用剧情。');
  }

  const character = getCharacter(storyline.characterId);
  if (!character) {
    throw new Error('未找到剧情角色。');
  }

  const runtimeSession = getRuntimeSessionForStoryline(storylineId);
  const recentMessages = runtimeSession?.hermesSessionId
    ? (getSessionDetail(runtimeSession.hermesSessionId, storyline.hermesProfileId)?.messages ?? []).slice(-12)
    : [];
  const time = buildTimeContext(storyline.lastInteractionAt);

  return {
    storylineId: storyline.id,
    characterId: character.id,
    hermesProfileId: storyline.hermesProfileId,
    time,
    continuityMode: resolveContinuityMode(storyline.lastInteractionAt),
    recentMessages,
    memories: listMemoryRecords(storyline.id, character.id),
    suppressedMemories: listSuppressedMemories(storyline.id, character.id),
    activityLogs: listActivityLogs(storyline.id),
    systemInstructions: [
      '你正在扮演一个长期陪伴型角色。请自然续接当前剧情，不要用系统记录口吻解释上下文。',
      '只使用当前 ContextPack 中的剧情记忆和活动记录；不要主动引入其它剧情的信息。',
      '遇到 suppressedMemories 中的内容，除非用户主动询问，否则不要主动提及。',
    ],
  };
}

export function renderContextPackInstructions(contextPack: ContextPack): string {
  const memories = contextPack.memories.map((memory) => `- [${memory.scope}] ${memory.content}`).join('\n') || '- 无';
  const suppressed = contextPack.suppressedMemories.map((memory) => `- ${memory.pattern}`).join('\n') || '- 无';
  const activity = contextPack.activityLogs.map((entry) => `- [${entry.happenedAt}] ${entry.summary}`).join('\n') || '- 无';
  const recent = contextPack.recentMessages.map((message) => `- ${message.role}: ${message.content}`).join('\n') || '- 无';

  return [
    '<BubbleTownContextPack>',
    `storylineId: ${contextPack.storylineId}`,
    `characterId: ${contextPack.characterId}`,
    `hermesProfileId: ${contextPack.hermesProfileId}`,
    `now: ${contextPack.time.now}`,
    `timezone: ${contextPack.time.timezone}`,
    `elapsedSinceLastInteraction: ${contextPack.time.elapsedSinceLastInteraction ?? 'unknown'}`,
    `continuityMode: ${contextPack.continuityMode}`,
    'systemInstructions:',
    ...contextPack.systemInstructions.map((instruction) => `- ${instruction}`),
    'memories:',
    memories,
    'suppressedMemories:',
    suppressed,
    'activityLogs:',
    activity,
    'recentMessages:',
    recent,
    '</BubbleTownContextPack>',
  ].join('\n');
}
