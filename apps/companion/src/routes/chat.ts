import type { FastifyInstance } from 'fastify';
import type {
  ChatImageAttachment,
  ChatStreamCompleteEvent,
  ChatStreamDeltaEvent,
  ChatStreamErrorEvent,
  ChatStreamStartEvent,
  ChatStreamToolProgressEvent,
} from '@bubble-town/shared';
import { streamSseResponse } from '../lib/sse.js';
import { sendChatResponse, streamChatResponse } from '../services/chat-service.js';

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
    return sendChatResponse(body, request.log);
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
    return streamSseResponse(request, reply, async ({ send, signal }) => {
      await streamChatResponse(body, {
        onStart: (event: ChatStreamStartEvent) => send('message-start', event),
        onDelta: (delta: string) => send('message-delta', { delta } satisfies ChatStreamDeltaEvent),
        onToolProgress: (event: ChatStreamToolProgressEvent) => send('tool-progress', event),
        onComplete: (event: ChatStreamCompleteEvent) => send('message-complete', event),
      }, {
        signal,
      }, request.log);
    }, (error) => ({
      message: error instanceof Error ? error.message : 'Hermes 流式聊天失败。',
    } satisfies ChatStreamErrorEvent));
  });
}
