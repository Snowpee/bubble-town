import type { FastifyInstance } from 'fastify';
import { handleCreateProfile, handleDeleteProfile, getProfilesResponse, handleRenameProfile, handleSwitchProfile } from '../services/profile-service.js';
import { restartManagedHermesGateway } from '../services/hermes-gateway.js';

export async function registerProfileRoutes(app: FastifyInstance) {
  app.get('/api/profiles', async () => getProfilesResponse());

  app.post('/api/profiles', async (request, reply) => {
    const body = request.body as { name: string };
    try {
      return handleCreateProfile({ name: body.name });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '创建 profile 失败。' };
    }
  });

  app.patch('/api/profiles/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { name: string };
    const updated = handleRenameProfile(params.id, { name: body.name });

    if (!updated) {
      reply.code(404);
      return { message: '未找到目标 profile。' };
    }

    return updated;
  });

  app.delete('/api/profiles/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const deleted = handleDeleteProfile(params.id);

    if (!deleted) {
      reply.code(400);
      return { message: '当前 profile 不允许删除，或目标不存在。' };
    }

    return { success: true };
  });

  app.post('/api/profiles/switch', async (request, reply) => {
    const body = request.body as { profileId: string };
    let result;

    try {
      await restartManagedHermesGateway(body.profileId);
      result = handleSwitchProfile({ profileId: body.profileId });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '切换 profile 失败。' };
    }

    if (!result.activeProfile) {
      reply.code(404);
      return { message: '未找到要切换的 profile。' };
    }

    return result;
  });
}
