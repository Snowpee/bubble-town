import type {
  ChatRequest,
  ChatResponse,
  ChatStreamCompleteEvent,
  ChatStreamDeltaEvent,
  ChatStreamErrorEvent,
  ChatStreamStartEvent,
  ChatStreamToolProgressEvent,
  HealthResponse,
  SessionDetail,
  SessionSummary,
} from '@bubble-town/shared';
import { DEFAULT_PROFILE_ID } from '@bubble-town/shared';
import { apiDelete, apiGet, apiPost, COMPANION_URL } from './client';

export function fetchHealth() {
  return apiGet<HealthResponse>('/api/health');
}

export function fetchSessions(profileId?: string) {
  const query = `?profileId=${encodeURIComponent(profileId || DEFAULT_PROFILE_ID)}`;
  return apiGet<{ sessions: SessionSummary[] }>(`/api/sessions${query}`);
}

export function fetchSessionDetail(sessionId: string, profileId?: string) {
  const query = `?profileId=${encodeURIComponent(profileId || DEFAULT_PROFILE_ID)}`;
  return apiGet<SessionDetail>(`/api/sessions/${encodeURIComponent(sessionId)}${query}`);
}

export function fetchSessionSummary(sessionId: string, profileId?: string) {
  const query = `?profileId=${encodeURIComponent(profileId || DEFAULT_PROFILE_ID)}`;
  return apiGet<SessionSummary>(`/api/sessions/${encodeURIComponent(sessionId)}/summary${query}`);
}

export function deleteSession(sessionId: string, profileId?: string) {
  const query = `?profileId=${encodeURIComponent(profileId || DEFAULT_PROFILE_ID)}`;
  return apiDelete<{ success: boolean }>(`/api/sessions/${encodeURIComponent(sessionId)}${query}`);
}

export function sendChat(request: ChatRequest) {
  return apiPost<ChatResponse>('/api/chat/respond', request);
}

interface StreamChatHandlers {
  onStart?: (event: ChatStreamStartEvent) => void;
  onDelta?: (event: ChatStreamDeltaEvent) => void;
  onToolProgress?: (event: ChatStreamToolProgressEvent) => void;
  onComplete?: (event: ChatStreamCompleteEvent) => void;
  onError?: (event: ChatStreamErrorEvent) => void;
}

interface StreamChatOptions {
  signal?: AbortSignal;
}

function processSseEvent(
  rawEvent: string,
  state: { sessionId?: string; responseId?: string; model: string; output: string },
  handlers: StreamChatHandlers,
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
    const payload = JSON.parse(rawData) as ChatStreamStartEvent;
    state.sessionId = payload.sessionId || payload.conversation;
    state.responseId = payload.responseId;
    state.model = payload.model || state.model;
    handlers.onStart?.(payload);
    return;
  }

  if (eventName === 'message-delta') {
    const payload = JSON.parse(rawData) as ChatStreamDeltaEvent;
    state.output += payload.delta;
    handlers.onDelta?.(payload);
    return;
  }

  if (eventName === 'message-complete') {
    const payload = JSON.parse(rawData) as ChatStreamCompleteEvent;
    state.sessionId = payload.sessionId || payload.conversation || state.sessionId;
    state.responseId = payload.responseId || state.responseId;
    state.model = payload.model || state.model;
    state.output = payload.output || state.output;
    handlers.onComplete?.(payload);
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

export async function streamChat(
  request: ChatRequest,
  handlers: StreamChatHandlers = {},
  options: StreamChatOptions = {},
): Promise<ChatResponse> {
  const response = await fetch(`${COMPANION_URL}/api/chat/respond-stream`, {
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
    sessionId: request.sessionId,
    responseId: request.responseId,
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
    sessionId: state.sessionId ?? request.sessionId ?? '',
    conversation: state.sessionId ?? request.sessionId ?? '',
    responseId: state.responseId ?? request.responseId,
    id: state.sessionId ?? request.sessionId ?? '',
    output: state.output,
    model: state.model,
  };
}
