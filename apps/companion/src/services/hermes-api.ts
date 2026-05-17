import fs from 'node:fs';
import YAML from 'yaml';
import type {
  ChatImageAttachment,
  ChatMessage,
  ChatMode,
  ChatRequest,
  ChatResponse,
  ChatStreamCompleteEvent,
  ChatStreamStartEvent,
  ChatStreamToolProgressEvent,
} from '@bubble-town/shared';
import { DEFAULT_PROFILE_ID, getConfigPath, getSessionFilePath, getSessionsDir } from './hermes-paths.js';
import { isManagedHermesGatewayProfile } from './hermes-gateway.js';
import { getSessionDetail, getSessionIdForResponse, getSessionSummary } from './session-store.js';

interface TranscriptMessage {
  id?: string;
  role?: string;
  content?: unknown;
  created_at?: string;
  attachments?: ChatImageAttachment[];
  tool_events?: ChatStreamToolProgressEvent[];
}

interface SessionTranscript {
  session_id?: string;
  conversation?: string;
  response_id?: string;
  model?: string;
  base_url?: string;
  platform?: string;
  session_start?: string;
  last_updated?: string;
  system_prompt?: string;
  tools?: unknown[];
  message_count?: number;
  messages?: TranscriptMessage[];
}

interface ChatTurnContext {
  profileId: string;
  sessionId?: string;
  responseId?: string;
  transcriptKey?: string;
  transcript?: SessionTranscript;
  model: string;
  systemPrompt?: string;
  useSessionContinuationHeader?: boolean;
}

interface PersistedTurn {
  sessionId?: string;
}

interface StreamChatHandlers {
  onStart?: (event: ChatStreamStartEvent) => void;
  onDelta?: (delta: string) => void;
  onToolProgress?: (event: ChatStreamToolProgressEvent) => void;
  onComplete?: (event: ChatStreamCompleteEvent) => void;
}

interface StreamChatOptions {
  signal?: AbortSignal;
}

interface PersistOptions {
  sessionId?: string;
  responseId?: string;
  mode: ChatMode;
}

type JsonRecord = Record<string, unknown>;

interface MessageParts {
  text: string;
  attachments: ChatImageAttachment[];
}

interface HermesProfileRuntime {
  model: string;
  systemPrompt?: string;
}

function getHermesApiBaseUrl(): string {
  return process.env.HERMES_API_BASE_URL ?? 'http://127.0.0.1:8642/v1';
}

function resolveProfileRuntime(profileId = DEFAULT_PROFILE_ID): HermesProfileRuntime {
  if (isManagedHermesGatewayProfile(profileId)) {
    return {
      model: 'hermes-agent',
    };
  }

  const configPath = getConfigPath(profileId);
  const runtime: HermesProfileRuntime = {
    model: 'hermes-agent',
  };

  if (!fs.existsSync(configPath)) {
    return runtime;
  }

  try {
    const parsed = YAML.parse(fs.readFileSync(configPath, 'utf8')) as {
      model?: { default?: unknown };
      agent?: { system_prompt?: unknown };
    } | null;

    if (typeof parsed?.model?.default === 'string' && parsed.model.default.trim()) {
      runtime.model = parsed.model.default.trim();
    }

    if (typeof parsed?.agent?.system_prompt === 'string' && parsed.agent.system_prompt.trim()) {
      runtime.systemPrompt = parsed.agent.system_prompt;
    }
  } catch {
    return runtime;
  }

  return runtime;
}

function getChatMode(mode?: ChatMode): ChatMode {
  return mode ?? 'responses';
}

function getRequestPath(mode?: ChatMode): string {
  return getChatMode(mode) === 'chat-completions' ? '/chat/completions' : '/responses';
}

function resolveEffectiveChatMode(request: ChatRequest, requestedMode: ChatMode): ChatMode {
  if (requestedMode !== 'responses' || request.responseId) {
    return requestedMode;
  }

  const sessionId = resolveRequestSessionId(request);
  if (!sessionId) {
    return requestedMode;
  }

  const summary = getSessionSummary(sessionId, request.profileId);
  return summary?.source === 'cli' ? 'chat-completions' : requestedMode;
}

