import { startCompanionServer } from './server.js';

function readCompanionHost() {
  return process.env.COMPANION_HOST ?? '127.0.0.1';
}

function readCompanionPort() {
  const raw = process.env.COMPANION_PORT ?? '3030';
  const port = Number(raw);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid COMPANION_PORT: ${raw}`);
  }

  return port;
}

const host = readCompanionHost();
const port = readCompanionPort();

console.log(
  JSON.stringify({
    event: 'bubble-town-companion-start',
    pid: process.pid,
    host,
    port,
    hermesHome: process.env.HERMES_HOME,
    electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE,
  }),
);

startCompanionServer({
  host,
  port,
}).catch((error) => {
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