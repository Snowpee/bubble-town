import type { FastifyInstance } from 'fastify';
import { createCharacter, getCharacter, listCharacters, updateCharacter } from '../services/story-runtime-store.js';

export async function registerCharacterRoutes(app: FastifyInstance) {
  app.get('/api/characters', async () => ({ characters: listCharacters() }));

  app.post('/api/characters', async (request, reply) => {
    try {
      return createCharacter(request.body as { name: string; templateProfileId: string; avatar?: string; description?: string });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : '创建角色失败。' };
    }
  });

  app.get('/api/characters/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const character = getCharacter(params.id);
    if (!character) {
      reply.code(404);
      return { message: '未找到目标角色。' };
    }
    return character;
  });

  app.patch('/api/characters/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const character = updateCharacter(params.id, request.body as { name?: string; templateProfileId?: string; avatar?: string; description?: string });
    if (!character) {
      reply.code(404);
      return { message: '未找到目标角色。' };
    }
    return character;
  });
}
