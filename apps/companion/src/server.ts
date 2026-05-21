import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerChatRoutes } from './routes/chat.js';
import { registerCharacterRoutes } from './routes/characters.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerProfileRoutes } from './routes/profiles.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerStorylineRoutes } from './routes/storylines.js';
import { ensureManagedHermesGateway, stopManagedHermesGateway } from './services/hermes-gateway.js';
import { getActiveProfileId } from './services/profile-store.js';
import { acquireCompanionLock, releaseCompanionLock } from './services/companion-lock.js';

const defaultPort = Number(process.env.COMPANION_PORT ?? 3030);
const defaultHost = process.env.COMPANION_HOST ?? '127.0.0.1';

interface CompanionServerOptions {
  port?: number;
  host?: string;
}

export async function createCompanionServer() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  await registerHealthRoutes(app);
  await registerConfigRoutes(app);
  await registerProfileRoutes(app);
  await registerSessionRoutes(app);
  await registerCharacterRoutes(app);
  await registerStorylineRoutes(app);
  await registerChatRoutes(app);

  app.addHook('onClose', async () => {
    await stopManagedHermesGateway();
    releaseCompanionLock();
  });

  app.get('/api/ping', async () => ({ ok: true }));

  return app;
}

export async function startCompanionServer(options: CompanionServerOptions = {}) {
  const app = await createCompanionServer();
  const port = options.port ?? defaultPort;
  const host = options.host ?? defaultHost;

  acquireCompanionLock(port, host);
  await app.listen({ port, host });
  try {
    await ensureManagedHermesGateway(getActiveProfileId());
  } catch (error) {
    app.log.warn(
      {
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
              }
            : error,
      },
      'Bubble Town 专用 Hermes 网关启动失败。',
    );
  }
  return app;
}
