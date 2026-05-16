import type { FastifyInstance, FastifyReply } from 'fastify';
import { sendChat, streamChat } from '../services/hermes-api.js';
import type {
  ChatStreamCompleteEvent,
  ChatStreamDeltaEvent,
  ChatStreamErrorEvent,
  ChatStreamStartEvent,
  ChatStreamToolProgressEvent,
} from '@bubble-town/shared';

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
      mode?: 'responses' | 'chat-completions';
    };
    return sendChat(body);
  });

  app.post('/api/chat/respond-stream', async (request, reply) => {
    const body = request.body as {
      profileId?: string;
      sessionId?: string;
      conversation?: string;
      responseId?: string;
      input: string;
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
      await streamChat(body, {
        onStart: (event: ChatStreamStartEvent) => writeSseEvent(reply, 'message-start', event),
        onDelta: (delta: string) => writeSseEvent(reply, 'message-delta', { delta } satisfies ChatStreamDeltaEvent),
        onToolProgress: (event: ChatStreamToolProgressEvent) => writeSseEvent(reply, 'tool-progress', event),
        onComplete: (event: ChatStreamCompleteEvent) => writeSseEvent(reply, 'message-complete', event),
      }, {
        signal: abortController.signal,
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
