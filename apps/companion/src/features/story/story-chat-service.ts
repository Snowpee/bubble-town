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
import { sendChat, streamChat } from '../../adapters/hermes/hermes-api.js';
import { ensureManagedHermesGateway } from '../../adapters/hermes/hermes-gateway.js';
import { buildContextPackFromRuntimeContext, renderContextPackInstructions } from './context-pack.js';
import { getLatestWorldStateDebugForStoryline, recordStorylineTurnContinuity } from './story-memory-continuity.js';
import { rolloverStoryRuntimeSessionIfNeeded } from './story-session-rollover.js';
import { getStorylineRuntimeContext, type StorylineRuntimeContext } from '../../services/runtime-service.js';
import {
  touchStorylineInteraction,
  upsertRuntimeSession,
} from '../../store/story-runtime-store.js';

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

function resolveStorylineRuntimeContextOrThrow(storylineId: string): StorylineRuntimeContext {
  const runtimeContext = getStorylineRuntimeContext(storylineId);
  if (!runtimeContext?.storyline || runtimeContext.storyline.status !== 'active') {
    throw new Error('未找到可用剧情。');
  }
  return runtimeContext;
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
  const contextPack = buildContextPackFromRuntimeContext(resolveStorylineRuntimeContextOrThrow(storylineId));
  return {
    contextPack,
    renderedInstructions: renderContextPackInstructions(contextPack),
    worldStateDebug: getLatestWorldStateDebugForStoryline(storylineId),
  };
}

export function previewContextPackForInput(storylineId: string, input?: string): ContextPreviewResponse {
  const contextPack = buildContextPackFromRuntimeContext(resolveStorylineRuntimeContextOrThrow(storylineId), { input });
  return {
    contextPack,
    renderedInstructions: renderContextPackInstructions(contextPack),
    worldStateDebug: getLatestWorldStateDebugForStoryline(storylineId),
  };
}

export async function sendStorylineChat(request: StorylineChatRequest): Promise<StorylineChatResponse> {
  const runtimeContext = resolveStorylineRuntimeContextOrThrow(request.storylineId);
  const storyline = runtimeContext.storyline;
  const runtimeSession = rolloverStoryRuntimeSessionIfNeeded(storyline, runtimeContext.runtimeSession);
  const preview = buildContextPackFromRuntimeContext(resolveStorylineRuntimeContextOrThrow(storyline.id), { input: request.input });
  const gateway = await ensureManagedHermesGateway(storyline.hermesProfileId);
  const chatRequest = buildStorylineChatRequest(request, renderContextPackInstructions(preview));
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
  const continuity = await recordStorylineTurnContinuity({
    storyline,
    userInput: request.input,
    assistantOutput: response.output,
    sourceMessageIds: [response.sessionId, response.responseId].filter((value): value is string => Boolean(value)),
    extractorExecutionOptions: {
      apiBaseUrl: gateway.apiBaseUrl,
      managedGatewayProfileId: gateway.profileId,
    },
  });

  return {
    ...response,
    storylineId: storyline.id,
    runtimeSessionId: updatedRuntimeSession.id,
    worldStateDebug: continuity.worldStateDebug,
  };
}

export async function streamStorylineChat(
  request: StorylineChatRequest,
  handlers: StreamStorylineChatHandlers = {},
  options: StreamStorylineChatOptions = {},
): Promise<StorylineChatResponse> {
  const runtimeContext = resolveStorylineRuntimeContextOrThrow(request.storylineId);
  const storyline = runtimeContext.storyline;
  const runtimeSession = rolloverStoryRuntimeSessionIfNeeded(storyline, runtimeContext.runtimeSession);
  const preview = buildContextPackFromRuntimeContext(resolveStorylineRuntimeContextOrThrow(storyline.id), { input: request.input });
  const gateway = await ensureManagedHermesGateway(storyline.hermesProfileId);
  let continuityRecorded = false;
  let completedEvent: ChatStreamCompleteEvent | undefined;
  let currentRuntimeSession = runtimeSession ?? upsertRuntimeSession({
    storylineId: storyline.id,
    hermesProfileId: storyline.hermesProfileId,
    reason: 'storyline_start',
  });

  const chatRequest = buildStorylineChatRequest(request, renderContextPackInstructions(preview));
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
      completedEvent = event;
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
  let continuity = undefined as Awaited<ReturnType<typeof recordStorylineTurnContinuity>> | undefined;
  if (!continuityRecorded) {
    continuity = await recordStorylineTurnContinuity({
      storyline,
      userInput: request.input,
      assistantOutput: response.output,
      sourceMessageIds: [response.sessionId, response.responseId].filter((value): value is string => Boolean(value)),
      extractorExecutionOptions: {
        apiBaseUrl: gateway.apiBaseUrl,
        managedGatewayProfileId: gateway.profileId,
      },
    });
    continuityRecorded = true;
  }

  handlers.onComplete?.({
    ...(completedEvent ?? response),
    storylineId: storyline.id,
    runtimeSessionId: currentRuntimeSession.id,
    worldStateDebug: continuity?.worldStateDebug,
  });

  return {
    ...response,
    storylineId: storyline.id,
    runtimeSessionId: currentRuntimeSession.id,
    worldStateDebug: continuity?.worldStateDebug,
  };
}
