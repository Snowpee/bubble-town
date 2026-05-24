import type {
  ActiveStorylineResponse,
  ActivityLog,
  ActivityLogsResponse,
  Character,
  CharactersResponse,
  ContextPreviewResponse,
  CreateActivityLogRequest,
  CreateCharacterRequest,
  CreateMemoryRequest,
  CreateStorylineRequest,
  CreateSuppressedMemoryRequest,
  CorrectMemoryRequest,
  CorrectMemoryResponse,
  MemoriesResponse,
  MemoryConsolidationResult,
  MemoryRecord,
  ProfileContinuityValidationResponse,
  RelativeTimeSearchResponse,
  SuppressedMemoriesResponse,
  SuppressedMemory,
  Storyline,
  StorylineChatRequest,
  StorylineChatResponse,
  StorylinesResponse,
  UpdateActivityLogRequest,
  UpdateCharacterRequest,
  UpdateMemoryRequest,
  UpdateStorylineRequest,
  WorldStateDebugTrace,
} from '@bubble-town/shared';
import { apiDelete, apiGet, apiPatch, apiPost, COMPANION_URL } from './client';
import type {
  ChatResponse,
  ChatStreamCompleteEvent,
  ChatStreamDeltaEvent,
  ChatStreamErrorEvent,
  ChatStreamStartEvent,
  ChatStreamToolProgressEvent,
} from '@bubble-town/shared';

type WorldStateLogSource = 'send' | 'stream' | 'preview';

function getWorldStateTraceChannel(trace: WorldStateDebugTrace): 'auxiliary' | 'legacy' {
  return trace.executionMode === 'auxiliary_async' || trace.auxiliaryLlm?.enabledForTurn ? 'auxiliary' : 'legacy';
}

function buildWorldStateLogPrefix(
  trace: WorldStateDebugTrace,
  context: {
    source: WorldStateLogSource;
    storylineId: string;
  },
  segment?: string,
) {
  const base = `[BubbleTown][WorldState][${getWorldStateTraceChannel(trace)}][${context.source}]`;
  return segment ? `${base}[${segment}]` : `${base} storyline=${context.storylineId}`;
}

function logWorldStateNode(
  trace: WorldStateDebugTrace,
  context: {
    source: WorldStateLogSource;
    storylineId: string;
  },
  node: string,
  payload: {
    input?: unknown;
    output?: unknown;
    status?: unknown;
    skippedReason?: string | null;
    error?: string | null;
  },
) {
  if (
    payload.input === undefined
    && payload.output === undefined
    && payload.status === undefined
    && payload.skippedReason === undefined
    && payload.error === undefined
  ) {
    return;
  }

  console.groupCollapsed(buildWorldStateLogPrefix(trace, context, node));
  console.debug('input', payload.input ?? null);
  console.debug('output', payload.output ?? null);
  if (payload.status !== undefined) {
    console.debug('status', payload.status);
  }
  if (payload.skippedReason !== undefined) {
    console.debug('skippedReason', payload.skippedReason ?? null);
  }
  if (payload.error !== undefined) {
    console.debug('error', payload.error ?? null);
  }
  console.groupEnd();
}

