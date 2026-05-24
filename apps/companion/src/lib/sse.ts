import type { FastifyReply, FastifyRequest } from 'fastify';

export interface SseStreamContext {
  signal: AbortSignal;
  send: (event: string, payload: unknown) => void;
}

function sendSseEvent(reply: FastifyReply, event: string, payload: unknown) {
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

export async function streamSseResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  run: (context: SseStreamContext) => Promise<void>,
  buildErrorPayload: (error: unknown) => unknown,
) {
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
    await run({
      signal: abortController.signal,
      send: (event, payload) => sendSseEvent(reply, event, payload),
    });
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }

    sendSseEvent(reply, 'message-error', buildErrorPayload(error));
  } finally {
    request.raw.off('aborted', handleAbort);
    reply.raw.off('close', handleAbort);

    if (!reply.raw.writableEnded && !reply.raw.destroyed) {
      reply.raw.end();
    }
  }
}
