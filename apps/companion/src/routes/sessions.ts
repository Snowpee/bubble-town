import type { FastifyInstance } from 'fastify';
import { deleteSession, getSessionDetail, getSessionSummary, listSessions } from '../services/session-store.js';

export async function registerSessionRoutes(app: FastifyInstance) {
  app.get('/api/sessions', async (request) => {
    const query = request.query as { profileId?: string };
    return { sessions: listSessions(query.profileId) };
  });

  app.get('/api/sessions/:id/summary', async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { profileId?: string };
    const summary = getSessionSummary(params.id, query.profileId);

    if (!summary) {
      reply.code(404);
      return { message: '未找到目标会话。' };
    }

    return summary;
  });

  app.get('/api/sessions/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { profileId?: string };
    const detail = getSessionDetail(params.id, query.profileId);

    if (!detail) {
      reply.code(404);
      return { message: '未找到目标会话。' };
    }

    return detail;
  });

  app.delete('/api/sessions/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { profileId?: string };
    const deleted = deleteSession(params.id, query.profileId);

    if (!deleted) {
      reply.code(404);
      return { message: '未找到目标会话，或当前会话不支持删除。' };
    }

    return { success: true };
  });
}
