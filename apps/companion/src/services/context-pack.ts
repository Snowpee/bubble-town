import type { ActivityLog, ChatMessage, ContextPack, ContinuityHint, ContinuityMode, SessionAnchors, SuppressedMemory, TimeContext } from '@bubble-town/shared';
import { getSessionDetail } from './session-store.js';
import {
  getCharacter,
  getRuntimeSessionForStoryline,
  getStoryline,
  listActivityLogs,
  listMemoryRecords,
  listSuppressedMemories,
  markMemoryRecordsAccessed,
} from './story-runtime-store.js';
import { searchRelativeTime } from './relative-time-search.js';
import { retrieveMemoriesForContext } from './memory-retrieval.js';
import { ensureMemoryEmbeddings, getSemanticScores } from './memory-embeddings.js';
import { matchesSuppressionText } from './suppression-filter.js';
import { isSuppressionDirectInquiry } from './recall-language.js';
import { resolveConversationPacing } from './conversation-pacing.js';
import { buildSceneProjection, getStorylineSceneId } from './world-state.js';

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

function formatLocalDateTime(date: Date, timezone: string): { localNow: string; localDate: string; localTime: string } {
  const parts = getZonedParts(date, timezone);
  const pad = (value: number) => String(value).padStart(2, '0');
  const localDate = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  const localTime = `${pad(parts.hour)}:${pad(parts.minute)}`;
  return {
    localNow: `${localDate} ${localTime}`,
    localDate,
    localTime,
  };
}

function getZonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function addCalendarDays(day: string, days: number): string {
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

function zonedDateTimeToUtc(day: string, timezone: string, hour = 0): Date {
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number);
  const targetUtc = Date.UTC(year, month - 1, date, hour, 0, 0);
  const guess = new Date(targetUtc);
  const zoned = getZonedParts(guess, timezone);
  const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  return new Date(guess.getTime() + targetUtc - zonedAsUtc);
}

function dayRange(date: Date, timezone: string): [string, string] {
  const day = formatDateInTimezone(date, timezone);
  const start = zonedDateTimeToUtc(day, timezone, 0);
  const end = zonedDateTimeToUtc(addCalendarDays(day, 1), timezone, 0);
  return [start.toISOString(), end.toISOString()];
}