function resolveRequestSessionId(request: ChatRequest): string | undefined {
  const compatibilityRequest = request as ChatRequest & { conversation?: string };
  return request.sessionId ?? compatibilityRequest.conversation;
}

function normalizeImageAttachments(value: unknown): ChatImageAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const attachment = item as Partial<ChatImageAttachment>;
    if (attachment.type !== 'image' || typeof attachment.url !== 'string' || !attachment.url.trim()) {
      return [];
    }

    return [
      {
        type: 'image' as const,
        url: attachment.url,
        mimeType: typeof attachment.mimeType === 'string' ? attachment.mimeType : undefined,
        name: typeof attachment.name === 'string' ? attachment.name : undefined,
      },
    ];
  });
}

function dedupeAttachments(attachments: ChatImageAttachment[]): ChatImageAttachment[] {
  const seen = new Set<string>();
  return attachments.filter((attachment) => {
    const identity = `${attachment.url}|${attachment.name ?? ''}`;
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  });
}

function extractMessageParts(content: unknown, fallbackAttachments?: unknown): MessageParts {
  const attachments = [...normalizeImageAttachments(fallbackAttachments)];

  if (typeof content === 'string') {
    return { text: content, attachments: dedupeAttachments(attachments) };
  }

  if (Array.isArray(content)) {
    const textSegments: string[] = [];

    for (const item of content) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const record = item as JsonRecord;
      const type = typeof record.type === 'string' ? record.type : undefined;

      if ((type === 'text' || type === 'input_text' || type === 'output_text') && typeof record.text === 'string') {
        textSegments.push(record.text);
        continue;
      }

      if (type === 'image_url') {
        const imagePayload =
          record.image_url && typeof record.image_url === 'object' ? (record.image_url as JsonRecord) : undefined;
        const url = typeof imagePayload?.url === 'string' ? imagePayload.url : undefined;
        if (url) {
          attachments.push({ type: 'image', url });
        }
        continue;
      }

      if (type === 'input_image' && typeof record.image_url === 'string') {
        attachments.push({ type: 'image', url: record.image_url });
        continue;
      }

      if ('content' in record) {
        const nested = extractMessageParts(record.content, record.attachments);
        if (nested.text) {
          textSegments.push(nested.text);
        }
        attachments.push(...nested.attachments);
        continue;
      }

      if (typeof record.text === 'string') {
        textSegments.push(record.text);
      }
    }

    return {
      text: textSegments.filter(Boolean).join('\n'),
      attachments: dedupeAttachments(attachments),
    };
  }

  if (content && typeof content === 'object') {
    if ('text' in content && typeof content.text === 'string') {
      return { text: content.text, attachments: dedupeAttachments(attachments) };
    }

    if ('content' in content) {
      return extractMessageParts(content.content, fallbackAttachments);
    }

    if ('arguments' in content && typeof content.arguments === 'string') {
      return { text: content.arguments, attachments: dedupeAttachments(attachments) };
    }
  }

  return { text: '', attachments: dedupeAttachments(attachments) };
}

function normalizeContent(content: unknown, fallbackAttachments?: unknown): string {
  return extractMessageParts(content, fallbackAttachments).text;
}

function buildResponsesInput(request: ChatRequest): string | Array<{ role: 'user'; content: Array<Record<string, unknown>> }> {
  if (!request.attachments?.length) {
    return request.input;
  }

  return [
    {
      role: 'user',
      content: [
        ...(request.input
          ? [
              {
                type: 'input_text',
                text: request.input,
              },
            ]
          : []),
        ...request.attachments.map((attachment) => ({
          type: 'input_image',
          image_url: attachment.url,
        })),
      ],
    },
  ];
}

function toChatCompletionContent(text: string, attachments?: ChatImageAttachment[]) {
  if (!attachments?.length) {
    return text;
  }

  return [
    ...(text
      ? [
          {
            type: 'text',
            text,
          },
        ]
      : []),
    ...attachments.map((attachment) => ({
      type: 'image_url',
      image_url: {
        url: attachment.url,
      },
    })),
  ];
}

