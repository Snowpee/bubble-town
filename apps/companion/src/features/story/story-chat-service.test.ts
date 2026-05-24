import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { previewContextPackForInput, sendStorylineChat } from './story-chat-service.js';
import { resetManagedHermesGatewayStateForTests, setManagedHermesGatewayProfileForTests } from '../../adapters/hermes/hermes-gateway.js';
import {
  createCharacter,
  createStoryline,
  listAllActivityLogs,
  listAllMemoryRecords,
  getRuntimeSessionForStoryline,
  resetStoryRuntimeForTests,
} from '../../store/story-runtime-store.js';
import { updateAuxiliaryLlmSettings } from '../../store/auxiliary-llm-store.js';
import { waitForPendingWorldStateJobsForTests } from './story-memory-continuity.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-story-chat-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(hermesHome, 'profiles', 'sami-story-001', 'sessions'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  resetStoryRuntimeForTests();
  resetManagedHermesGatewayStateForTests();
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('sendStorylineChat 解析 Storyline profile 并写入 RuntimeSession', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; payload: Record<string, unknown> }> = [];

  globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    fetchCalls.push({ url: String(input), payload });

    if (payload.text && typeof payload.text === 'object') {
      const schemaName = String(
        (payload.text as { format?: { name?: string } }).format?.name ?? '',
      );
      return new Response(
        JSON.stringify({
          id: schemaName === 'bubble_town_world_state_side_channel' ? 'resp-world-state-gate' : 'resp-structured-world-state',
          model: 'hermes-agent',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{
                type: 'output_text',
                text: schemaName === 'bubble_town_world_state_side_channel'
                  ? '{"decision":"skip","reason":"当前轮次没有新的稳定世界状态。","confidence":0.91,"candidates":[]}'
                  : '{"candidates":[]}',
              }],
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
    }

    return new Response(
      JSON.stringify({
        id: 'resp-story-1',
        model: 'hermes-agent',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '我在。' }],
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Id': 'story-session-1',
        },
      },
    );
  };

  try {
    setManagedHermesGatewayProfileForTests('sami-story-001', 'http://127.0.0.1:9651/v1');
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });

    const response = await sendStorylineChat({
      storylineId: storyline.id,
      input: '你在吗？',
    });

    assert.equal(response.storylineId, storyline.id);
    assert.equal(response.sessionId, 'story-session-1');
    assert.equal(response.responseId, 'resp-story-1');
    assert.equal(response.worldStateDebug?.processingStatus, 'completed');
    assert.equal(response.worldStateDebug?.processingPath, 'skip');
    assert.equal(response.worldStateDebug?.updated, false);
    assert.equal(response.worldStateDebug?.gatingResponse?.decision, 'skip');
    assert.equal(getRuntimeSessionForStoryline(storyline.id)?.hermesSessionId, 'story-session-1');
    assert.equal(getRuntimeSessionForStoryline(storyline.id)?.previousResponseId, 'resp-story-1');
    const chatCall = fetchCalls.find((call) => call.url.endsWith('/responses') && !call.payload.text);
    assert.equal(chatCall?.url, 'http://127.0.0.1:9651/v1/responses');
    assert.equal(chatCall?.payload.input, '你在吗？');
    assert.match(String(chatCall?.payload.instructions), /BubbleTownContextPack/);
    assert.doesNotMatch(String(chatCall?.payload.input), /BubbleTownContextPack/);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('sendStorylineChat 完成后自动写入活动日志和用户记忆', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (payload.text && typeof payload.text === 'object') {
      const schemaName = String(
        (payload.text as { format?: { name?: string } }).format?.name ?? '',
      );
      return new Response(
        JSON.stringify({
          id: schemaName === 'bubble_town_world_state_side_channel' ? 'resp-world-state-gate' : 'resp-structured-world-state',
          model: 'hermes-agent',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{
                type: 'output_text',
                text: schemaName === 'bubble_town_world_state_side_channel'
                  ? '{"decision":"skip","reason":"当前轮次没有新的稳定世界状态。","confidence":0.88,"candidates":[]}'
                  : '{"candidates":[]}',
              }],
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
    }

    return new Response(
      JSON.stringify({
        id: 'resp-story-memory',
        model: 'hermes-agent',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '人家记住啦。' }],
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Id': 'story-session-memory',
        },
      },
    );
  };

  try {
    setManagedHermesGatewayProfileForTests('sami-story-001', 'http://127.0.0.1:9651/v1');
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });

    await sendStorylineChat({
      storylineId: storyline.id,
      input: '记住，我喜欢晚饭后散步，以后别忘。',
    });

    assert.equal(listAllActivityLogs(storyline.id).length, 1);
    assert.match(listAllMemoryRecords(storyline.id)[0]?.content ?? '', /晚饭后散步/);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('sendStorylineChat 在启用 auxiliary LLM 后异步更新 world-state，并通过抽象层 LLM 发起请求', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; payload: Record<string, unknown> }> = [];

  globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const url = String(input);
    fetchCalls.push({ url, payload });

    if (url === 'https://api.example.com/v1/responses') {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(
        JSON.stringify({
          id: 'resp-world-state-gate-aux',
          model: 'gpt-4.1-mini',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{
                type: 'output_text',
                text: '{"decision":"direct_apply","reason":"用户明确说明了钥匙当前位置。","confidence":0.97,"candidates":[{"objectLabel":"钥匙","stateKind":"location","state":"located","locationText":"垃圾场","actionType":"place","sourceSpan":"我把钥匙丢在垃圾场了","isCurrentStableState":true,"confidence":0.97}]}',
              }],
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
    }

    return new Response(
      JSON.stringify({
        id: 'resp-story-aux-1',
        model: 'hermes-agent',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '你先别急，我们再一起想想。' }],
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Id': 'story-session-aux-1',
        },
      },
    );
  };

  try {
    setManagedHermesGatewayProfileForTests('sami-story-001', 'http://127.0.0.1:9651/v1');
    updateAuxiliaryLlmSettings({
      profileId: 'sami-story-001',
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4.1-mini',
      thinkingEnabled: false,
      reasoningEffort: 'high',
      defaultTimeoutMs: 12000,
      useFor: ['world-state'],
      apiKey: 'sk-aux-123',
    });

    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });

    const response = await sendStorylineChat({
      storylineId: storyline.id,
      input: '我把钥匙丢在垃圾场了',
    });

    assert.equal(response.worldStateDebug?.processingStatus, 'scheduled');
    assert.equal(response.worldStateDebug?.updated, false);
    assert.equal(
      listAllMemoryRecords(storyline.id).some((memory) => memory.kind === 'world_object_state'),
      false,
    );

    await waitForPendingWorldStateJobsForTests();

    const preview = previewContextPackForInput(storyline.id, '钥匙在哪里？');

    assert.equal(
      listAllMemoryRecords(storyline.id).some((memory) => memory.kind === 'world_object_state' && /垃圾场/.test(memory.content)),
      true,
    );
    assert.equal(preview.worldStateDebug?.auxiliaryLlm?.enabledForTurn, true);
    assert.equal(preview.worldStateDebug?.executionMode, 'auxiliary_async');
    assert.equal(preview.worldStateDebug?.events?.some((event) => event.phase === 'gate_started'), true);
    assert.equal(preview.worldStateDebug?.events?.some((event) => event.phase === 'completed'), true);
    assert.equal(
      fetchCalls.some((call) => call.url === 'https://api.example.com/v1/responses'),
      true,
    );
    assert.equal(
      fetchCalls.some((call) => call.url === 'http://127.0.0.1:9651/v1/responses' && !call.payload.text),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});
