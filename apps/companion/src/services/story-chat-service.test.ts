import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sendStorylineChat } from './story-chat-service.js';
import { resetManagedHermesGatewayStateForTests, setManagedHermesGatewayProfileForTests } from './hermes-gateway.js';
import {
  createCharacter,
  createStoryline,
  getRuntimeSessionForStoryline,
  resetStoryRuntimeForTests,
} from './story-runtime-store.js';

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
    assert.equal(getRuntimeSessionForStoryline(storyline.id)?.hermesSessionId, 'story-session-1');
    assert.equal(getRuntimeSessionForStoryline(storyline.id)?.previousResponseId, 'resp-story-1');
    const chatCall = fetchCalls.find((call) => call.url.endsWith('/responses'));
    assert.equal(chatCall?.url, 'http://127.0.0.1:9651/v1/responses');
    assert.match(String(chatCall?.payload.input), /BubbleTownContextPack/);
    assert.match(String(chatCall?.payload.input), /你在吗？/);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});
