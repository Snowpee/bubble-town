import type { FastifyInstance, FastifyReply } from 'fastify';
import { sendChat, streamChat } from '../services/hermes-api.js';
import { ensureManagedHermesGateway } from '../services/hermes-gateway.js';
import type {
  ChatImageAttachment,
  ChatStreamCompleteEvent,
  ChatStreamDeltaEvent,
  ChatStreamErrorEvent,
  ChatStreamStartEvent,
  ChatStreamToolProgressEvent,
} from '@bubble-town/shared';

function compactInput(value: string): string {
  return value.length > 80 ? `${value.slice(0, 80)}...` : value;
}

function writeSseEvent(reply: FastifyReply, event: string, payload: unknown) {
  if (reply.raw.writableEnded || reply.raw.destroyed) {
    return;
  }

  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'AbortError';
  }

  return error instanceof Error && error.name === 'AbortError';
}

export async function registerChatRoutes(app: FastifyInstance) {
  app.post('/api/chat/respond', async (request) => {
    const body = request.body as {
      profileId?: string;
      sessionId?: string;
      conversation?: string;
      responseId?: string;
      input: string;
      attachments?: ChatImageAttachment[];
      mode?: 'responses' | 'chat-completions';
    };
    request.log.info({
      profileId: body.profileId,
      sessionId: body.sessionId ?? body.conversation,
      responseId: body.responseId,
      mode: body.mode,
      inputPreview: compactInput(body.input ?? ''),
    }, 'chat respond request');
    const gateway = await ensureManagedHermesGateway(body.profileId);
    const gatewayInstance = gateway.gateways?.find((entry) => entry.expectedProfileId === gateway.profileId);
    request.log.info({
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
    request.log.info({
      requestedProfileId: body.profileId,
      gatewayExpectedProfileId: gatewayInstance?.expectedProfileId ?? gateway.profileId,
      gatewayActualProfileId: gatewayInstance?.actualProfileId,
      returnedSessionId: result.sessionId,
      returnedResponseId: result.responseId,
      model: result.model,
    }, 'chat respond complete');
    return result;
  });

  app.post('/api/chat/respond-stream', async (request, reply) => {
    const body = request.body as {
      profileId?: string;
      sessionId?: string;
      conversation?: string;
      responseId?: string;
      input: string;
      attachments?: ChatImageAttachment[];
      mode?: 'responses' | 'chat-completions';
    };
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '*';
    const abortController = new AbortController();
    const handleAbort = () => {
      if (!reply.raw.writableEnded && !abortController.signal.aborted) {
        abortController.abort();
      }
    };

    request.raw.on('aborted', handleAbort);
    reply.raw.on('close', handleAbort);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
    });

    try {
      request.log.info({
        profileId: body.profileId,
        sessionId: body.sessionId ?? body.conversation,
        responseId: body.responseId,
        mode: body.mode,
        inputPreview: compactInput(body.input ?? ''),
      }, 'chat stream request');
      const gateway = await ensureManagedHermesGateway(body.profileId);
      const gatewayInstance = gateway.gateways?.find((entry) => entry.expectedProfileId === gateway.profileId);
      request.log.info({
        requestedProfileId: body.profileId,
        gatewayExpectedProfileId: gatewayInstance?.expectedProfileId ?? gateway.profileId,
        gatewayActualProfileId: gatewayInstance?.actualProfileId,
        gatewayApiBaseUrl: gateway.apiBaseUrl,
        gatewayPort: gateway.port,
        gatewayPid: gateway.pid,
        expectedHermesHome: gatewayInstance?.expectedHermesHome,
        actualHermesHome: gatewayInstance?.actualHermesHome,
      }, 'chat stream gateway ready');
      await streamChat(body, {
        onStart: (event: ChatStreamStartEvent) => {
          request.log.info({
            requestedProfileId: body.profileId,
            gatewayExpectedProfileId: gatewayInstance?.expectedProfileId ?? gateway.profileId,
            gatewayActualProfileId: gatewayInstance?.actualProfileId,
            returnedSessionId: event.sessionId,
            returnedResponseId: event.responseId,
            model: event.model,
          }, 'chat stream start');
          writeSseEvent(reply, 'message-start', event);
        },
        onDelta: (delta: string) => writeSseEvent(reply, 'message-delta', { delta } satisfies ChatStreamDeltaEvent),
        onToolProgress: (event: ChatStreamToolProgressEvent) => writeSseEvent(reply, 'tool-progress', event),
        onComplete: (event: ChatStreamCompleteEvent) => {
          request.log.info({
            requestedProfileId: body.profileId,
            gatewayExpectedProfileId: gatewayInstance?.expectedProfileId ?? gateway.profileId,
            gatewayActualProfileId: gatewayInstance?.actualProfileId,
            returnedSessionId: event.sessionId,
            returnedResponseId: event.responseId,
            model: event.model,
          }, 'chat stream complete');
          writeSseEvent(reply, 'message-complete', event);
        },
      }, {
        signal: abortController.signal,
      }, {
        apiBaseUrl: gateway.apiBaseUrl,
        managedGatewayProfileId: gateway.profileId,
      });
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      const payload = {
        message: error instanceof Error ? error.message : 'Hermes 流式聊天失败。',
      } satisfies ChatStreamErrorEvent;
      writeSseEvent(reply, 'message-error', payload);
    } finally {
      request.raw.off('aborted', handleAbort);
      reply.raw.off('close', handleAbort);

      if (!reply.raw.writableEnded && !reply.raw.destroyed) {
        reply.raw.end();
      }
    }
  });
}
