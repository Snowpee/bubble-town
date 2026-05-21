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
  MemoriesResponse,
  MemoryRecord,
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

export function archiveStoryline(id: string) {
  return apiPost<Storyline>(`/api/storylines/${encodeURIComponent(id)}/archive`, {});
}

export function previewContextPack(storylineId: string) {
  return apiPost<ContextPreviewResponse>('/api/context/preview', { storylineId });
}

export function sendStorylineChat(request: StorylineChatRequest) {
  return apiPost<StorylineChatResponse>(`/api/storylines/${encodeURIComponent(request.storylineId)}/chat/respond`, request);
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
  state: { sessionId?: string; responseId?: string; model: string; output: string; runtimeSessionId?: string },
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
    const payload = JSON.parse(rawData) as ChatStreamCompleteEvent & { runtimeSessionId?: string };
    state.sessionId = payload.sessionId || payload.conversation || state.sessionId;
    state.responseId = payload.responseId || state.responseId;
    state.runtimeSessionId = payload.runtimeSessionId || state.runtimeSessionId;
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

  return {
    sessionId: state.sessionId ?? '',
    conversation: state.sessionId ?? '',
    responseId: state.responseId,
    id: state.sessionId ?? '',
    output: state.output,
    model: state.model,
    storylineId: request.storylineId,
    runtimeSessionId: state.runtimeSessionId,
  };
}
