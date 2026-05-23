import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerChatRoutes } from './routes/chat.js';
import { registerCharacterRoutes } from './routes/characters.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerProfileRoutes } from './routes/profiles.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerStorylineRoutes } from './routes/storylines.js';
import {
  ensureManagedHermesGateway,
  stopManagedHermesGateway,
} from './services/hermes-gateway.js';
import { getActiveProfileId } from './services/profile-store.js';
import {
  acquireCompanionLock,
  releaseCompanionLock,
} from './services/companion-lock.js';

const fallbackPort = 3030;
const fallbackHost = '127.0.0.1';

export interface CompanionServerOptions {
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

export async function startCompanionServer(
  options: CompanionServerOptions = {},
) {
  const app = await createCompanionServer();

  const port = options.port ?? fallbackPort;
  const host = options.host ?? fallbackHost;

  let lockAcquired = false;

  try {
    acquireCompanionLock(port, host);
    lockAcquired = true;

    await app.listen({
      port,
      host,
    });
  } catch (error) {
    if (lockAcquired) {
      releaseCompanionLock();
    }

    throw error;
  }

  app.log.info(
    {
      event: 'bubble-town-companion-listening',
      host,
      port,
      address: `http://${host}:${port}`,
    },
    'Bubble Town companion server started.',
  );

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