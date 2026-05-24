import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAuxiliaryLlmSettingsResponse, updateAuxiliaryLlmSettingsResponse } from './auxiliary-llm-service.js';
import { getAuxiliaryLLMInvoker, resetAuxiliaryLLMInvokerForTests } from './auxiliary-llm-invoker.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-hermes-api-aux-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'profiles', 'sami'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('AuxiliaryLLMInvoker 在 world-state taskType 命中时使用 auxiliary runtime 并记录 recent status', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.example.com/v1/responses');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer sk-aux-123');
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    assert.equal(payload.model, 'gpt-4.1-mini');
    return new Response(JSON.stringify({
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: '{"candidates":[]}',
            },
          ],
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    updateAuxiliaryLlmSettingsResponse({
      profileId: 'sami',
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4.1-mini',
      thinkingEnabled: false,
      reasoningEffort: 'high',
      defaultTimeoutMs: 9000,
      useFor: ['world-state'],
      apiKey: 'sk-aux-123',
    });

    const response = await getAuxiliaryLLMInvoker().invoke<{ candidates: unknown[] }>({
      profileId: 'sami',
      taskType: 'world-state',
      input: 'hello',
      runtimeInstructions: 'return json',
      schemaName: 'bubble_town_test',
      schema: {
        type: 'object',
      },
    });

    assert.deepEqual(response, { candidates: [] });
    const settingsResponse = getAuxiliaryLlmSettingsResponse('sami');
    assert.equal(settingsResponse.status.lastInvocation?.status, 'success');
    assert.equal(settingsResponse.status.lastInvocation?.taskType, 'world-state');
  } finally {
    resetAuxiliaryLLMInvokerForTests();
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('AuxiliaryLLMInvoker 在 /responses 不可用时回退到 /chat/completions structured output', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  globalThis.fetch = async (input, init) => {
    fetchCalls.push(String(input));
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;

    if (String(input) === 'https://api.example.com/v1/responses') {
      return new Response('not found', { status: 404 });
    }

    assert.equal(String(input), 'https://api.example.com/v1/chat/completions');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer sk-aux-123');
    assert.equal(payload.model, 'gpt-4.1-mini');
    assert.deepEqual(payload.response_format, {
      type: 'json_schema',
      json_schema: {
        name: 'bubble_town_test',
        schema: {
          type: 'object',
        },
        strict: true,
      },
    });

    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: '{"candidates":[]}',
          },
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    updateAuxiliaryLlmSettingsResponse({
      profileId: 'sami',
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4.1-mini',
      thinkingEnabled: false,
      reasoningEffort: 'high',
      defaultTimeoutMs: 9000,
      useFor: ['world-state'],
      apiKey: 'sk-aux-123',
    });

    const response = await getAuxiliaryLLMInvoker().invoke<{ candidates: unknown[] }>({
      profileId: 'sami',
      taskType: 'world-state',
      input: 'hello',
      runtimeInstructions: 'return json',
      schemaName: 'bubble_town_test',
      schema: {
        type: 'object',
      },
    });

    assert.deepEqual(response, { candidates: [] });
    assert.deepEqual(fetchCalls, [
      'https://api.example.com/v1/responses',
      'https://api.example.com/v1/chat/completions',
    ]);
  } finally {
    resetAuxiliaryLLMInvokerForTests();
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('AuxiliaryLLMInvoker 在 response_format 不可用时回退到 prompt-only JSON 输出', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; payload: Record<string, unknown> }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    fetchCalls.push({ url, payload });

    if (url === 'https://api.example.com/v1/responses') {
      return new Response('not found', { status: 404 });
    }

    if (fetchCalls.length === 2) {
      assert.equal(url, 'https://api.example.com/v1/chat/completions');
      assert.deepEqual(payload.response_format, {
        type: 'json_schema',
        json_schema: {
          name: 'bubble_town_test',
          schema: {
            type: 'object',
          },
          strict: true,
        },
      });
      return new Response(JSON.stringify({
        error: {
          message: 'This response_format type is unavailable now',
          type: 'invalid_request_error',
        },
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    assert.equal(url, 'https://api.example.com/v1/chat/completions');
    assert.equal(payload.response_format, undefined);
    assert.match(String((payload.messages as Array<{ role: string; content: string }>)[0]?.content ?? ''), /严格只输出一个 JSON 对象/);

    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: '{"candidates":[]}',
          },
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    updateAuxiliaryLlmSettingsResponse({
      profileId: 'sami',
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4.1-mini',
      thinkingEnabled: false,
      reasoningEffort: 'high',
      defaultTimeoutMs: 9000,
      useFor: ['world-state'],
      apiKey: 'sk-aux-123',
    });

    const response = await getAuxiliaryLLMInvoker().invoke<{ candidates: unknown[] }>({
      profileId: 'sami',
      taskType: 'world-state',
      input: 'hello',
      runtimeInstructions: 'return json',
      schemaName: 'bubble_town_test',
      schema: {
        type: 'object',
      },
    });

    assert.deepEqual(response, { candidates: [] });
    assert.deepEqual(fetchCalls.map((call) => call.url), [
      'https://api.example.com/v1/responses',
      'https://api.example.com/v1/chat/completions',
      'https://api.example.com/v1/chat/completions',
    ]);
  } finally {
    resetAuxiliaryLLMInvokerForTests();
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('AuxiliaryLLMInvoker 对 DeepSeek auxiliary 请求附加 thinking 与 reasoning_effort', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  globalThis.fetch = async (input, init) => {
    fetchCalls.push(String(input));
    assert.equal(String(input), 'https://api.deepseek.com/v1/chat/completions');
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    assert.deepEqual(payload.thinking, { type: 'enabled' });
    assert.equal(payload.reasoning_effort, 'max');
    assert.deepEqual(payload.response_format, { type: 'json_object' });

    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: '{"candidates":[]}',
          },
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    updateAuxiliaryLlmSettingsResponse({
      profileId: 'sami',
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      thinkingEnabled: true,
      reasoningEffort: 'max',
      defaultTimeoutMs: 9000,
      useFor: ['world-state'],
      apiKey: 'sk-deepseek-123',
    });

    const response = await getAuxiliaryLLMInvoker().invoke<{ candidates: unknown[] }>({
      profileId: 'sami',
      taskType: 'world-state',
      input: 'hello',
      runtimeInstructions: 'return json',
      schemaName: 'bubble_town_test',
      schema: {
        type: 'object',
      },
    });

    assert.deepEqual(response, { candidates: [] });
    assert.deepEqual(fetchCalls, ['https://api.deepseek.com/v1/chat/completions']);
  } finally {
    resetAuxiliaryLLMInvokerForTests();
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('AuxiliaryLLMInvoker 在 DeepSeek thinking disabled 时不发送 reasoning_effort', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.deepseek.com/v1/chat/completions');
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    assert.deepEqual(payload.thinking, { type: 'disabled' });
    assert.equal('reasoning_effort' in payload, false);

    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: '{"candidates":[]}',
          },
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    updateAuxiliaryLlmSettingsResponse({
      profileId: 'sami',
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      thinkingEnabled: false,
      reasoningEffort: 'max',
      defaultTimeoutMs: 9000,
      useFor: ['world-state'],
      apiKey: 'sk-deepseek-123',
    });

    const response = await getAuxiliaryLLMInvoker().invoke<{ candidates: unknown[] }>({
      profileId: 'sami',
      taskType: 'world-state',
      input: 'hello',
      runtimeInstructions: 'return json',
      schemaName: 'bubble_town_test',
      schema: {
        type: 'object',
      },
    });

    assert.deepEqual(response, { candidates: [] });
  } finally {
    resetAuxiliaryLLMInvokerForTests();
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});
