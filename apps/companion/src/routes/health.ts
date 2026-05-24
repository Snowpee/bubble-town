import type { FastifyInstance } from 'fastify';
import { getHealthResponse } from '../services/health-service.js';

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => getHealthResponse());
}
