import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getAuxiliaryLlmSettings,
  getAuxiliaryLlmStatus,
  getStoredAuxiliaryLlmApiKey,
  recordAuxiliaryLlmInvocation,
  updateAuxiliaryLlmSettings,
} from './auxiliary-llm-store.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-aux-llm-store-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'profiles', 'sami'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('auxiliary LLM 设置默认返回空配置', () => {
  const hermesHome = createHermesHome();

  try {
    const settings = getAuxiliaryLlmSettings('sami');
    assert.equal(settings.profileId, 'sami');
    assert.equal(settings.enabled, false);
    assert.equal(settings.apiKeyConfigured, false);
    assert.deepEqual(settings.useFor, ['world-state']);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('auxiliary LLM 设置写入 config.yaml，API key 单独存入本地 secret 文件', () => {
  const hermesHome = createHermesHome();

  try {
    const settings = updateAuxiliaryLlmSettings({
      profileId: 'sami',
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4.1-mini',
      thinkingEnabled: false,
      reasoningEffort: 'high',
      defaultTimeoutMs: 12000,
      useFor: ['world-state'],
      apiKey: 'sk-test-123',
    });

    assert.equal(settings.enabled, true);
    assert.equal(settings.apiKeyConfigured, true);
    assert.equal(getStoredAuxiliaryLlmApiKey('sami'), 'sk-test-123');

    const configPath = path.join(hermesHome, 'profiles', 'sami', 'config.yaml');
    const configContent = fs.readFileSync(configPath, 'utf8');
    assert.match(configContent, /auxiliary_llm:/);
    assert.match(configContent, /api_key_ref: bubble-town:auxiliary-llm/);
    assert.doesNotMatch(configContent, /sk-test-123/);

    const secretPath = path.join(hermesHome, 'profiles', 'sami', '.bubble-town-secrets.json');
    assert.equal(fs.existsSync(secretPath), true);
    assert.match(fs.readFileSync(secretPath, 'utf8'), /sk-test-123/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('auxiliary LLM 设置支持显式清空 API key', () => {
  const hermesHome = createHermesHome();

  try {
    updateAuxiliaryLlmSettings({
      profileId: 'sami',
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4.1-mini',
      thinkingEnabled: false,
      reasoningEffort: 'high',
      defaultTimeoutMs: 12000,
      useFor: ['world-state'],
      apiKey: 'sk-test-123',
    });

    const settings = updateAuxiliaryLlmSettings({
      profileId: 'sami',
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4.1-mini',
      thinkingEnabled: false,
      reasoningEffort: 'high',
      defaultTimeoutMs: 12000,
      useFor: ['world-state'],
      clearApiKey: true,
    });

    assert.equal(settings.apiKeyConfigured, false);
    assert.equal(getStoredAuxiliaryLlmApiKey('sami'), undefined);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('auxiliary LLM 设置保存 DeepSeek thinking 与 reasoning_effort', () => {
  const hermesHome = createHermesHome();

  try {
    const settings = updateAuxiliaryLlmSettings({
      profileId: 'sami',
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      thinkingEnabled: true,
      reasoningEffort: 'max',
      defaultTimeoutMs: 12000,
      useFor: ['world-state'],
    });

    assert.equal(settings.thinkingEnabled, true);
    assert.equal(settings.reasoningEffort, 'max');

    const configPath = path.join(hermesHome, 'profiles', 'sami', 'config.yaml');
    const configContent = fs.readFileSync(configPath, 'utf8');
    assert.match(configContent, /thinking: true/);
    assert.match(configContent, /reasoning_effort: max/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('auxiliary LLM recent status 按 profile 记录最近调用和最近错误', () => {
  const hermesHome = createHermesHome();

  try {
    recordAuxiliaryLlmInvocation('sami', {
      id: 'entry-1',
      taskType: 'world-state',
      status: 'success',
      message: 'ok',
      happenedAt: '2026-05-24T00:00:00.000Z',
      model: 'gpt-4.1-mini',
      baseUrl: 'https://api.example.com/v1',
    });
    recordAuxiliaryLlmInvocation('sami', {
      id: 'entry-2',
      taskType: 'world-state',
      status: 'error',
      message: 'failed',
      happenedAt: '2026-05-24T00:01:00.000Z',
      model: 'gpt-4.1-mini',
      baseUrl: 'https://api.example.com/v1',
    });

    const status = getAuxiliaryLlmStatus('sami');
    assert.equal(status.lastInvocation?.id, 'entry-2');
    assert.equal(status.lastError?.id, 'entry-2');
    assert.equal(status.recentAudit.length, 2);
    assert.equal(status.recentAudit[0]?.id, 'entry-2');
  } finally {
    cleanupHermesHome(hermesHome);
  }
});
