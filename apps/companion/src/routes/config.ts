import type { FastifyInstance } from 'fastify';
import { getHermesRoot } from '../services/hermes-paths.js';
import { getManagedHermesGatewaySnapshot } from '../services/hermes-gateway.js';
import { getCompanionLockSnapshot } from '../services/companion-lock.js';

export async function registerConfigRoutes(app: FastifyInstance) {
  app.get('/api/config', async () => {
    const gateway = getManagedHermesGatewaySnapshot();
    return {
      apiBaseUrl: gateway.apiBaseUrl ?? process.env.HERMES_API_BASE_URL ?? 'http://127.0.0.1:8643/v1',
      companionPort: 3030,
      companionPid: process.pid,
      companionLock: getCompanionLockSnapshot(),
      hermesRoot: getHermesRoot(),
      managedHermes: gateway,
    };
  });
}
