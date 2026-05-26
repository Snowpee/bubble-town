import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCharacter, createStoryline, resetStoryRuntimeForTests } from '../../store/story-runtime-store.js';
import { applyWorldStateUpdateCandidate } from './world-state.js';
import { createStructuredWorldStateExtractor, WORLD_STATE_CANDIDATE_SCHEMA } from './world-state-extractor.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-world-state-extractor-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  resetStoryRuntimeForTests();
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('structured world state extractor 按 schema 请求 Hermes 并解析位置类 candidate', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; payload: Record<string, unknown> }> = [];

  globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    fetchCalls.push({ url: String(input), payload });

    return new Response(
      JSON.stringify({
        id: 'resp-world-state-structured',
        model: 'hermes-agent',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  candidates: [
                    {
                      objectLabel: '家门钥匙',
                      stateKind: 'location',
                      state: 'located',
                      locationText: '玄关柜第二层抽屉里',
                      actionType: 'place',
                      sourceSpan: '把家门钥匙放在玄关柜第二层抽屉里了',
                      isCurrentStableState: true,
                      confidence: 0.93,
                    },
                  ],
                }),
              },
            ],
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  };

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
      currentSceneId: 'apartment_entry',
    });
    const extractor = createStructuredWorldStateExtractor();

    const candidates = await extractor.extract({
      storyline,
      userInput: '我把家门钥匙放在玄关柜第二层抽屉里了。',
      assistantOutput: '好，我记住钥匙的位置了。',
      sourceMessageIds: ['session-1', 'resp-1'],
      executionOptions: {
        apiBaseUrl: 'http://127.0.0.1:9651/v1',
        managedGatewayProfileId: 'sami-story-001',
      },
    });

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]?.url, 'http://127.0.0.1:9651/v1/responses');
    assert.equal(fetchCalls[0]?.payload.store, false);
    assert.deepEqual(fetchCalls[0]?.payload.text, {
      format: {
        type: 'json_schema',
        name: 'bubble_town_world_state_candidates',
        schema: WORLD_STATE_CANDIDATE_SCHEMA,
        strict: true,
      },
    });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.sceneId, 'apartment_entry');
    assert.equal(candidates[0]?.stateKind, 'location');
    assert.equal(candidates[0]?.objectLabel, '家门钥匙');
    assert.equal(candidates[0]?.state, 'located');
    assert.equal(candidates[0]?.locationText, '玄关柜第二层抽屉里');
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('structured world state extractor 被 obvious reject rules 命中时不会请求 Hermes', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('should not fetch');
  };

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
      currentSceneId: 'north_window_room',
    });
    const extractor = createStructuredWorldStateExtractor();

    const candidates = await extractor.extract({
      storyline,
      userInput: '如果我把旧台灯砸碎会怎样？',
      assistantOutput: '我会先看看你有没有受伤。',
      executionOptions: {
        apiBaseUrl: 'http://127.0.0.1:9651/v1',
        managedGatewayProfileId: 'sami-story-001',
      },
    });

    assert.equal(fetchCalled, false);
    assert.deepEqual(candidates, []);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('structured world state extractor 会把当前 sceneProjection 一并提供给模型用于覆盖旧状态', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ payload: Record<string, unknown> }> = [];

  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    fetchCalls.push({ payload });

    return new Response(
      JSON.stringify({
        id: 'resp-world-state-reversal',
        model: 'hermes-agent',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  candidates: [
                    {
                      objectLabel: '钥匙',
                      stateKind: 'status',
                      state: 'found',
                      actionType: 'move',
                      sourceSpan: '钥匙找到了',
                      isCurrentStableState: true,
                      confidence: 0.88,
                    },
                    {
                      objectLabel: '抽屉',
                      stateKind: 'status',
                      state: 'intact',
                      actionType: 'repair',
                      sourceSpan: '抽屉还挺好，我也给捡回来了',
                      isCurrentStableState: true,
                      confidence: 0.82,
                    },
                  ],
                }),
              },
            ],
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  };

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
      currentSceneId: 'apartment_entry',
    });

    applyWorldStateUpdateCandidate({
      storylineId: storyline.id,
      candidate: {
        sceneId: 'apartment_entry',
        objectLabel: '钥匙',
        stateKind: 'status',
        state: 'lost',
        actionType: 'unknown',
        sourceSpan: '钥匙忘在抽屉里并丢了',
        isCurrentStableState: true,
        reason: '旧状态。',
        confidence: 0.91,
      },
    });
    applyWorldStateUpdateCandidate({
      storylineId: storyline.id,
      candidate: {
        sceneId: 'apartment_entry',
        objectLabel: '抽屉',
        stateKind: 'status',
        state: 'discarded',
        actionType: 'unknown',
        sourceSpan: '抽屉被扔了',
        isCurrentStableState: true,
        reason: '旧状态。',
        confidence: 0.91,
      },
    });

    const extractor = createStructuredWorldStateExtractor();
    const candidates = await extractor.extract({
      storyline,
      userInput: '钥匙找到了。我发现抽屉还挺好，我也给捡回来了！',
      assistantOutput: '太好了，钥匙找回来了，抽屉也捡回来了。',
      executionOptions: {
        apiBaseUrl: 'http://127.0.0.1:9651/v1',
        managedGatewayProfileId: 'sami-story-001',
      },
    });

    assert.equal(candidates.length, 2);
    assert.match(String(fetchCalls[0]?.payload.instructions), /省略主语或代词化的恢复表达/);
    assert.match(String(fetchCalls[0]?.payload.input), /sceneProjectionSummary:/);
    assert.match(String(fetchCalls[0]?.payload.input), /钥匙当前状态为 lost/);
    assert.match(String(fetchCalls[0]?.payload.input), /抽屉当前状态为 discarded/);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});