function summarizeText(value: string, maxLength = 120): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1)}...`;
}

function createTranscriptMessage(
  id: string,
  role: string,
  content: string,
  createdAt: string,
  toolEvents?: ChatStreamToolProgressEvent[],
  attachments?: ChatImageAttachment[],
): TranscriptMessage {
  return {
    id,
    role,
    content,
    created_at: createdAt,
    ...(attachments?.length ? { attachments } : {}),
    ...(toolEvents?.length ? { tool_events: toolEvents } : {}),
  };
}

function createEmptyTranscript(now: string, sessionId: string, runtime?: HermesProfileRuntime): SessionTranscript {
  return {
    session_id: sessionId,
    model: runtime?.model ?? 'hermes-agent',
    base_url: getHermesApiBaseUrl(),
    platform: 'api-server',
    session_start: now,
    last_updated: now,
    ...(runtime?.systemPrompt ? { system_prompt: runtime.systemPrompt } : {}),
    message_count: 0,
    messages: [],
  };
}

function ensureTranscriptExists(
  profileId: string,
  sessionId: string,
  transcript: SessionTranscript | undefined,
  now: string,
  runtime?: HermesProfileRuntime,
) {
  if (transcript) {
    return transcript;
  }

  const created = createEmptyTranscript(now, sessionId, runtime);
  writeTranscript(profileId, sessionId, created);
  return created;
}

function mapTranscriptToChatMessages(transcript: SessionTranscript, sessionId: string, now: string): ChatMessage[] {
  return (transcript.messages ?? [])
    .map((message, index) => {
      const parts = extractMessageParts(message.content, message.attachments);
      return {
        id: message.id ?? `${sessionId}-${index + 1}`,
        role: (message.role as ChatMessage['role']) ?? 'assistant',
        content: parts.text,
        attachments: parts.attachments.length ? parts.attachments : undefined,
        createdAt: message.created_at ?? transcript.session_start ?? now,
        toolEvents: Array.isArray(message.tool_events) ? message.tool_events : undefined,
      };
    })
    .filter((message) => message.role === 'system' || message.role === 'user' || message.role === 'assistant');
}

function toChatCompletionMessages(
  messages: ChatMessage[],
  input: string,
  attachments?: ChatImageAttachment[],
  systemPrompt?: string,
) {
  return [
    ...(systemPrompt
      ? [
          {
            role: 'system' as const,
            content: systemPrompt,
          },
        ]
      : []),
    ...messages.map((message) => ({
      role: message.role,
      content: toChatCompletionContent(message.content, message.attachments),
    })),
    {
      role: 'user' as const,
      content: toChatCompletionContent(input, attachments),
    },
  ];
}

function buildChatCompletionPayload(context: ChatTurnContext, request: ChatRequest, now: string, stream: boolean) {
  const history =
    context.transcript && context.sessionId && !context.useSessionContinuationHeader
      ? mapTranscriptToChatMessages(context.transcript, context.sessionId, now)
      : [];

  return {
    model: context.model,
    messages: toChatCompletionMessages(history, request.input, request.attachments, context.systemPrompt),
    stream,
  };
}

function buildResponsesPayload(context: ChatTurnContext, request: ChatRequest, stream: boolean): JsonRecord {
  const payload: JsonRecord = {
    model: context.model,
    input: buildResponsesInput(request),
    stream,
    store: true,
  };

  if (context.systemPrompt) {
    payload.instructions = context.systemPrompt;
  }

  if (request.responseId) {
    payload.previous_response_id = request.responseId;
  }

  return payload;
}

function buildRequestPayload(mode: ChatMode, context: ChatTurnContext, request: ChatRequest, now: string, stream: boolean) {
  if (mode === 'chat-completions') {
    return buildChatCompletionPayload(context, request, now, stream);
  }

  return buildResponsesPayload(context, request, stream);
}

function buildHermesRequestHeaders(context: ChatTurnContext): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const apiKey = process.env.HERMES_API_KEY || process.env.API_SERVER_KEY || process.env.BUBBLE_TOWN_HERMES_API_KEY;

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (context.useSessionContinuationHeader && context.sessionId) {
    headers['X-Hermes-Session-Id'] = context.sessionId;
  }

  return headers;
}

function readTranscript(profileId: string, cacheKey: string): SessionTranscript | undefined {
  const sessionFilePath = getSessionFilePath(cacheKey, profileId);
  if (!fs.existsSync(sessionFilePath)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(sessionFilePath, 'utf8')) as SessionTranscript;
  } catch {
    return undefined;
  }
}

function buildTranscriptFromDetail(sessionId: string, profileId: string): SessionTranscript | undefined {
  const detail = getSessionDetail(sessionId, profileId);
  if (!detail) {
    return undefined;
  }

  return {
    session_id: detail.summary.sessionId,
    response_id: detail.summary.responseId,
    model: 'hermes-agent',
    base_url: getHermesApiBaseUrl(),
    platform: detail.summary.source,
    session_start: detail.summary.startedAt,
    last_updated: detail.summary.updatedAt,
    message_count: detail.messages.length,
    messages: detail.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      created_at: message.createdAt,
      attachments: message.attachments,
      tool_events: message.toolEvents,
    })),
  };
}

function loadTranscript(profileId: string, sessionId: string): SessionTranscript | undefined {
  return readTranscript(profileId, sessionId) ?? buildTranscriptFromDetail(sessionId, profileId);
}

function writeTranscript(profileId: string, cacheKey: string, transcript: SessionTranscript): void {
  const sessionsDir = getSessionsDir(profileId);
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(getSessionFilePath(cacheKey, profileId), `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
}