function logWorldStateDebugTrace(trace: WorldStateDebugTrace | undefined, context: {
  source: WorldStateLogSource;
  storylineId: string;
  responseId?: string;
  previewInput?: string;
  sceneProjection?: ContextPreviewResponse['contextPack']['sceneProjection'];
  recentMessages?: ContextPreviewResponse['contextPack']['recentMessages'];
}) {
  if (!trace) {
    return;
  }

  console.groupCollapsed(buildWorldStateLogPrefix(trace, context));
  console.debug('storylineId', context.storylineId);
  console.debug('responseId', context.responseId ?? null);
  console.debug('processingStatus', trace.processingStatus);
  console.debug('processingPath', trace.processingPath ?? null);
  console.debug('executionMode', trace.executionMode ?? null);
  console.debug('channel', getWorldStateTraceChannel(trace));
  console.debug('lastUpdatedAt', trace.lastUpdatedAt ?? null);
  console.debug('latestEvent', trace.events?.at(-1) ?? null);
  console.debug('previewInput', context.previewInput ?? null);
  console.debug('sceneProjection', context.sceneProjection ?? null);
  console.debug('recentMessages', context.recentMessages ?? null);

  logWorldStateNode(trace, context, 'turn', {
    input: {
      userInput: trace.userInput,
      assistantOutput: trace.assistantOutput,
      sourceMessageIds: trace.sourceMessageIds ?? [],
    },
    output: {
      updated: trace.updated,
      processingStatus: trace.processingStatus,
      processingPath: trace.processingPath ?? null,
      executionMode: trace.executionMode ?? null,
      auxiliaryLlm: trace.auxiliaryLlm ?? null,
    },
    skippedReason: trace.skippedReason ?? null,
    error: trace.error ?? null,
  });

  logWorldStateNode(trace, context, 'reject-policy', {
    input: {
      userInput: trace.userInput,
      assistantOutput: trace.assistantOutput,
    },
    output: trace.rejectDecision ?? { rejected: false },
    skippedReason: trace.rejectDecision?.reason ?? trace.skippedReason ?? null,
  });

  logWorldStateNode(trace, context, 'gate', {
    input: trace.gatingRequest,
    output: trace.gatingResponse,
    status: trace.events?.filter((event) => event.phase === 'gate_started' || event.phase === 'gate_completed') ?? [],
    skippedReason: trace.gatingResponse?.reason ?? null,
    error: trace.error?.includes('gating') ? trace.error : null,
  });

  logWorldStateNode(trace, context, 'extractor', {
    input: trace.llmRequest,
    output: trace.llmResponse,
    status: trace.events?.filter((event) => event.phase === 'extractor_started' || event.phase === 'extractor_completed') ?? [],
    skippedReason: trace.llmResponse?.candidates?.length === 0 ? trace.skippedReason ?? null : null,
  });

  logWorldStateNode(trace, context, 'apply', {
    input: {
      candidates: trace.processingPath === 'direct_apply'
        ? trace.gatingResponse?.candidates ?? []
        : trace.llmResponse?.candidates ?? [],
      sceneProjectionBefore: trace.sceneProjectionBefore ?? null,
    },
    output: {
      applyResults: trace.applyResults,
      updated: trace.updated,
      sceneProjectionAfter: trace.sceneProjectionAfter ?? null,
    },
    status: trace.events?.filter((event) => event.phase === 'apply_completed' || event.phase === 'completed') ?? [],
    error: trace.applyResults.some((result) => result.outcome === 'error') ? '存在 apply error，详见 applyResults。' : null,
  });

  logWorldStateNode(trace, context, 'timeline', {
    output: trace.events ?? [],
    status: {
      latestEvent: trace.events?.at(-1) ?? null,
      processingStatus: trace.processingStatus,
    },
  });

  console.groupEnd();
}

function logContextPreviewWorldState(response: ContextPreviewResponse, storylineId: string, input?: string) {
  if (response.worldStateDebug) {
    logWorldStateDebugTrace(response.worldStateDebug, {
      source: 'preview',
      storylineId,
      previewInput: input,
      sceneProjection: response.contextPack.sceneProjection,
      recentMessages: response.contextPack.recentMessages,
    });
    return;
  }

  console.groupCollapsed(`[BubbleTown][WorldState][preview] storyline=${storylineId}`);
  console.debug('input', input ?? null);
  console.debug('sceneProjection', response.contextPack.sceneProjection ?? null);
  console.debug('recentMessages', response.contextPack.recentMessages);
  console.debug('latestWorldStateDebug', null);
  console.groupEnd();
}

export function fetchCharacters() {
  return apiGet<CharactersResponse>('/api/characters');
}

export function createCharacter(request: CreateCharacterRequest) {
  return apiPost<Character>('/api/characters', request);
}

export function updateCharacter(id: string, request: UpdateCharacterRequest) {
  return apiPatch<Character>(`/api/characters/${encodeURIComponent(id)}`, request);
}

export function fetchStorylines() {
  return apiGet<StorylinesResponse>('/api/storylines');
}

export function fetchActiveStoryline() {
  return apiGet<ActiveStorylineResponse>('/api/storylines/active');
}

export function createStoryline(request: CreateStorylineRequest) {
  return apiPost<Storyline>('/api/storylines', request);
}

export function updateStoryline(id: string, request: UpdateStorylineRequest) {
  return apiPatch<Storyline>(`/api/storylines/${encodeURIComponent(id)}`, request);
}