function shiftedDate(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function nightRange(date: Date, timezone: string, previous: boolean): [string, string] {
  const base = formatDateInTimezone(previous ? shiftedDate(date, -1) : date, timezone);
  const start = zonedDateTimeToUtc(base, timezone, 18);
  const end = zonedDateTimeToUtc(addCalendarDays(base, 1), timezone, 5);
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

function extractUserMessageFromInjectedInput(content: string): string {
  const startTag = '<UserMessage>';
  const endTag = '</UserMessage>';
  const startIndex = content.lastIndexOf(startTag);
  const endIndex = content.lastIndexOf(endTag);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return content;
  }

  return content.slice(startIndex + startTag.length, endIndex).trim();
}

function sanitizeRecentMessage(message: ChatMessage): ChatMessage {
  if (message.role !== 'user') {
    return message;
  }

  if (!message.content.includes('<BubbleTownContextPack>') && !message.content.includes('<UserMessage>')) {
    return message;
  }

  return {
    ...message,
    content: extractUserMessageFromInjectedInput(message.content),
  };
}

export function buildTimeContext(lastInteractionAt?: string, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'): TimeContext {
  const now = new Date();
  const local = formatLocalDateTime(now, timezone);
  return {
    now: now.toISOString(),
    timezone,
    ...local,
    today: dayRange(now, timezone),
    yesterday: dayRange(shiftedDate(now, -1), timezone),
    dayBeforeYesterday: dayRange(shiftedDate(now, -2), timezone),
    lastNight: nightRange(now, timezone, true),
    tonight: nightRange(now, timezone, false),
    elapsedSinceLastInteraction: describeElapsedSince(lastInteractionAt, now),
  };
}

function buildContinuityHints(context: Pick<ContextPack, 'continuityMode' | 'time' | 'relativeTimeResults'>) {
  const hints: ContinuityHint[] = [{
    kind: context.continuityMode,
    message: context.time.elapsedSinceLastInteraction
      ? `当前本地时间是 ${context.time.localNow}（${context.time.timezone}）；距离上次互动约 ${context.time.elapsedSinceLastInteraction}。请自然续接，不要表现为第一次见面。`
      : `当前本地时间是 ${context.time.localNow}（${context.time.timezone}）。这是当前 Storyline 的连续对话。请自然进入角色，不要解释系统上下文。`,
  }];

  for (const result of context.relativeTimeResults) {
    hints.push({
      kind: result.hit ? 'relative_time_hit' as const : 'relative_time_miss' as const,
      message: result.hit
        ? `用户提到「${result.label}」；已检索到当前 Storyline 内的相关记录，请用角色自己的记忆自然转述。`
        : `用户提到「${result.label}」，但当前 Storyline 没有检索到相关记录。不要虚构具体过去事件。`,
    });
  }

  return hints;
}

function buildSessionAnchors(messages: ChatMessage[]): SessionAnchors {
  const userMessages = messages.filter((message) => message.role === 'user');
  const assistantMessages = messages.filter((message) => message.role === 'assistant');
  return {
    messageCount: messages.length,
    firstUserMessage: userMessages[0],
    firstAssistantMessage: assistantMessages[0],
    latestUserMessage: userMessages.at(-1),
    latestAssistantMessage: assistantMessages.at(-1),
  };
}

function filterSuppressedMessages(messages: ChatMessage[], suppressedMemories: SuppressedMemory[]): ChatMessage[] {
  if (suppressedMemories.length === 0) {
    return messages;
  }
  return messages.filter((message) => !matchesSuppressionText(message.content, suppressedMemories));
}

function filterSuppressedActivityLogs(activityLogs: ActivityLog[], suppressedMemories: SuppressedMemory[]): ActivityLog[] {
  if (suppressedMemories.length === 0) {
    return activityLogs;
  }
  return activityLogs.filter((entry) => !matchesSuppressionText(entry.summary, suppressedMemories));
}

export function buildContextPack(storylineId: string, options: { input?: string } = {}): ContextPack {
  const storyline = getStoryline(storylineId);
  if (!storyline || storyline.status !== 'active') {
    throw new Error('未找到可用剧情。');
  }

  const character = getCharacter(storyline.characterId);
  if (!character) {
    throw new Error('未找到剧情角色。');
  }

  const runtimeSession = getRuntimeSessionForStoryline(storylineId);
  const sessionMessages = runtimeSession?.hermesSessionId
    ? (getSessionDetail(runtimeSession.hermesSessionId, storyline.hermesProfileId)?.messages ?? []).map(sanitizeRecentMessage)
    : [];
  const time = buildTimeContext(storyline.lastInteractionAt);
  const suppressedMemories = listSuppressedMemories(storyline.id, character.id);
  const visibleSessionMessages = filterSuppressedMessages(sessionMessages, suppressedMemories);
  const recentMessages = visibleSessionMessages.slice(-12);
  const relativeTimeResults = options.input ? searchRelativeTime(storyline.id, options.input, time, suppressedMemories) : [];
  const continuityMode = resolveContinuityMode(storyline.lastInteractionAt);
  const conversationPacingState = resolveConversationPacing({ lastInteractionAt: storyline.lastInteractionAt });
  const conversationPacing = {
    elapsedMs: conversationPacingState.elapsedMs,
    topicShiftCommentAllowed: conversationPacingState.topicShiftCommentAllowed,
    topicShiftCommentWindowMinutes: conversationPacingState.policy.topicShiftCommentWindowMinutes,
  };
  const continuityHints = buildContinuityHints({ continuityMode, time, relativeTimeResults });
  const activeMemories = listMemoryRecords(storyline.id, character.id)
    .filter((memory) => memory.kind !== 'world_object_state');
  const semanticScores = options.input?.trim()
    ? (() => {
        try {
          ensureMemoryEmbeddings(activeMemories);
          return getSemanticScores({
            storylineId: storyline.id,
            query: options.input,
            targetIds: activeMemories.map((memory) => memory.id),
          });
        } catch {
          return undefined;
        }
      })()
    : undefined;
  const retrievedMemories = retrieveMemoriesForContext({
    memories: activeMemories,
    suppressedMemories,
    query: options.input,
    budget: relativeTimeResults.some((result) => result.hit) ? 8 : 6,
    semanticScores,
  });
  markMemoryRecordsAccessed(retrievedMemories.memories.map((memory) => memory.id));

  const sceneProjection = buildSceneProjection(storyline.id, getStorylineSceneId(storyline));

  return {
    storylineId: storyline.id,
    characterId: character.id,
    hermesProfileId: storyline.hermesProfileId,
    time,
    continuityMode,
    conversationPacing,
    sessionAnchors: buildSessionAnchors(visibleSessionMessages),
    recentMessages,
    memories: retrievedMemories.memories,
    memoryRetrievals: retrievedMemories.metadata,
    suppressedMemories,
    suppressionDisclosureAllowed: Boolean(options.input?.trim() && isSuppressionDirectInquiry(options.input)),
    activityLogs: filterSuppressedActivityLogs(listActivityLogs(storyline.id), suppressedMemories),
    continuityHints,
    relativeTimeResults,
    sceneProjection,
    systemInstructions: [
      '你正在扮演一个长期陪伴型角色。请自然续接当前 Timeline，不要用系统记录口吻解释上下文。',
      '只使用当前 ContextPack 中的剧情记忆和活动记录；不要主动引入其它剧情的信息。',
      'sceneProjection 表示当前场景中稳定成立的重要物品状态；它比普通语义召回更可靠，但不要把它当成数据库字段逐项复述给用户。',
      'suppressedMemories 表示用户不希望主动展开的边界；相关内容已在注入前过滤，不要主动猜测、追问或展开被过滤主题。',
      'ContextPack 中的 now、localNow、localTime、timezone 和相对时间范围是 authoritative_time，优先于 Conversation started、历史消息中的时间说法和之前的 terminal date 工具结果。',
      '之前轮次的 terminal date 输出只代表当时的工具结果；每一轮回答当前时间、昼夜、早晚、是否该睡觉时，都必须重新以本轮 ContextPack 的 localNow/localTime 为准。',
      '使用检索到的记忆时，不要解释来源；如果 relativeTimeResults 未命中，不要编造具体过去事件。',
      'sessionAnchors 描述当前 Hermes session 的边界消息；用户询问当前对话的开场、最近发言或回顾顺序时，优先使用这些锚点。',
      'memories 已按相关性、重要性、置信度、新鲜度和 suppressedMemories 预算筛选；active 不代表每轮都必须提及。',
      conversationPacing.topicShiftCommentAllowed
        ? '用户在短间隔内切换话题时，可以轻描淡写地承接；但只有在确实有助于氛围时才评论话题变化。'
        : '用户在较长间隔后发送新问题时，将其视为自然开启的新话题；不要评论“话题突然”“怎么突然问这个”或追问为什么换话题，直接回答当前问题。',
    ],
  };
}

export function renderContextPackInstructions(contextPack: ContextPack): string {
  const renderAnchor = (label: string, message?: ChatMessage) => (
    message ? `- ${label}: [${message.role}] ${message.content}` : `- ${label}: 无`
  );
  const memories = contextPack.memories.map((memory) => `- [${memory.scope}] ${memory.content}`).join('\n') || '- 无';
  const suppressed = contextPack.suppressedMemories.map((memory, index) => (
    contextPack.suppressionDisclosureAllowed
      ? `- suppressed_topic_${index + 1}: ${memory.pattern}${memory.reason ? `; reason: ${memory.reason}` : ''}`
      : `- suppressed_topic_${index + 1}: active boundary; matching records are filtered before injection${memory.reason ? `; reason: ${memory.reason}` : ''}`
  )).join('\n') || '- 无';
  const activity = contextPack.activityLogs.map((entry) => {
    const local = formatLocalDateTime(new Date(entry.happenedAt), contextPack.time.timezone).localNow;
    return `- [local ${local} ${contextPack.time.timezone}; utc ${entry.happenedAt}] ${entry.summary}`;
  }).join('\n') || '- 无';
  const recent = contextPack.recentMessages.map((message) => `- ${message.role}: ${message.content}`).join('\n') || '- 无';
  const hints = contextPack.continuityHints.map((hint) => `- [${hint.kind}] ${hint.message}`).join('\n') || '- 无';
  const sceneProjection = contextPack.sceneProjection
    ? `- ${contextPack.sceneProjection.summary}`
    : '- 无';
  const relative = contextPack.relativeTimeResults.map((result) => {
    const activities = result.activityLogs.map((entry) => `[activity] ${entry.summary}`).join('；');
    const memories = result.memories.map((memory) => `[memory] ${memory.content}`).join('；');
    const messages = result.messages.map((message) => `[${message.role}] ${message.content}`).join('；');
    const content = [activities, memories, messages].filter(Boolean).join('；') || '未命中';
    return `- ${result.label}: ${content}`;
  }).join('\n') || '- 无';

  return [
    '<BubbleTownContextPack>',
    `storylineId: ${contextPack.storylineId}`,
    `characterId: ${contextPack.characterId}`,
    `hermesProfileId: ${contextPack.hermesProfileId}`,
    `now: ${contextPack.time.now}`,
    `timezone: ${contextPack.time.timezone}`,
    `localNow: ${contextPack.time.localNow}`,
    `localDate: ${contextPack.time.localDate}`,
    `localTime: ${contextPack.time.localTime}`,
    `today: ${contextPack.time.today.join(' ~ ')}`,
    `yesterday: ${contextPack.time.yesterday.join(' ~ ')}`,
    `dayBeforeYesterday: ${contextPack.time.dayBeforeYesterday.join(' ~ ')}`,
    `lastNight: ${contextPack.time.lastNight.join(' ~ ')}`,
    `tonight: ${contextPack.time.tonight.join(' ~ ')}`,
    `elapsedSinceLastInteraction: ${contextPack.time.elapsedSinceLastInteraction ?? 'unknown'}`,
    `continuityMode: ${contextPack.continuityMode}`,
    `conversationPacing: topicShiftCommentAllowed=${contextPack.conversationPacing.topicShiftCommentAllowed}; windowMinutes=${contextPack.conversationPacing.topicShiftCommentWindowMinutes}; elapsedMs=${contextPack.conversationPacing.elapsedMs ?? 'unknown'}`,
    'systemInstructions:',
    ...contextPack.systemInstructions.map((instruction) => `- ${instruction}`),
    'continuityHints:',
    hints,
    'sceneProjection:',
    sceneProjection,
    'sessionAnchors:',
    `- messageCount: ${contextPack.sessionAnchors.messageCount}`,
    renderAnchor('firstUserMessage', contextPack.sessionAnchors.firstUserMessage),
    renderAnchor('firstAssistantMessage', contextPack.sessionAnchors.firstAssistantMessage),
    renderAnchor('latestUserMessage', contextPack.sessionAnchors.latestUserMessage),
    renderAnchor('latestAssistantMessage', contextPack.sessionAnchors.latestAssistantMessage),
    'memories:',
    memories,
    'suppressedMemories:',
    suppressed,
    'activityLogs:',
    activity,
    'relativeTimeResults:',
    relative,
    'recentMessages:',
    recent,
    '</BubbleTownContextPack>',
  ].join('\n');
}