function deleteTranscript(profileId: string, cacheKey?: string): void {
  if (!cacheKey) {
    return;
  }

  const sessionFilePath = getSessionFilePath(cacheKey, profileId);
  if (fs.existsSync(sessionFilePath)) {
    fs.unlinkSync(sessionFilePath);
  }
}

function createChatTurnContext(request: ChatRequest, mode: ChatMode): ChatTurnContext {
  const profileId = request.profileId || DEFAULT_PROFILE_ID;
  const runtime = resolveProfileRuntime(profileId);
  const managedGatewayProfile = isManagedHermesGatewayProfile(profileId);
  const sessionId = resolveRequestSessionId(request);
  const transcriptKey = sessionId;
  const now = new Date().toISOString();
  const useSessionContinuationHeader = mode === 'chat-completions' && Boolean(sessionId);
  const transcript =
    transcriptKey
      ? (mode === 'chat-completions'
          ? (managedGatewayProfile
              ? loadTranscript(profileId, transcriptKey)
              : ensureTranscriptExists(profileId, transcriptKey, loadTranscript(profileId, transcriptKey), now, runtime))
          : undefined)
      : undefined;

  return {
    profileId,
    sessionId,
    responseId: request.responseId,
    transcriptKey,
    transcript,
    model: runtime.model,
    systemPrompt: runtime.systemPrompt,
    useSessionContinuationHeader,
  };
}

function extractSessionValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value) {
    return value;
  }

  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' && value.id) {
    return value.id;
  }

  return undefined;
}

function extractSessionId(payload: JsonRecord | undefined): string | undefined {
  if (!payload) {
    return undefined;
  }

  const directSessionId = extractSessionValue(payload.session_id) ?? extractSessionValue(payload.conversation);
  if (directSessionId) {
    return directSessionId;
  }

  if (payload.response && typeof payload.response === 'object') {
    const responsePayload = payload.response as JsonRecord;
    return extractSessionValue(responsePayload.session_id) ?? extractSessionValue(responsePayload.conversation);
  }

  return undefined;
}

function resolveCanonicalSessionId(
  request: ChatRequest,
  payload?: JsonRecord,
  currentSessionId?: string,
): string | undefined {
  return extractSessionId(payload) ?? resolveRequestSessionId(request) ?? currentSessionId;
}

