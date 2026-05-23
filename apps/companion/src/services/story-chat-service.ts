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
import { recordStorylineTurnContinuity } from './story-memory-continuity.js';
import { rolloverStoryRuntimeSessionIfNeeded } from './story-session-rollover.js';
import {
  getRuntimeSessionForStoryline,
  getStoryline,
  touchStorylineInteraction,
  upsertRuntimeSession,
} from './story-runtime-store.js';

type StorylineHermesChatRequest = Omit<StorylineChatRequest, 'storylineId'> & {
  transcriptInput: string;
  runtimeInstructions: string;
};

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

function buildStorylineChatRequest(request: StorylineChatRequest, contextInstructions: string): StorylineHermesChatRequest {
  return {
    input: request.input,
    transcriptInput: request.input,
    runtimeInstructions: contextInstructions,
    attachments: request.attachments,
    mode: request.mode,
  };
}

export function previewContextPack(storylineId: string): ContextPreviewResponse {
  const contextPack = buildContextPack(storylineId);
  return {
    contextPack,
    renderedInstructions: renderContextPackInstructions(contextPack),
  };
}

export function previewContextPackForInput(storylineId: string, input?: string): ContextPreviewResponse {
  const contextPack = buildContextPack(storylineId, { input });
  return {
    contextPack,
    renderedInstructions: renderContextPackInstructions(contextPack),
  };
}

export async function sendStorylineChat(request: StorylineChatRequest): Promise<StorylineChatResponse> {
  const storyline = resolveStorylineOrThrow(request.storylineId);
  const runtimeSession = rolloverStoryRuntimeSessionIfNeeded(storyline, getRuntimeSessionForStoryline(storyline.id));
  const preview = previewContextPackForInput(storyline.id, request.input);
  const gateway = await ensureManagedHermesGateway(storyline.hermesProfileId);
  const chatRequest = buildStorylineChatRequest(request, preview.renderedInstructions);
  const response = await sendChat({
    ...chatRequest,
    attachments: request.attachments,
    profileId: storyline.hermesProfileId,
    sessionId: runtimeSession?.hermesSessionId,
    responseId: runtimeSession?.previousResponseId,
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
  recordStorylineTurnContinuity({
    storyline,
    userInput: request.input,
    assistantOutput: response.output,
    sourceMessageIds: [response.sessionId, response.responseId].filter((value): value is string => Boolean(value)),
  });

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
  const runtimeSession = rolloverStoryRuntimeSessionIfNeeded(storyline, getRuntimeSessionForStoryline(storyline.id));
  const preview = previewContextPackForInput(storyline.id, request.input);
  const gateway = await ensureManagedHermesGateway(storyline.hermesProfileId);
  let continuityRecorded = false;
  let currentRuntimeSession = runtimeSession ?? upsertRuntimeSession({
    storylineId: storyline.id,
    hermesProfileId: storyline.hermesProfileId,
    reason: 'storyline_start',
  });

  const chatRequest = buildStorylineChatRequest(request, preview.renderedInstructions);
  const response = await streamChat({
    ...chatRequest,
    attachments: request.attachments,
    profileId: storyline.hermesProfileId,
    sessionId: currentRuntimeSession.hermesSessionId,
    responseId: currentRuntimeSession.previousResponseId,
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
      if (!continuityRecorded) {
        recordStorylineTurnContinuity({
          storyline,
          userInput: request.input,
          assistantOutput: event.output,
          sourceMessageIds: [event.sessionId, event.responseId].filter((value): value is string => Boolean(value)),
        });
        continuityRecorded = true;
      }
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
  if (!continuityRecorded) {
    recordStorylineTurnContinuity({
      storyline,
      userInput: request.input,
      assistantOutput: response.output,
      sourceMessageIds: [response.sessionId, response.responseId].filter((value): value is string => Boolean(value)),
    });
  }

  return {
    ...response,
    storylineId: storyline.id,
    runtimeSessionId: currentRuntimeSession.id,
  };
}
