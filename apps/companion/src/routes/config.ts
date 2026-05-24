import type { FastifyInstance } from 'fastify';
import type {
  TestAuxiliaryLlmConnectionRequest,
  UpdateAuxiliaryLlmSettingsRequest,
} from '@bubble-town/shared';
import { getConfigResponse } from '../services/config-service.js';
import {
  getAuxiliaryLlmSettingsResponse,
  testAuxiliaryLlmConnectionResponse,
  updateAuxiliaryLlmSettingsResponse,
} from '../services/auxiliary-llm-service.js';

export async function registerConfigRoutes(app: FastifyInstance) {
  app.get('/api/config', async () => getConfigResponse());
  app.get('/api/config/auxiliary-llm', async (request) => {
    const query = request.query as { profileId?: string };
    return getAuxiliaryLlmSettingsResponse(query.profileId);
  });
  app.patch('/api/config/auxiliary-llm', async (request) => {
    const input = request.body as UpdateAuxiliaryLlmSettingsRequest;
    return updateAuxiliaryLlmSettingsResponse(input);
  });
  app.post('/api/config/auxiliary-llm/test', async (request) => {
    const input = request.body as TestAuxiliaryLlmConnectionRequest;
    return testAuxiliaryLlmConnectionResponse(input);
  });
}