function persistConversationTurn(
  context: ChatTurnContext,
  request: ChatRequest,
  output: string,
  model: string,
  now: string,
  options: PersistOptions,
  toolEvents: ChatStreamToolProgressEvent[] = [],
): PersistedTurn {
  const canonicalSessionId = options.sessionId ?? context.sessionId;
  if (!canonicalSessionId) {
    return {};
  }

  if (isManagedHermesGatewayProfile(context.profileId)) {
    context.sessionId = canonicalSessionId;
    context.responseId = options.responseId ?? context.responseId;
    context.transcriptKey = canonicalSessionId;
    return {
      sessionId: canonicalSessionId,
    };
  }

  const transcript =
    readTranscript(context.profileId, canonicalSessionId) ??
    context.transcript ??
    createEmptyTranscript(now, canonicalSessionId);

  const messagePrefix = transcript.session_id ?? canonicalSessionId;
  const nextMessages = [
    ...(transcript.messages ?? []),
    createTranscriptMessage(`${messagePrefix}-user-${Date.now()}`, 'user', request.input, now, undefined, request.attachments),
  ];

  if (output.trim() || toolEvents.length) {
    nextMessages.push(
      createTranscriptMessage(`${messagePrefix}-assistant-${Date.now()}`, 'assistant', output, now, toolEvents),
    );
  }

  transcript.session_id = canonicalSessionId;
  transcript.response_id = options.responseId ?? transcript.response_id;
  transcript.model = model || context.model || transcript.model || 'hermes-agent';
  transcript.base_url = getHermesApiBaseUrl();
  transcript.platform = transcript.platform ?? (options.mode === 'responses' ? 'api-server-responses' : 'api-server');
  transcript.system_prompt = context.systemPrompt ?? transcript.system_prompt;
  transcript.session_start = transcript.session_start ?? now;
  transcript.last_updated = now;
  transcript.messages = nextMessages;
  transcript.message_count = nextMessages.length;

  writeTranscript(context.profileId, canonicalSessionId, transcript);

  if (context.transcriptKey && context.transcriptKey !== canonicalSessionId) {
    deleteTranscript(context.profileId, context.transcriptKey);
  }

  context.sessionId = canonicalSessionId;
  context.responseId = options.responseId ?? context.responseId;
  context.transcriptKey = canonicalSessionId;
  context.transcript = transcript;

  return {
    sessionId: canonicalSessionId,
  };
}

function requireSessionId(sessionId?: string): string {
  if (!sessionId) {
    throw new Error('Hermes API 未返回原生 sessionId，无法继续会话续链。');
  }

  return sessionId;
}

function resolveSessionIdFromHeaders(headers: Headers): string | undefined {
  const headerValue = headers.get('X-Hermes-Session-Id');
  return typeof headerValue === 'string' && headerValue.trim() ? headerValue.trim() : undefined;
}

function parseUpstreamEvent(rawEvent: string) {
  const normalized = rawEvent.replace(/\r/g, '');
  const lines = normalized.split('\n').filter(Boolean);
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

  return {
    eventName,
    rawData: dataLines.join('\n'),
  };
}

function safeJsonParse(rawData: string): JsonRecord | undefined {
  try {
    return JSON.parse(rawData) as JsonRecord;
  } catch {
    return undefined;
  }
}

function resolveStreamEventName(eventName: string, payload?: JsonRecord): string {
  if (eventName !== 'message') {
    return eventName;
  }

  return typeof payload?.type === 'string' ? payload.type : eventName;
}

function extractModel(payload: JsonRecord | undefined, fallback: string): string {
  if (typeof payload?.model === 'string') {
    return payload.model;
  }

  if (payload?.response && typeof payload.response === 'object' && payload.response && 'model' in payload.response) {
    const responseModel = (payload.response as JsonRecord).model;
    if (typeof responseModel === 'string') {
      return responseModel;
    }
  }

  return fallback;
}

function extractResponseId(payload: JsonRecord | undefined): string | undefined {
  if (!payload) {
    return undefined;
  }

  if (typeof payload.id === 'string' && payload.id) {
    return payload.id;
  }

  if (payload.response && typeof payload.response === 'object') {
    const responseId = (payload.response as JsonRecord).id;
    if (typeof responseId === 'string' && responseId) {
      return responseId;
    }
  }

  return undefined;
}

function extractResponseOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }

  if (!Array.isArray(output)) {
    return '';
  }

  return output
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      const content = 'content' in item ? (item as JsonRecord).content : undefined;
      return Array.isArray(content)
        ? content
            .map((part) => {
              if (!part || typeof part !== 'object') {
                return '';
              }

              const record = part as JsonRecord;
              return normalizeContent(record.text ?? record.refusal ?? record.content ?? record.arguments);
            })
            .filter(Boolean)
            .join('\n')
        : '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractCompletedOutput(payload: JsonRecord | undefined, fallback: string): string {
  if (!payload) {
    return fallback;
  }

  const directOutput = extractResponseOutput(payload.output);
  if (directOutput) {
    return directOutput;
  }

  if (payload.response && typeof payload.response === 'object') {
    const responseOutput = extractResponseOutput((payload.response as JsonRecord).output);
    if (responseOutput) {
      return responseOutput;
    }
  }

  return fallback;
}

