import { startCompanionServer } from './server.js';

console.log(
  JSON.stringify({
    event: 'bubble-town-companion-start',
    pid: process.pid,
    host: process.env.COMPANION_HOST ?? '127.0.0.1',
    port: Number(process.env.COMPANION_PORT ?? 3030),
    hermesHome: process.env.HERMES_HOME,
    electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE,
  }),
);

startCompanionServer().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'bubble-town-companion-start-failed',
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : error,
    }),
  );
  console.error(error);
  process.exit(1);
});
