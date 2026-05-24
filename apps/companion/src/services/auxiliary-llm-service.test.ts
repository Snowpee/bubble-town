import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getAuxiliaryLlmSettingsResponse,
  testAuxiliaryLlmConnectionResponse,
  updateAuxiliaryLlmSettingsResponse,
} from './auxiliary-llm-service.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-aux-llm-service-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'profiles', 'sami'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('testAuxiliaryLlmConnectionResponse 使用已保存配置进行连接测试', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.example.com/v1/models');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer sk-saved-123');
    return new Response(JSON.stringify({ data: [{ id: 'gpt-4.1-mini' }] }), {
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
      defaultTimeoutMs: 8000,
      useFor: ['world-state'],
      apiKey: 'sk-saved-123',
    });

    const result = await testAuxiliaryLlmConnectionResponse({
      profileId: 'sami',
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4.1-mini',
      thinkingEnabled: false,
      reasoningEffort: 'high',
      defaultTimeoutMs: 8000,
      useFor: ['world-state'],
    });

    assert.equal(result.ok, true);
    assert.equal(result.modelCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('getAuxiliaryLlmSettingsResponse 返回 settings 与 status 聚合响应', () => {
  const hermesHome = createHermesHome();

  try {
    updateAuxiliaryLlmSettingsResponse({
      profileId: 'sami',
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4.1-mini',
      thinkingEnabled: false,
      reasoningEffort: 'high',
      defaultTimeoutMs: 8000,
      useFor: ['world-state'],
      apiKey: 'sk-saved-123',
    });

    const response = getAuxiliaryLlmSettingsResponse('sami');
    assert.equal(response.settings.profileId, 'sami');
    assert.equal(response.settings.apiKeyConfigured, true);
    assert.deepEqual(response.availableUseCases, ['world-state']);
    assert.deepEqual(response.status.recentAudit, []);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});