function extractChatCompletionOutput(payload: JsonRecord | undefined): string {
  const choice = (Array.isArray(payload?.choices) ? payload?.choices[0] : undefined) as JsonRecord | undefined;
  const message = choice?.message;
  return message && typeof message === 'object' ? normalizeContent((message as JsonRecord).content) : '';
}

function extractDelta(eventName: string, payload?: JsonRecord): string {
  if (!payload) {
    return '';
  }

  if (eventName === 'response.output_text.delta' || eventName === 'response.refusal.delta') {
    return typeof payload.delta === 'string' ? payload.delta : '';
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choice = choices[0];
  if (!choice || typeof choice !== 'object') {
    return '';
  }

  const delta = (choice as JsonRecord).delta;
  if (!delta || typeof delta !== 'object') {
    return '';
  }

  return normalizeContent((delta as JsonRecord).content);
}

function isToolEventType(eventName: string): boolean {
  return (
    eventName === 'response.output_item.added' ||
    eventName === 'response.output_item.done' ||
    eventName === 'response.function_call_arguments.delta' ||
    eventName === 'response.function_call_arguments.done' ||
    eventName.includes('_call.') ||
    eventName === 'response.failed'
  );
}

function normalizeToolName(value: string): string {
  return value
    .replace(/^response\./, '')
    .replace(/_call(\..*)?$/, '')
    .replace(/_/g, ' ');
}

function extractToolStatus(payload?: JsonRecord): string | undefined {
  if (!payload) {
    return undefined;
  }

  const item = payload.item && typeof payload.item === 'object' ? (payload.item as JsonRecord) : undefined;
  const rawStatus = [payload.status, item?.status].find((value) => typeof value === 'string');
  return typeof rawStatus === 'string' ? rawStatus.toLowerCase() : undefined;
}

function toToolPhase(eventName: string, payload?: JsonRecord): ChatStreamToolProgressEvent['phase'] {
  const status = extractToolStatus(payload);

  if (
    eventName.endsWith('.completed') ||
    eventName.endsWith('.done') ||
    status === 'completed' ||
    status === 'done' ||
    status === 'succeeded' ||
    status === 'success'
  ) {
    return 'finish';
  }

  if (
    eventName.endsWith('.failed') ||
    eventName.endsWith('.error') ||
    eventName === 'response.failed' ||
    status === 'failed' ||
    status === 'error' ||
    status === 'cancelled' ||
    status === 'canceled'
  ) {
    return 'error';
  }

  if (
    eventName.endsWith('.searching') ||
    eventName.endsWith('.intermediate') ||
    eventName.endsWith('.interpreting') ||
    eventName.endsWith('.delta') ||
    eventName.endsWith('.in_progress') ||
    eventName.endsWith('.running') ||
    status === 'in_progress' ||
    status === 'running' ||
    status === 'searching' ||
    status === 'interpreting' ||
    status === 'intermediate'
  ) {
    return 'progress';
  }

  return 'start';
}

function extractToolIdentity(eventName: string, payload?: JsonRecord) {
  if (!payload) {
    return undefined;
  }

  const item = payload.item && typeof payload.item === 'object' ? (payload.item as JsonRecord) : undefined;
  const itemType = typeof item?.type === 'string' ? item.type : undefined;
  const toolName =
    (typeof payload.tool_name === 'string' && payload.tool_name) ||
    (typeof payload.name === 'string' && payload.name) ||
    (typeof item?.name === 'string' && item.name) ||
    (itemType ? normalizeToolName(itemType) : undefined) ||
    (() => {
      const match = /^response\.([a-z_]+?)(?:_call)?\./.exec(eventName);
      return match?.[1] ? normalizeToolName(match[1]) : undefined;
    })();

  const id =
    (typeof payload.item_id === 'string' && payload.item_id) ||
    (typeof payload.call_id === 'string' && payload.call_id) ||
    (typeof payload.id === 'string' && payload.id) ||
    (typeof item?.id === 'string' && item.id) ||
    (typeof payload.output_index === 'number' ? `${toolName}-${payload.output_index}` : undefined) ||
    (typeof payload.output_index === 'string' && payload.output_index ? `${toolName}-${payload.output_index}` : undefined) ||
    undefined;

  if (!toolName) {
    return undefined;
  }

  return {
    id: id ?? `${toolName}-${Date.now()}`,
    toolName,
  };
}

function extractToolMessage(eventName: string, payload?: JsonRecord): string | undefined {
  if (!payload) {
    return undefined;
  }

  const direct = [payload.message, payload.delta, payload.arguments, payload.code, payload.status]
    .map((value) => normalizeContent(value))
    .find(Boolean);
  if (direct) {
    return summarizeText(direct);
  }

  const item = payload.item && typeof payload.item === 'object' ? (payload.item as JsonRecord) : undefined;
  const itemName = normalizeContent(item?.name ?? item?.type);
  if (itemName) {
    return summarizeText(itemName);
  }

  if (eventName === 'response.output_item.added') {
    return '工具调用已开始';
  }

  if (eventName.endsWith('.searching')) {
    return '工具正在执行';
  }

  if (eventName.endsWith('.completed') || eventName.endsWith('.done')) {
    return '工具执行完成';
  }

  if (eventName.endsWith('.failed') || eventName.endsWith('.error') || eventName === 'response.failed') {
    return '工具执行失败';
  }

  return undefined;
}

function toToolProgressEvent(eventName: string, payload?: JsonRecord): ChatStreamToolProgressEvent | undefined {
  if (!isToolEventType(eventName)) {
    return undefined;
  }

  if (eventName === 'response.output_item.added') {
    const item = payload?.item && typeof payload.item === 'object' ? (payload.item as JsonRecord) : undefined;
    const itemType = typeof item?.type === 'string' ? item.type : '';
    if (!itemType.includes('call') && itemType !== 'function_call') {
      return undefined;
    }
  }

  const identity = extractToolIdentity(eventName, payload);
  if (!identity) {
    return undefined;
  }

  return {
    id: identity.id,
    toolName: identity.toolName,
    phase: toToolPhase(eventName, payload),
    message: extractToolMessage(eventName, payload),
    createdAt: new Date().toISOString(),
  };
}

function upsertToolEvent(events: ChatStreamToolProgressEvent[], event: ChatStreamToolProgressEvent) {
  const index = events.findIndex((entry) => entry.id === event.id);
  if (index === -1) {
    return [...events, event];
  }

  const nextEvents = [...events];
  nextEvents[index] = event;
  return nextEvents;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'AbortError';
  }

  return error instanceof Error && error.name === 'AbortError';
}

