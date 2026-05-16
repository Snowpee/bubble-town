import type { FastifyInstance } from 'fastify';
import { getHermesRoot } from '../services/hermes-paths.js';

export async function registerConfigRoutes(app: FastifyInstance) {
  app.get('/api/config', async () => ({
    apiBaseUrl: 'http://127.0.0.1:8642/v1',
    companionPort: 3030,
    hermesRoot: getHermesRoot(),
  }));
}
