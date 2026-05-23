import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  ChatStreamDeltaEvent,
  ChatStreamErrorEvent,
  ChatStreamToolProgressEvent,
  StorylineChatStreamCompleteEvent,
  StorylineChatStreamStartEvent,
} from '@bubble-town/shared';
import { previewContextPack, previewContextPackForInput, sendStorylineChat, streamStorylineChat } from '../services/story-chat-service.js';
import { searchRelativeTime } from '../services/relative-time-search.js';
import { buildTimeContext } from '../services/context-pack.js';
import { validateProfileContinuity } from '../services/profile-continuity.js';
import { consolidateStorylineMemory, correctMemory } from '../services/memory-governance.js';
import {
  createActivityLog,
  createMemoryRecord,
  createSuppressedMemory,
  deleteSuppressedMemory,
  createStoryline,
  getActiveStoryline,
  getActiveStorylineId,
  getStoryline,
  listAllActivityLogs,
  listAllMemoryRecords,
  listAllSuppressedMemories,
  listStorylines,
  setActiveStoryline,
  setActiveStorylineForProfile,
  updateActivityLog,
  updateMemoryRecord,
  updateStoryline,
} from '../services/story-runtime-store.js';

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

export async function registerStorylineRoutes(app: FastifyInstance) {
  app.get('/api/storylines', async () => ({
    activeStorylineId: getActiveStorylineId(),
    storylines: listStorylines(),
  }));

  app.get('/api/storylines/active', async () => ({ activeStoryline: getActiveStoryline() }));

  app.post('/api/storylines', async (request, reply) => {
    try {
      return createStoryline(request.body as { characterId: string; hermesProfileId: string; title: string; description?: string });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '创建剧情失败。' };
    }
  });

  app.get('/api/storylines/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const storyline = getStoryline(params.id);
    if (!storyline) {
      reply.code(404);
      return { message: '未找到目标剧情。' };
    }
    return storyline;
  });

  app.patch('/api/storylines/:id', async (request, reply) => {
    const params = request.params as { id: string };
    try {
      const storyline = updateStoryline(params.id, request.body as { title?: string; description?: string; status?: 'active' | 'archived' });
      if (!storyline) {
        reply.code(404);
        return { message: '未找到目标剧情。' };
      }
      return storyline;
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '更新剧情失败。' };
    }
  });

  app.post('/api/storylines/:id/set-active', async (request, reply) => {
    const params = request.params as { id: string };
    const storyline = setActiveStoryline(params.id);
    if (!storyline) {
      reply.code(404);
      return { message: '未找到可激活的剧情。' };
    }
    return { activeStoryline: storyline };
  });

  app.post('/api/storylines/activate-profile', async (request, reply) => {
    const body = request.body as { profileId?: string };
    const profileId = body.profileId?.trim();
    if (!profileId) {
      reply.code(400);
      return { message: 'Hermes profile 不能为空。' };
    }

    return { activeStoryline: setActiveStorylineForProfile(profileId) };
  });

  app.post('/api/storylines/:id/archive', async (request, reply) => {
    const params = request.params as { id: string };
    const storyline = updateStoryline(params.id, { status: 'archived' });
    if (!storyline) {
      reply.code(404);
      return { message: '未找到目标剧情。' };
    }
    return storyline;
  });

  app.post('/api/storylines/:id/chat/respond', async (request, reply) => {
    const params = request.params as { id: string };
    try {
      return await sendStorylineChat({
        ...(request.body as { input: string; attachments?: []; mode?: 'responses' | 'chat-completions' }),
        storylineId: params.id,
      });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '剧情聊天失败。' };
    }
  });

  app.post('/api/storylines/:id/context/preview', async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { input?: string } | undefined;
    try {
      return previewContextPackForInput(params.id, body?.input);
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '生成 ContextPack 预览失败。' };
    }
  });

  app.post('/api/storylines/:id/relative-time-search', async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { input?: string };
    const storyline = getStoryline(params.id);
    if (!storyline) {
      reply.code(404);
      return { message: '未找到目标剧情。' };
    }
    const input = body.input?.trim();
    if (!input) {
      reply.code(400);
      return { message: '检索输入不能为空。' };
    }
    return { results: searchRelativeTime(storyline.id, input, buildTimeContext(storyline.lastInteractionAt)) };
  });

  app.post('/api/storylines/:id/memory/consolidate', async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { activityLimit?: number } | undefined;
    try {
      return consolidateStorylineMemory({
        storylineId: params.id,
        activityLimit: body?.activityLimit,
      });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '记忆巩固失败。' };
    }
  });

  app.post('/api/storylines/:id/profile/validate-continuity', async (request, reply) => {
    const params = request.params as { id: string };
    const storyline = getStoryline(params.id);
    if (!storyline) {
      reply.code(404);
      return { message: '未找到目标剧情。' };
    }
    return validateProfileContinuity(storyline.hermesProfileId);
  });

  app.get('/api/storylines/:id/memories', async (request, reply) => {
    const params = request.params as { id: string };
    if (!getStoryline(params.id)) {
      reply.code(404);
      return { message: '未找到目标剧情。' };
    }
    return { memories: listAllMemoryRecords(params.id) };
  });

  app.post('/api/storylines/:id/memories', async (request, reply) => {
    const params = request.params as { id: string };
    try {
      return createMemoryRecord(params.id, request.body as { content: string });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '创建记忆失败。' };
    }
  });

  app.patch('/api/memories/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const memory = updateMemoryRecord(params.id, request.body as { content?: string; status?: 'active' | 'hidden' | 'deleted' });
    if (!memory) {
      reply.code(404);
      return { message: '未找到目标记忆。' };
    }
    return memory;
  });

  app.post('/api/memories/:id/hide', async (request, reply) => {
    const params = request.params as { id: string };
    const memory = updateMemoryRecord(params.id, { status: 'hidden' });
    if (!memory) {
      reply.code(404);
      return { message: '未找到目标记忆。' };
    }
    return memory;
  });

  app.post('/api/memories/:id/delete', async (request, reply) => {
    const params = request.params as { id: string };
    const memory = updateMemoryRecord(params.id, { status: 'deleted' });
    if (!memory) {
      reply.code(404);
      return { message: '未找到目标记忆。' };
    }
    return memory;
  });

  app.post('/api/memories/:id/restore', async (request, reply) => {
    const params = request.params as { id: string };
    const memory = updateMemoryRecord(params.id, { status: 'active' });
    if (!memory) {
      reply.code(404);
      return { message: '未找到目标记忆。' };
    }
    return memory;
  });

  app.post('/api/memories/:id/correct', async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { content?: string; reason?: string };
    const content = body.content?.trim();
    if (!content) {
      reply.code(400);
      return { message: '纠正后的记忆内容不能为空。' };
    }
    try {
      return correctMemory({
        memoryId: params.id,
        content,
        reason: body.reason,
      });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '纠正记忆失败。' };
    }
  });

  app.get('/api/storylines/:id/suppressed-memories', async (request, reply) => {
    const params = request.params as { id: string };
    if (!getStoryline(params.id)) {
      reply.code(404);
      return { message: '未找到目标剧情。' };
    }
    return { suppressedMemories: listAllSuppressedMemories(params.id) };
  });

  app.post('/api/storylines/:id/suppressed-memories', async (request, reply) => {
    const params = request.params as { id: string };
    try {
      return createSuppressedMemory(params.id, request.body as { pattern: string; reason?: string });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '创建抑制规则失败。' };
    }
  });

  app.delete('/api/suppressed-memories/:id', async (request, reply) => {
    const params = request.params as { id: string };
    if (!deleteSuppressedMemory(params.id)) {
      reply.code(404);
      return { message: '未找到目标抑制规则。' };
    }
    return { success: true };
  });

  app.get('/api/storylines/:id/activity', async (request, reply) => {
    const params = request.params as { id: string };
    if (!getStoryline(params.id)) {
      reply.code(404);
      return { message: '未找到目标剧情。' };
    }
    return { activityLogs: listAllActivityLogs(params.id) };
  });

  app.post('/api/storylines/:id/activity', async (request, reply) => {
    const params = request.params as { id: string };
    try {
      return createActivityLog(params.id, request.body as { summary: string; tags?: string[] });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '创建活动日志失败。' };
    }
  });

  app.patch('/api/activity/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const activity = updateActivityLog(params.id, request.body as { summary?: string; status?: 'active' | 'hidden' | 'deleted' });
    if (!activity) {
      reply.code(404);
      return { message: '未找到目标活动日志。' };
    }
    return activity;
  });

  app.post('/api/activity/:id/hide', async (request, reply) => {
    const params = request.params as { id: string };
    const activity = updateActivityLog(params.id, { status: 'hidden' });
    if (!activity) {
      reply.code(404);
      return { message: '未找到目标活动日志。' };
    }
    return activity;
  });

  app.post('/api/context/preview', async (request, reply) => {
    const body = request.body as { storylineId: string; input?: string };
    try {
      return previewContextPackForInput(body.storylineId, body.input);
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '生成 ContextPack 预览失败。' };
    }
  });

  app.post('/api/storylines/:id/chat/respond-stream', async (request, reply) => {
    const params = request.params as { id: string };
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
      await streamStorylineChat({
        ...(request.body as { input: string; attachments?: []; mode?: 'responses' | 'chat-completions' }),
        storylineId: params.id,
      }, {
        onStart: (event: StorylineChatStreamStartEvent) => writeSseEvent(reply, 'message-start', event),
        onDelta: (delta: string) => writeSseEvent(reply, 'message-delta', { delta } satisfies ChatStreamDeltaEvent),
        onToolProgress: (event: ChatStreamToolProgressEvent) => writeSseEvent(reply, 'tool-progress', event),
        onComplete: (event: StorylineChatStreamCompleteEvent) => writeSseEvent(reply, 'message-complete', event),
      }, {
        signal: abortController.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      writeSseEvent(reply, 'message-error', {
        message: error instanceof Error ? error.message : '剧情流式聊天失败。',
      } satisfies ChatStreamErrorEvent);
    } finally {
      request.raw.off('aborted', handleAbort);
      reply.raw.off('close', handleAbort);

      if (!reply.raw.writableEnded && !reply.raw.destroyed) {
        reply.raw.end();
      }
    }
  });
}