export async function streamChat(
  request: ChatRequest,
  handlers: StreamChatHandlers = {},
  options: StreamChatOptions = {},
): Promise<ChatResponse> {
  const mode = resolveEffectiveChatMode(request, getChatMode(request.mode));
  const context = createChatTurnContext(request, mode);
  const now = new Date().toISOString();
  const payload = buildRequestPayload(mode, context, request, now, true);
  const response = await fetch(`${getHermesApiBaseUrl()}${getRequestPath(mode)}`, {
    method: 'POST',
    headers: buildHermesRequestHeaders(context),
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Hermes API 请求失败: ${response.status}${details ? ` ${details}` : ''}`);
  }

  if (!response.body) {
    throw new Error('Hermes API 未返回可读流。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let output = '';
  let model = 'hermes-agent';
  let responseId = request.responseId;
  let sessionId = resolveSessionIdFromHeaders(response.headers) ?? resolveRequestSessionId(request);
  let toolEvents: ChatStreamToolProgressEvent[] = [];
  let startEmitted = false;

  const emitStart = () => {
    if (startEmitted || !sessionId) {
      return;
    }

    handlers.onStart?.({
      sessionId,
      conversation: sessionId,
      responseId,
      model,
    });
    startEmitted = true;
  };

  emitStart();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r/g, '');

      while (buffer.includes('\n\n')) {
        const separatorIndex = buffer.indexOf('\n\n');
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);

        const { eventName, rawData } = parseUpstreamEvent(rawEvent);
        if (!rawData || rawData === '[DONE]') {
          continue;
        }

        const payloadJson = safeJsonParse(rawData);
        const resolvedEventName = resolveStreamEventName(eventName, payloadJson);
        model = extractModel(payloadJson, model);
        responseId = extractResponseId(payloadJson) ?? responseId;
        sessionId = resolveCanonicalSessionId(request, payloadJson, sessionId);
        emitStart();

        const delta = extractDelta(resolvedEventName, payloadJson);
        if (delta) {
          output += delta;
          handlers.onDelta?.(delta);
        }

        const toolEvent = toToolProgressEvent(resolvedEventName, payloadJson);
        if (toolEvent) {
          toolEvents = upsertToolEvent(toolEvents, toolEvent);
          handlers.onToolProgress?.(toolEvent);
        }

        if (resolvedEventName === 'response.completed' || resolvedEventName === 'response.incomplete') {
          output = extractCompletedOutput(payloadJson, output);
        }
      }
    }

    if (buffer.trim()) {
      const { eventName, rawData } = parseUpstreamEvent(buffer);
      const payloadJson = rawData && rawData !== '[DONE]' ? safeJsonParse(rawData) : undefined;
      const resolvedEventName = resolveStreamEventName(eventName, payloadJson);
      model = extractModel(payloadJson, model);
      responseId = extractResponseId(payloadJson) ?? responseId;
      sessionId = resolveCanonicalSessionId(request, payloadJson, sessionId);
      emitStart();

      const delta = extractDelta(resolvedEventName, payloadJson);
      if (delta) {
        output += delta;
        handlers.onDelta?.(delta);
      }

      const toolEvent = toToolProgressEvent(resolvedEventName, payloadJson);
      if (toolEvent) {
        toolEvents = upsertToolEvent(toolEvents, toolEvent);
        handlers.onToolProgress?.(toolEvent);
      }

      if (resolvedEventName === 'response.completed' || resolvedEventName === 'response.incomplete') {
        output = extractCompletedOutput(payloadJson, output);
      }
    }
  } catch (error) {
    if (!isAbortError(error)) {
      throw error;
    }

    const completedAt = new Date().toISOString();
    const persisted = persistConversationTurn(context, request, output, model, completedAt, {
      sessionId,
      responseId,
      mode,
    }, toolEvents);

    context.sessionId = persisted.sessionId ?? context.sessionId ?? sessionId;
    throw error;
  }

  const completedAt = new Date().toISOString();
  sessionId = sessionId ?? (responseId ? getSessionIdForResponse(responseId, context.profileId) : undefined);
  const persisted = persistConversationTurn(context, request, output, model, completedAt, {
    sessionId,
    responseId,
    mode,
  }, toolEvents);
  const finalSessionId = requireSessionId(persisted.sessionId ?? context.sessionId ?? sessionId);

  emitStart();

  const completeEvent = {
    sessionId: finalSessionId,
    conversation: finalSessionId,
    responseId,
    output,
    model,
  };
  handlers.onComplete?.(completeEvent);

  return completeEvent;
}

export async function sendChat(request: ChatRequest): Promise<ChatResponse> {
  const mode = resolveEffectiveChatMode(request, getChatMode(request.mode));
  const context = createChatTurnContext(request, mode);
  const now = new Date().toISOString();
  const payload = buildRequestPayload(mode, context, request, now, false);

  const response = await fetch(`${getHermesApiBaseUrl()}${getRequestPath(mode)}`, {
    method: 'POST',
    headers: buildHermesRequestHeaders(context),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Hermes API 请求失败: ${response.status}${details ? ` ${details}` : ''}`);
  }

  const data = (await response.json()) as JsonRecord;
  const output = mode === 'chat-completions' ? extractChatCompletionOutput(data) : extractCompletedOutput(data, '');
  const model = extractModel(data, 'hermes-agent');
  const responseId = extractResponseId(data);
  const sessionId =
    resolveSessionIdFromHeaders(response.headers)
    ?? resolveCanonicalSessionId(request, data, context.sessionId)
    ?? (responseId ? getSessionIdForResponse(responseId, context.profileId) : undefined);
  const persisted = persistConversationTurn(context, request, output, model, now, {
    sessionId,
    responseId,
    mode,
  });
  const finalSessionId = requireSessionId(persisted.sessionId ?? sessionId ?? context.sessionId);

  return {
    sessionId: finalSessionId,
    conversation: finalSessionId,
    responseId,
    id: finalSessionId,
    output,
    model,
  };
}
