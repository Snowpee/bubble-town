import type {
  ChatImageAttachment,
  ChatMode,
  ChatStreamCompleteEvent,
  ChatStreamStartEvent,
  ChatStreamToolProgressEvent,
} from '@bubble-town/shared';
import { sendChat, streamChat } from '../adapters/hermes/hermes-api.js';
import { ensureManagedHermesGateway } from '../adapters/hermes/hermes-gateway.js';

interface ChatRouteRequest {
  profileId?: string;
  sessionId?: string;
  conversation?: string;
  responseId?: string;
  input: string;
  attachments?: ChatImageAttachment[];
  mode?: ChatMode;
}

interface ChatRouteLogger {
  info: (...args: unknown[]) => void;
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

function compactInput(value: string): string {
  return value.length > 80 ? `${value.slice(0, 80)}...` : value;
}

export async function sendChatResponse(
  body: ChatRouteRequest,
  log?: ChatRouteLogger,
) {
  log?.info({
    profileId: body.profileId,
    sessionId: body.sessionId ?? body.conversation,
    responseId: body.responseId,
    mode: body.mode,
    inputPreview: compactInput(body.input ?? ''),
  }, 'chat respond request');

  const gateway = await ensureManagedHermesGateway(body.profileId);
  const gatewayInstance = gateway.gateways?.find((entry) => entry.expectedProfileId === gateway.profileId);

  log?.info({
    requestedProfileId: body.profileId,
    gatewayExpectedProfileId: gatewayInstance?.expectedProfileId ?? gateway.profileId,
    gatewayActualProfileId: gatewayInstance?.actualProfileId,
    gatewayApiBaseUrl: gateway.apiBaseUrl,
    gatewayPort: gateway.port,
    gatewayPid: gateway.pid,
    expectedHermesHome: gatewayInstance?.expectedHermesHome,
    actualHermesHome: gatewayInstance?.actualHermesHome,
  }, 'chat respond gateway ready');

  const result = await sendChat(body, {
    apiBaseUrl: gateway.apiBaseUrl,
    managedGatewayProfileId: gateway.profileId,
  });

  log?.info({
    requestedProfileId: body.profileId,
    gatewayExpectedProfileId: gatewayInstance?.expectedProfileId ?? gateway.profileId,
    gatewayActualProfileId: gatewayInstance?.actualProfileId,
    returnedSessionId: result.sessionId,
    returnedResponseId: result.responseId,
    model: result.model,
  }, 'chat respond complete');

  return result;
}

export async function streamChatResponse(
  body: ChatRouteRequest,
  handlers: StreamChatHandlers = {},
  options: StreamChatOptions = {},
  log?: ChatRouteLogger,
) {
  log?.info({
    profileId: body.profileId,
    sessionId: body.sessionId ?? body.conversation,
    responseId: body.responseId,
    mode: body.mode,
    inputPreview: compactInput(body.input ?? ''),
  }, 'chat stream request');

  const gateway = await ensureManagedHermesGateway(body.profileId);
  const gatewayInstance = gateway.gateways?.find((entry) => entry.expectedProfileId === gateway.profileId);

  log?.info({
    requestedProfileId: body.profileId,
    gatewayExpectedProfileId: gatewayInstance?.expectedProfileId ?? gateway.profileId,
    gatewayActualProfileId: gatewayInstance?.actualProfileId,
    gatewayApiBaseUrl: gateway.apiBaseUrl,
    gatewayPort: gateway.port,
    gatewayPid: gateway.pid,
    expectedHermesHome: gatewayInstance?.expectedHermesHome,
    actualHermesHome: gatewayInstance?.actualHermesHome,
  }, 'chat stream gateway ready');

  return streamChat(body, {
    onStart: (event) => {
      log?.info({
        requestedProfileId: body.profileId,
        gatewayExpectedProfileId: gatewayInstance?.expectedProfileId ?? gateway.profileId,
        gatewayActualProfileId: gatewayInstance?.actualProfileId,
        returnedSessionId: event.sessionId,
        returnedResponseId: event.responseId,
        model: event.model,
      }, 'chat stream start');
      handlers.onStart?.(event);
    },
    onDelta: handlers.onDelta,
    onToolProgress: handlers.onToolProgress,
    onComplete: (event) => {
      log?.info({
        requestedProfileId: body.profileId,
        gatewayExpectedProfileId: gatewayInstance?.expectedProfileId ?? gateway.profileId,
        gatewayActualProfileId: gatewayInstance?.actualProfileId,
        returnedSessionId: event.sessionId,
        returnedResponseId: event.responseId,
        model: event.model,
      }, 'chat stream complete');
      handlers.onComplete?.(event);
    },
  }, options, {
    apiBaseUrl: gateway.apiBaseUrl,
    managedGatewayProfileId: gateway.profileId,
  });
}