export function setActiveStoryline(id: string) {
  return apiPost<ActiveStorylineResponse>(`/api/storylines/${encodeURIComponent(id)}/set-active`, {});
}

export function activateStorylineForProfile(profileId: string) {
  return apiPost<ActiveStorylineResponse>('/api/storylines/activate-profile', { profileId });
}

export function archiveStoryline(id: string) {
  return apiPost<Storyline>(`/api/storylines/${encodeURIComponent(id)}/archive`, {});
}

export function previewContextPack(storylineId: string, input?: string) {
  return apiPost<ContextPreviewResponse>('/api/context/preview', { storylineId, input })
    .then((response) => {
      logContextPreviewWorldState(response, storylineId, input);
      return response;
    });
}

export function sendStorylineChat(request: StorylineChatRequest) {
  return apiPost<StorylineChatResponse>(`/api/storylines/${encodeURIComponent(request.storylineId)}/chat/respond`, request)
    .then((response) => {
      logWorldStateDebugTrace(response.worldStateDebug, {
        source: 'send',
        storylineId: response.storylineId,
        responseId: response.responseId,
      });
      return response;
    });
}

export function fetchStorylineMemories(storylineId: string) {
  return apiGet<MemoriesResponse>(`/api/storylines/${encodeURIComponent(storylineId)}/memories`);
}

export function createStorylineMemory(storylineId: string, request: CreateMemoryRequest) {
  return apiPost<MemoryRecord>(`/api/storylines/${encodeURIComponent(storylineId)}/memories`, request);
}

export function updateMemory(id: string, request: UpdateMemoryRequest) {
  return apiPatch<MemoryRecord>(`/api/memories/${encodeURIComponent(id)}`, request);
}

export function hideMemory(id: string) {
  return apiPost<MemoryRecord>(`/api/memories/${encodeURIComponent(id)}/hide`, {});
}

export function deleteMemory(id: string) {
  return apiPost<MemoryRecord>(`/api/memories/${encodeURIComponent(id)}/delete`, {});
}

export function restoreMemory(id: string) {
  return apiPost<MemoryRecord>(`/api/memories/${encodeURIComponent(id)}/restore`, {});
}

export function correctMemory(id: string, request: CorrectMemoryRequest) {
  return apiPost<CorrectMemoryResponse>(`/api/memories/${encodeURIComponent(id)}/correct`, request);
}

export function consolidateStorylineMemory(storylineId: string, activityLimit?: number) {
  return apiPost<MemoryConsolidationResult>(`/api/storylines/${encodeURIComponent(storylineId)}/memory/consolidate`, { activityLimit });
}

export function fetchSuppressedMemories(storylineId: string) {
  return apiGet<SuppressedMemoriesResponse>(`/api/storylines/${encodeURIComponent(storylineId)}/suppressed-memories`);
}

export function createSuppressedMemory(storylineId: string, request: CreateSuppressedMemoryRequest) {
  return apiPost<SuppressedMemory>(`/api/storylines/${encodeURIComponent(storylineId)}/suppressed-memories`, request);
}

export function deleteSuppressedMemory(id: string) {
  return apiDelete<{ success: boolean }>(`/api/suppressed-memories/${encodeURIComponent(id)}`);
}

export function fetchActivityLogs(storylineId: string) {
  return apiGet<ActivityLogsResponse>(`/api/storylines/${encodeURIComponent(storylineId)}/activity`);
}

export function createActivityLog(storylineId: string, request: CreateActivityLogRequest) {
  return apiPost<ActivityLog>(`/api/storylines/${encodeURIComponent(storylineId)}/activity`, request);
}

export function updateActivityLog(id: string, request: UpdateActivityLogRequest) {
  return apiPatch<ActivityLog>(`/api/activity/${encodeURIComponent(id)}`, request);
}

export function hideActivityLog(id: string) {
  return apiPost<ActivityLog>(`/api/activity/${encodeURIComponent(id)}/hide`, {});
}

export function searchStorylineRelativeTime(storylineId: string, input: string) {
  return apiPost<RelativeTimeSearchResponse>(`/api/storylines/${encodeURIComponent(storylineId)}/relative-time-search`, { input });
}

export function validateStorylineProfileContinuity(storylineId: string) {
  return apiPost<ProfileContinuityValidationResponse>(`/api/storylines/${encodeURIComponent(storylineId)}/profile/validate-continuity`, {});
}

