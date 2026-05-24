import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { registerStorylineRoutes } from './storylines.js';
import {
  createActivityLog,
  createCharacter,
  createMemoryRecord,
  createStoryline,
  createSuppressedMemory,
  resetStoryRuntimeForTests,
} from '../store/story-runtime-store.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-storyline-routes-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  return hermesHome;
}

async function createApp() {
  const app = Fastify();
  await registerStorylineRoutes(app);
  return app;
}

async function cleanup(app: Awaited<ReturnType<typeof createApp>>, hermesHome: string) {
  await app.close();
  resetStoryRuntimeForTests();
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('storyline routes 通过 service 边界返回 memories、suppressedMemories 与 activityLogs', async () => {
  const hermesHome = createHermesHome();
  const app = await createApp();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '路由读取',
    });
    createMemoryRecord(storyline.id, {
      content: '用户喜欢晚饭后散步。',
      kind: 'preference',
    });
    createSuppressedMemory(storyline.id, {
      pattern: '不要主动提昨晚争吵。',
    });
    createActivityLog(storyline.id, {
      summary: '用户和 Sami 在晚饭后散步。',
      tags: ['daily'],
    });

    const [memoriesResponse, suppressedResponse, activityResponse] = await Promise.all([
      app.inject({
        method: 'GET',
        url: `/api/storylines/${storyline.id}/memories`,
      }),
      app.inject({
        method: 'GET',
        url: `/api/storylines/${storyline.id}/suppressed-memories`,
      }),
      app.inject({
        method: 'GET',
        url: `/api/storylines/${storyline.id}/activity`,
      }),
    ]);

    assert.equal(memoriesResponse.statusCode, 200);
    assert.equal(suppressedResponse.statusCode, 200);
    assert.equal(activityResponse.statusCode, 200);

    assert.match(memoriesResponse.body, /晚饭后散步/);
    assert.match(suppressedResponse.body, /不要主动提昨晚争吵/);
    assert.match(activityResponse.body, /晚饭后散步/);
  } finally {
    await cleanup(app, hermesHome);
  }
});
