import Fastify from 'fastify';
import cors from '@fastify/cors';
import { pathToFileURL } from 'node:url';
import { registerChatRoutes } from './routes/chat.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerProfileRoutes } from './routes/profiles.js';
import { registerSessionRoutes } from './routes/sessions.js';

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
  await registerChatRoutes(app);

  app.get('/api/ping', async () => ({ ok: true }));

  return app;
}

export async function startCompanionServer(options: CompanionServerOptions = {}) {
  const app = await createCompanionServer();
  const port = options.port ?? defaultPort;
  const host = options.host ?? defaultHost;

  await app.listen({ port, host });
  return app;
}

function isExecutedDirectly() {
  const entryArg = process.argv[1];
  return Boolean(entryArg) && import.meta.url === pathToFileURL(entryArg).href;
}

if (isExecutedDirectly()) {
  startCompanionServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
