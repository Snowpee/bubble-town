import type {
  ChatStreamCompleteEvent,
  ChatStreamStartEvent,
  ChatStreamToolProgressEvent,
  ContextPreviewResponse,
  StorylineChatRequest,
  StorylineChatResponse,
  StorylineChatStreamCompleteEvent,
  StorylineChatStreamStartEvent,
} from '@bubble-town/shared';
import { sendChat, streamChat } from './hermes-api.js';
import { ensureManagedHermesGateway } from './hermes-gateway.js';
import { buildContextPack, renderContextPackInstructions } from './context-pack.js';
import {
  getRuntimeSessionForStoryline,
  getStoryline,
  touchStorylineInteraction,
  upsertRuntimeSession,
} from './story-runtime-store.js';

interface StreamStorylineChatHandlers {
  onStart?: (event: StorylineChatStreamStartEvent) => void;
  onDelta?: (delta: string) => void;
  onToolProgress?: (event: ChatStreamToolProgressEvent) => void;
  onComplete?: (event: StorylineChatStreamCompleteEvent) => void;
}

interface StreamStorylineChatOptions {
  signal?: AbortSignal;
}

function resolveStorylineOrThrow(storylineId: string) {
  const storyline = getStoryline(storylineId);
  if (!storyline || storyline.status !== 'active') {
    throw new Error('未找到可用剧情。');
  }
  return storyline;
}

function buildInjectedInput(contextInstructions: string, input: string): string {
  return `${contextInstructions}\n\n<UserMessage>\n${input}\n</UserMessage>`;
}

export function previewContextPack(storylineId: string): ContextPreviewResponse {
  const contextPack = buildContextPack(storylineId);
  return {
    contextPack,
    renderedInstructions: renderContextPackInstructions(contextPack),
  };
}

export async function sendStorylineChat(request: StorylineChatRequest): Promise<StorylineChatResponse> {
  const storyline = resolveStorylineOrThrow(request.storylineId);
  const runtimeSession = getRuntimeSessionForStoryline(storyline.id);
  const preview = previewContextPack(storyline.id);
  const gateway = await ensureManagedHermesGateway(storyline.hermesProfileId);
  const response = await sendChat({
    input: buildInjectedInput(preview.renderedInstructions, request.input),
    attachments: request.attachments,
    profileId: storyline.hermesProfileId,
    sessionId: runtimeSession?.hermesSessionId,
    responseId: runtimeSession?.previousResponseId,
    mode: request.mode,
  }, {
    apiBaseUrl: gateway.apiBaseUrl,
    managedGatewayProfileId: gateway.profileId,
  });
  const updatedRuntimeSession = upsertRuntimeSession({
    storylineId: storyline.id,
    hermesProfileId: storyline.hermesProfileId,
    hermesSessionId: response.sessionId,
    previousResponseId: response.responseId,
    reason: runtimeSession ? 'continue' : 'storyline_start',
  });
  touchStorylineInteraction(storyline.id);

  return {
    ...response,
    storylineId: storyline.id,
    runtimeSessionId: updatedRuntimeSession.id,
  };
}

export async function streamStorylineChat(
  request: StorylineChatRequest,
  handlers: StreamStorylineChatHandlers = {},
  options: StreamStorylineChatOptions = {},
): Promise<StorylineChatResponse> {
  const storyline = resolveStorylineOrThrow(request.storylineId);
  const runtimeSession = getRuntimeSessionForStoryline(storyline.id);
  const preview = previewContextPack(storyline.id);
  const gateway = await ensureManagedHermesGateway(storyline.hermesProfileId);
  let currentRuntimeSession = runtimeSession ?? upsertRuntimeSession({
    storylineId: storyline.id,
    hermesProfileId: storyline.hermesProfileId,
    reason: 'storyline_start',
  });

  const response = await streamChat({
    input: buildInjectedInput(preview.renderedInstructions, request.input),
    attachments: request.attachments,
    profileId: storyline.hermesProfileId,
    sessionId: currentRuntimeSession.hermesSessionId,
    responseId: currentRuntimeSession.previousResponseId,
    mode: request.mode,
  }, {
    onStart: (event: ChatStreamStartEvent) => {
      currentRuntimeSession = upsertRuntimeSession({
        storylineId: storyline.id,
        hermesProfileId: storyline.hermesProfileId,
        hermesSessionId: event.sessionId,
        previousResponseId: event.responseId,
        reason: runtimeSession ? 'continue' : 'storyline_start',
      });
      handlers.onStart?.({
        ...event,
        storylineId: storyline.id,
        runtimeSessionId: currentRuntimeSession.id,
      });
    },
    onDelta: handlers.onDelta,
    onToolProgress: handlers.onToolProgress,
    onComplete: (event: ChatStreamCompleteEvent) => {
      currentRuntimeSession = upsertRuntimeSession({
        storylineId: storyline.id,
        hermesProfileId: storyline.hermesProfileId,
        hermesSessionId: event.sessionId,
        previousResponseId: event.responseId,
        reason: runtimeSession ? 'continue' : 'storyline_start',
      });
      touchStorylineInteraction(storyline.id);
      handlers.onComplete?.({
        ...event,
        storylineId: storyline.id,
        runtimeSessionId: currentRuntimeSession.id,
      });
    },
  }, options, {
    apiBaseUrl: gateway.apiBaseUrl,
    managedGatewayProfileId: gateway.profileId,
  });

  currentRuntimeSession = upsertRuntimeSession({
    storylineId: storyline.id,
    hermesProfileId: storyline.hermesProfileId,
    hermesSessionId: response.sessionId,
    previousResponseId: response.responseId,
    reason: runtimeSession ? 'continue' : 'storyline_start',
  });
  touchStorylineInteraction(storyline.id);

  return {
    ...response,
    storylineId: storyline.id,
    runtimeSessionId: currentRuntimeSession.id,
  };
}