interface StreamStorylineChatHandlers {
  onStart?: (event: ChatStreamStartEvent & { storylineId: string; runtimeSessionId: string }) => void;
  onDelta?: (event: ChatStreamDeltaEvent) => void;
  onToolProgress?: (event: ChatStreamToolProgressEvent) => void;
  onComplete?: (event: ChatStreamCompleteEvent & { storylineId: string; runtimeSessionId: string }) => void;
  onError?: (event: ChatStreamErrorEvent) => void;
}

interface StreamStorylineChatOptions {
  signal?: AbortSignal;
}

function processSseEvent(
  rawEvent: string,
  state: { sessionId?: string; responseId?: string; model: string; output: string; runtimeSessionId?: string; worldStateDebug?: WorldStateDebugTrace },
  handlers: StreamStorylineChatHandlers,
) {
  const lines = rawEvent.split('\n').filter(Boolean);
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }

  const rawData = dataLines.join('\n');
  if (!rawData) {
    return;
  }

  if (eventName === 'message-start') {
    const payload = JSON.parse(rawData) as ChatStreamStartEvent & { runtimeSessionId?: string };
    state.sessionId = payload.sessionId || payload.conversation;
    state.responseId = payload.responseId;
    state.runtimeSessionId = payload.runtimeSessionId;
    state.model = payload.model || state.model;
    handlers.onStart?.(payload as ChatStreamStartEvent & { storylineId: string; runtimeSessionId: string });
    return;
  }

  if (eventName === 'message-delta') {
    const payload = JSON.parse(rawData) as ChatStreamDeltaEvent;
    state.output += payload.delta;
    handlers.onDelta?.(payload);
    return;
  }

  if (eventName === 'message-complete') {
    const payload = JSON.parse(rawData) as ChatStreamCompleteEvent & { runtimeSessionId?: string; worldStateDebug?: WorldStateDebugTrace };
    state.sessionId = payload.sessionId || payload.conversation || state.sessionId;
    state.responseId = payload.responseId || state.responseId;
    state.runtimeSessionId = payload.runtimeSessionId || state.runtimeSessionId;
    state.worldStateDebug = payload.worldStateDebug || state.worldStateDebug;
    state.model = payload.model || state.model;
    state.output = payload.output || state.output;
    handlers.onComplete?.(payload as ChatStreamCompleteEvent & { storylineId: string; runtimeSessionId: string });
    return;
  }

  if (eventName === 'message-error') {
    const payload = JSON.parse(rawData) as ChatStreamErrorEvent;
    handlers.onError?.(payload);
    throw new Error(payload.message);
  }

  if (eventName === 'tool-progress') {
    const payload = JSON.parse(rawData) as ChatStreamToolProgressEvent;
    handlers.onToolProgress?.(payload);
  }
}

export async function streamStorylineChat(
  request: StorylineChatRequest,
  handlers: StreamStorylineChatHandlers = {},
  options: StreamStorylineChatOptions = {},
): Promise<ChatResponse & { storylineId: string; runtimeSessionId?: string }> {
  const response = await fetch(`${COMPANION_URL}/api/storylines/${encodeURIComponent(request.storylineId)}/chat/respond-stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  if (!response.body) {
    throw new Error('Streaming response body is empty.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const state = {
    sessionId: undefined as string | undefined,
    responseId: undefined as string | undefined,
    runtimeSessionId: undefined as string | undefined,
    worldStateDebug: undefined as WorldStateDebugTrace | undefined,
    model: 'hermes-agent',
    output: '',
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (buffer.includes('\n\n')) {
      const separatorIndex = buffer.indexOf('\n\n');
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      if (rawEvent.trim()) {
        processSseEvent(rawEvent, state, handlers);
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    processSseEvent(buffer, state, handlers);
  }

  logWorldStateDebugTrace(state.worldStateDebug, {
    source: 'stream',
    storylineId: request.storylineId,
    responseId: state.responseId,
  });

  return {
    sessionId: state.sessionId ?? '',
    conversation: state.sessionId ?? '',
    responseId: state.responseId,
    id: state.sessionId ?? '',
    output: state.output,
    model: state.model,
    storylineId: request.storylineId,
    runtimeSessionId: state.runtimeSessionId,
    ...(state.worldStateDebug ? { worldStateDebug: state.worldStateDebug } : {}),
  };
}
