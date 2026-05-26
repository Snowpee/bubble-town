import type { FastifyInstance } from 'fastify';
import type {
  ChatStreamDeltaEvent,
  ChatStreamErrorEvent,
  ChatStreamToolProgressEvent,
  StorylineChatStreamCompleteEvent,
  StorylineChatStreamStartEvent,
} from '@bubble-town/shared';
import { streamSseResponse } from '../lib/sse.js';
import {
  getLatestRuntimeDiagnosticsSnapshot,
  getLatestWorldStateDebugSnapshot,
  previewContextPackForInput,
  retryLatestRuntimeDiagnostics,
  sendStorylineChat,
  streamStorylineChat,
} from '../features/story/story-chat-service.js';
import {
  consolidateStorylineMemory,
  correctMemory,
  cancelPendingSemanticFrame,
  confirmPendingSemanticFrame,
  createActivityLog,
  createMemoryRecord,
  createSuppressedMemory,
  deleteSuppressedMemory,
  createStoryline,
  getActiveStoryline,
  getActiveStorylineId,
  getStoryline,
  listStorylineActivityLogs,
  listStorylineMemories,
  listPendingSemanticFrames,
  listStorylineSuppressedMemories,
  searchStorylineRelativeTime,
  listStorylines,
  permanentlyDeleteMemoryRecord,
  setActiveStoryline,
  setActiveStorylineForProfile,
  updateActivityLog,
  updateMemoryRecord,
  updateStoryline,
  validateStorylineProfileContinuity,
} from '../services/storyline-service.js';

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

  app.get('/api/storylines/:id/world-state/debug', async (request, reply) => {
    const params = request.params as { id: string };
    try {
      return getLatestWorldStateDebugSnapshot(params.id);
    } catch (error) {
      reply.code(404);
      return { message: error instanceof Error ? error.message : '未找到目标剧情。' };
    }
  });

  app.get('/api/storylines/:id/runtime-diagnostics', async (request, reply) => {
    const params = request.params as { id: string };
    try {
      return getLatestRuntimeDiagnosticsSnapshot(params.id);
    } catch (error) {
      reply.code(404);
      return { message: error instanceof Error ? error.message : '未找到目标剧情。' };
    }
  });

  app.post('/api/storylines/:id/runtime-diagnostics/retry', async (request, reply) => {
    const params = request.params as { id: string };
    try {
      return await retryLatestRuntimeDiagnostics(params.id);
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '最近一次后台派生重试失败。' };
    }
  });

  app.post('/api/storylines/:id/relative-time-search', async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { input?: string };
    try {
      const result = searchStorylineRelativeTime(params.id, body.input);
      if (!result) {
        reply.code(404);
        return { message: '未找到目标剧情。' };
      }
      return result;
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '相对时间检索失败。' };
    }
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
    const result = validateStorylineProfileContinuity(params.id);
    if (!result) {
      reply.code(404);
      return { message: '未找到目标剧情。' };
    }
    return result;
  });

  app.get('/api/storylines/:id/memories', async (request, reply) => {
    const params = request.params as { id: string };
    if (!getStoryline(params.id)) {
      reply.code(404);
      return { message: '未找到目标剧情。' };
    }
    return { memories: listStorylineMemories(params.id) };
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

  app.post('/api/storylines/:id/memories/batch', async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { memoryIds?: string[]; action?: 'hide' | 'restore' | 'delete' };
    if (!getStoryline(params.id)) {
      reply.code(404);
      return { message: '未找到目标剧情。' };
    }
    const memoryIds = Array.from(new Set((body.memoryIds ?? []).map((id) => id.trim()).filter(Boolean)));
    if (memoryIds.length === 0) {
      reply.code(400);
      return { message: '请选择需要批量处理的记忆。' };
    }
    const statusByAction = {
      hide: 'hidden',
      restore: 'active',
      delete: 'deleted',
    } as const;
    const nextStatus = body.action ? statusByAction[body.action] : undefined;
    if (!nextStatus) {
      reply.code(400);
      return { message: '不支持的批量记忆操作。' };
    }

    const storylineMemoryIds = new Set(listStorylineMemories(params.id).map((memory) => memory.id));
    const memories = [];
    for (const memoryId of memoryIds) {
      if (!storylineMemoryIds.has(memoryId)) {
        reply.code(404);
        return { message: '批量操作包含不属于当前剧情的记忆。' };
      }
      const memory = updateMemoryRecord(memoryId, { status: nextStatus });
      if (memory) {
        memories.push(memory);
      }
    }
    return { memories };
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

  app.delete('/api/memories/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const current = listStorylines()
      .flatMap((storyline) => listStorylineMemories(storyline.id))
      .find((memory) => memory.id === params.id);
    if (!current) {
      reply.code(404);
      return { message: '未找到目标记忆。' };
    }
    if (current.status !== 'deleted') {
      reply.code(400);
      return { message: '只有 deleted 状态的记忆可以永久删除。' };
    }
    const memory = permanentlyDeleteMemoryRecord(params.id);
    if (!memory) {
      reply.code(404);
      return { message: '未找到目标记忆。' };
    }
    return { success: true };
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
    return { suppressedMemories: listStorylineSuppressedMemories(params.id) };
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

  app.get('/api/storylines/:id/pending-semantic-frames', async (request, reply) => {
    const params = request.params as { id: string };
    if (!getStoryline(params.id)) {
      reply.code(404);
      return { message: '未找到目标剧情。' };
    }
    return { pendingSemanticFrames: listPendingSemanticFrames(params.id) };
  });

  app.post('/api/storylines/:id/pending-semantic-frames/:frameId/confirm', async (request, reply) => {
    const params = request.params as { id: string; frameId: string };
    try {
      return confirmPendingSemanticFrame({
        storylineId: params.id,
        frameId: params.frameId,
        ...(request.body as { sourceMessageIds?: string[]; userReply?: string } | undefined),
      });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '确认待确认语义帧失败。' };
    }
  });

  app.post('/api/storylines/:id/pending-semantic-frames/:frameId/cancel', async (request, reply) => {
    const params = request.params as { id: string; frameId: string };
    try {
      return cancelPendingSemanticFrame({
        storylineId: params.id,
        frameId: params.frameId,
        ...(request.body as { userReply?: string } | undefined),
      });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '取消待确认语义帧失败。' };
    }
  });

  app.get('/api/storylines/:id/activity', async (request, reply) => {
    const params = request.params as { id: string };
    if (!getStoryline(params.id)) {
      reply.code(404);
      return { message: '未找到目标剧情。' };
    }
    return { activityLogs: listStorylineActivityLogs(params.id) };
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
    return streamSseResponse(request, reply, async ({ send, signal }) => {
      await streamStorylineChat({
        ...(request.body as { input: string; attachments?: []; mode?: 'responses' | 'chat-completions' }),
        storylineId: params.id,
      }, {
        onStart: (event: StorylineChatStreamStartEvent) => send('message-start', event),
        onDelta: (delta: string) => send('message-delta', { delta } satisfies ChatStreamDeltaEvent),
        onToolProgress: (event: ChatStreamToolProgressEvent) => send('tool-progress', event),
        onComplete: (event: StorylineChatStreamCompleteEvent) => send('message-complete', event),
      }, {
        signal,
      });
    }, (error) => ({
      message: error instanceof Error ? error.message : '剧情流式聊天失败。',
    } satisfies ChatStreamErrorEvent));
  });
}
