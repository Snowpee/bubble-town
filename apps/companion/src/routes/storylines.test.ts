import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { registerStorylineRoutes } from './storylines.js';
import { recordStorylineTurnContinuity } from '../features/story/story-memory-continuity.js';
import { createWorldStateUpdateCandidate, getStorylineSceneId } from '../features/world-state/world-state.js';
import {
  createActivityLog,
  createCharacter,
  createMemoryRecord,
  createPendingSemanticFrame,
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

test('storyline routes 支持批量 memory 治理操作', async () => {
  const hermesHome = createHermesHome();
  const app = await createApp();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-batch',
      title: '批量治理',
    });
    const first = createMemoryRecord(storyline.id, { content: '用户喜欢晚饭后散步。', kind: 'preference' });
    const second = createMemoryRecord(storyline.id, { content: '用户不喜欢突然被打断。', kind: 'boundary' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/storylines/${storyline.id}/memories/batch`,
      payload: {
        memoryIds: [first.id, second.id],
        action: 'hide',
      },
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as { memories: Array<{ id: string; status: string }> };
    assert.deepEqual(payload.memories.map((memory) => memory.status), ['hidden', 'hidden']);
  } finally {
    await cleanup(app, hermesHome);
  }
});

test('storyline routes 支持 pending semantic frame 查询、确认和取消', async () => {
  const hermesHome = createHermesHome();
  const app = await createApp();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-pending',
      title: 'pending 治理',
    });
    const confirmFrame = createPendingSemanticFrame({
      storylineId: storyline.id,
      kind: 'preference_confirm',
      prompt: '确认是否记住用户喜欢雨天散步？',
      candidate: {
        kind: 'preference',
        content: '用户喜欢雨天散步。',
        scope: 'user',
        source: 'auto_extract',
        lifespan: 'long_term',
        importance: 0.7,
        confidence: 0.8,
        reason: '测试 pending frame 确认。',
        shouldPersist: true,
        confirmationRequired: true,
      },
    });
    const cancelFrame = createPendingSemanticFrame({
      storylineId: storyline.id,
      kind: 'relationship_confirm',
      prompt: '确认是否记录关系状态？',
      candidate: {
        kind: 'relationship',
        content: '用户和 Sami 最近和好了。',
        scope: 'story',
        source: 'auto_extract',
        lifespan: 'long_term',
        importance: 0.7,
        confidence: 0.8,
        reason: '测试 pending frame 取消。',
        shouldPersist: true,
        confirmationRequired: true,
      },
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: `/api/storylines/${storyline.id}/pending-semantic-frames`,
    });
    assert.equal(listResponse.statusCode, 200);
    assert.match(listResponse.body, /雨天散步/);

    const confirmResponse = await app.inject({
      method: 'POST',
      url: `/api/storylines/${storyline.id}/pending-semantic-frames/${confirmFrame.id}/confirm`,
    });
    assert.equal(confirmResponse.statusCode, 200);
    assert.match(confirmResponse.body, /"status":"resolved"/);
    assert.match(confirmResponse.body, /"outcome":"created"/);

    const cancelResponse = await app.inject({
      method: 'POST',
      url: `/api/storylines/${storyline.id}/pending-semantic-frames/${cancelFrame.id}/cancel`,
    });
    assert.equal(cancelResponse.statusCode, 200);
    assert.match(cancelResponse.body, /"status":"cancelled"/);
  } finally {
    await cleanup(app, hermesHome);
  }
});

test('storyline routes 提供 latest world-state debug snapshot 读取口径', async () => {
  const hermesHome = createHermesHome();
  const app = await createApp();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: 'world-state-debug',
      currentSceneId: 'entry_room',
    });

    await recordStorylineTurnContinuity({
      storyline,
      userInput: '我把钥匙放在门口柜子里了。',
      assistantOutput: '好，我记住钥匙现在在门口柜子里。',
      sourceMessageIds: ['session-1', 'resp-1'],
      worldStateGate: {
        async decide(input) {
          const candidate = createWorldStateUpdateCandidate({
            sceneId: getStorylineSceneId(input.storyline),
            objectLabel: '钥匙',
            stateKind: 'location',
            state: 'located',
            locationText: '门口柜子里',
            actionType: 'place',
            sourceSpan: '我把钥匙放在门口柜子里了',
            isCurrentStableState: true,
            reason: '当前 turn 明确给出钥匙的稳定位置。',
            confidence: 0.94,
            sourceMessageIds: input.sourceMessageIds,
            sourceActivityIds: input.sourceActivityIds,
          });
          return {
            decision: 'direct_apply',
            reason: '当前 turn 明确描述了钥匙位置。',
            confidence: 0.94,
            candidates: candidate ? [candidate] : [],
          };
        },
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/storylines/${storyline.id}/world-state/debug`,
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /direct_apply/);
    assert.match(response.body, /门口柜子里/);
    assert.match(response.body, /sceneProjection/);
  } finally {
    await cleanup(app, hermesHome);
  }
});

test('storyline routes 提供 unified runtime diagnostics 读取口径', async () => {
  const hermesHome = createHermesHome();
  const app = await createApp();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-002',
      title: 'runtime-diagnostics',
    });

    await recordStorylineTurnContinuity({
      storyline,
      userInput: '我和她最近算是和好了',
      assistantOutput: '如果你愿意，我可以先按和好了来理解。',
      sourceMessageIds: ['session-2', 'resp-2'],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/storylines/${storyline.id}/runtime-diagnostics`,
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /"status":"uncertain"/);
    assert.match(response.body, /pending_confirmation/);
    assert.match(response.body, /canRetry/);
  } finally {
    await cleanup(app, hermesHome);
  }
});

test('storyline routes 支持对最近一次 uncertain diagnostics 触发最小重试', async () => {
  const hermesHome = createHermesHome();
  const app = await createApp();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-003',
      title: 'runtime-diagnostics-retry',
    });

    await recordStorylineTurnContinuity({
      storyline,
      userInput: '我和她最近算是和好了',
      assistantOutput: '如果你愿意，我可以先按和好了来理解。',
      sourceMessageIds: ['session-3', 'resp-3'],
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/storylines/${storyline.id}/runtime-diagnostics/retry`,
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, new RegExp(storyline.id));
    assert.match(response.body, /productMemory/);
  } finally {
    await cleanup(app, hermesHome);
  }
});
