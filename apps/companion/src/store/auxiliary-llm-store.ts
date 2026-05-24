import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type {
  AuxiliaryLlmAuditEntry,
  AuxiliaryLlmSettings,
  AuxiliaryLlmStatusSnapshot,
  AuxiliaryLlmUseCase,
  UpdateAuxiliaryLlmSettingsRequest,
} from '@bubble-town/shared';
import { DEFAULT_PROFILE_ID } from '@bubble-town/shared';
import { getConfigPath, getProfileHome } from '../adapters/hermes/hermes-paths.js';

const DEFAULT_AUXILIARY_LLM_PROVIDER = 'openai-compatible' as const;
const DEFAULT_AUXILIARY_LLM_TIMEOUT_MS = 15_000;
const DEFAULT_AUXILIARY_LLM_REASONING_EFFORT = 'high' as const;
const DEFAULT_AUXILIARY_LLM_USE_FOR: AuxiliaryLlmUseCase[] = ['world-state'];
const AUXILIARY_LLM_SECRET_KEY = 'auxiliary_llm_api_key';
const AUXILIARY_LLM_SECRET_FILE = '.bubble-town-secrets.json';
const AUXILIARY_LLM_SECRET_REF = 'bubble-town:auxiliary-llm';
const AUXILIARY_LLM_STATUS_FILE = '.bubble-town-auxiliary-llm-status.json';
const MAX_AUXILIARY_LLM_AUDIT_ENTRIES = 20;

interface ProfileSecrets {
  auxiliary_llm_api_key?: string;
}

interface AuxiliaryLlmStatusFile {
  lastInvocation?: AuxiliaryLlmAuditEntry;
  lastError?: AuxiliaryLlmAuditEntry;
  recentAudit: AuxiliaryLlmAuditEntry[];
}

export interface ResolvedAuxiliaryLlmRuntime extends AuxiliaryLlmSettings {
  apiKey?: string;
}

export const AVAILABLE_AUXILIARY_LLM_USE_CASES: AuxiliaryLlmUseCase[] = ['world-state'];

function normalizeProfileId(profileId?: string) {
  return profileId?.trim() || DEFAULT_PROFILE_ID;
}

function createDefaultSettings(profileId: string): AuxiliaryLlmSettings {
  return {
    profileId,
    enabled: false,
    provider: DEFAULT_AUXILIARY_LLM_PROVIDER,
    baseUrl: '',
    model: '',
    thinkingEnabled: false,
    reasoningEffort: DEFAULT_AUXILIARY_LLM_REASONING_EFFORT,
    defaultTimeoutMs: DEFAULT_AUXILIARY_LLM_TIMEOUT_MS,
    useFor: [...DEFAULT_AUXILIARY_LLM_USE_FOR],
    apiKeyConfigured: false,
  };
}

function getSecretFilePath(profileId: string) {
  return path.join(getProfileHome(profileId), AUXILIARY_LLM_SECRET_FILE);
}

function getStatusFilePath(profileId: string) {
  return path.join(getProfileHome(profileId), AUXILIARY_LLM_STATUS_FILE);
}

function readConfigDocument(profileId: string) {
  const configPath = getConfigPath(profileId);
  const rawConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const configDoc = rawConfig.trim() ? YAML.parseDocument(rawConfig) : new YAML.Document({});
  if (configDoc.errors.length > 0) {
    throw new Error(`config.yaml 解析失败：${configPath}：${configDoc.errors[0]?.message ?? '未知 YAML 错误'}`);
  }
  return {
    configDoc,
    configPath,
  };
}

function readSecrets(profileId: string): ProfileSecrets {
  const secretPath = getSecretFilePath(profileId);
  if (!fs.existsSync(secretPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(secretPath, 'utf8')) as ProfileSecrets;
  } catch {
    return {};
  }
}

function writeSecrets(profileId: string, secrets: ProfileSecrets) {
  const secretPath = getSecretFilePath(profileId);
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });

  if (!secrets.auxiliary_llm_api_key?.trim()) {
    if (fs.existsSync(secretPath)) {
      fs.rmSync(secretPath, { force: true });
    }
    return;
  }

  fs.writeFileSync(secretPath, `${JSON.stringify(secrets, null, 2)}\n`, 'utf8');
  try {
    fs.chmodSync(secretPath, 0o600);
  } catch {
    // Best effort only on current platform/fs.
  }
}

function createEmptyStatusSnapshot(): AuxiliaryLlmStatusSnapshot {
  return {
    recentAudit: [],
  };
}

function readStatusFile(profileId: string): AuxiliaryLlmStatusFile {
  const statusPath = getStatusFilePath(profileId);
  if (!fs.existsSync(statusPath)) {
    return createEmptyStatusSnapshot();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as Partial<AuxiliaryLlmStatusFile>;
    return {
      lastInvocation: parsed.lastInvocation,
      lastError: parsed.lastError,
      recentAudit: Array.isArray(parsed.recentAudit) ? parsed.recentAudit : [],
    };
  } catch {
    return createEmptyStatusSnapshot();
  }
}

function writeStatusFile(profileId: string, status: AuxiliaryLlmStatusFile) {
  const statusPath = getStatusFilePath(profileId);
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

function sanitizeUseFor(value: unknown): AuxiliaryLlmUseCase[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_AUXILIARY_LLM_USE_FOR];
  }

  const allowed = new Set<AuxiliaryLlmUseCase>(AVAILABLE_AUXILIARY_LLM_USE_CASES);
  const useFor = value
    .filter((entry): entry is AuxiliaryLlmUseCase => typeof entry === 'string' && allowed.has(entry as AuxiliaryLlmUseCase));

  return useFor.length > 0 ? Array.from(new Set(useFor)) : [...DEFAULT_AUXILIARY_LLM_USE_FOR];
}

function normalizeTimeout(value: unknown): number {
  const timeout = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(timeout) || timeout < 1000) {
    return DEFAULT_AUXILIARY_LLM_TIMEOUT_MS;
  }
  return Math.round(timeout);
}

function normalizeReasoningEffort(value: unknown): 'high' | 'max' {
  return value === 'max' ? 'max' : DEFAULT_AUXILIARY_LLM_REASONING_EFFORT;
}

function readInlineApiKey(profileId: string): string | undefined {
  const { configDoc } = readConfigDocument(profileId);
  const inlineKey = configDoc.getIn(['bubble_town', 'auxiliary_llm', 'api_key']);
  return typeof inlineKey === 'string' && inlineKey.trim() ? inlineKey.trim() : undefined;
}

export function getStoredAuxiliaryLlmApiKey(profileId?: string): string | undefined {
  const normalizedProfileId = normalizeProfileId(profileId);
  const secrets = readSecrets(normalizedProfileId);
  if (typeof secrets.auxiliary_llm_api_key === 'string' && secrets.auxiliary_llm_api_key.trim()) {
    return secrets.auxiliary_llm_api_key.trim();
  }
  return readInlineApiKey(normalizedProfileId);
}

export function getAuxiliaryLlmStatus(profileId?: string): AuxiliaryLlmStatusSnapshot {
  return readStatusFile(normalizeProfileId(profileId));
}

export function recordAuxiliaryLlmInvocation(profileId: string | undefined, entry: AuxiliaryLlmAuditEntry) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const current = readStatusFile(normalizedProfileId);
  const nextAudit = [entry, ...current.recentAudit.filter((item) => item.id !== entry.id)].slice(0, MAX_AUXILIARY_LLM_AUDIT_ENTRIES);
  const nextStatus: AuxiliaryLlmStatusFile = {
    lastInvocation: entry,
    lastError: entry.status === 'error' ? entry : current.lastError,
    recentAudit: nextAudit,
  };

  if (entry.status === 'success' && current.lastError?.id === entry.id) {
    nextStatus.lastError = undefined;
  }

  writeStatusFile(normalizedProfileId, nextStatus);
}

export function getAuxiliaryLlmSettings(profileId?: string): AuxiliaryLlmSettings {
  const normalizedProfileId = normalizeProfileId(profileId);
  const defaults = createDefaultSettings(normalizedProfileId);
  const { configDoc } = readConfigDocument(normalizedProfileId);
  const inlineApiKey = configDoc.getIn(['bubble_town', 'auxiliary_llm', 'api_key']);
  const enabled = configDoc.getIn(['bubble_town', 'auxiliary_llm', 'enabled']);
  const provider = configDoc.getIn(['bubble_town', 'auxiliary_llm', 'provider']);
  const baseUrl = configDoc.getIn(['bubble_town', 'auxiliary_llm', 'base_url']);
  const model = configDoc.getIn(['bubble_town', 'auxiliary_llm', 'model']);
  const thinkingEnabled = configDoc.getIn(['bubble_town', 'auxiliary_llm', 'thinking']);
  const reasoningEffort = configDoc.getIn(['bubble_town', 'auxiliary_llm', 'reasoning_effort']);

  return {
    ...defaults,
    enabled: typeof enabled === 'boolean' ? enabled : defaults.enabled,
    provider: provider === DEFAULT_AUXILIARY_LLM_PROVIDER ? DEFAULT_AUXILIARY_LLM_PROVIDER : defaults.provider,
    baseUrl: typeof baseUrl === 'string' ? baseUrl.trim() : defaults.baseUrl,
    model: typeof model === 'string' ? model.trim() : defaults.model,
    thinkingEnabled: typeof thinkingEnabled === 'boolean' ? thinkingEnabled : defaults.thinkingEnabled,
    reasoningEffort: normalizeReasoningEffort(reasoningEffort),
    defaultTimeoutMs: normalizeTimeout(configDoc.getIn(['bubble_town', 'auxiliary_llm', 'default_timeout_ms'])),
    useFor: sanitizeUseFor(configDoc.getIn(['bubble_town', 'auxiliary_llm', 'use_for'])),
    apiKeyConfigured: Boolean(getStoredAuxiliaryLlmApiKey(normalizedProfileId) || (typeof inlineApiKey === 'string' && inlineApiKey.trim())),
  };
}

export function updateAuxiliaryLlmSettings(input: UpdateAuxiliaryLlmSettingsRequest): AuxiliaryLlmSettings {
  const profileId = normalizeProfileId(input.profileId);
  const { configDoc, configPath } = readConfigDocument(profileId);
  const nextSettings: AuxiliaryLlmSettings = {
    profileId,
    enabled: Boolean(input.enabled),
    provider: DEFAULT_AUXILIARY_LLM_PROVIDER,
    baseUrl: input.baseUrl.trim(),
    model: input.model.trim(),
    thinkingEnabled: Boolean(input.thinkingEnabled),
    reasoningEffort: normalizeReasoningEffort(input.reasoningEffort),
    defaultTimeoutMs: normalizeTimeout(input.defaultTimeoutMs),
    useFor: sanitizeUseFor(input.useFor),
    apiKeyConfigured: false,
  };

  configDoc.setIn(['bubble_town', 'auxiliary_llm', 'enabled'], nextSettings.enabled);
  configDoc.setIn(['bubble_town', 'auxiliary_llm', 'provider'], nextSettings.provider);
  configDoc.setIn(['bubble_town', 'auxiliary_llm', 'base_url'], nextSettings.baseUrl);
  configDoc.setIn(['bubble_town', 'auxiliary_llm', 'model'], nextSettings.model);
  configDoc.setIn(['bubble_town', 'auxiliary_llm', 'thinking'], nextSettings.thinkingEnabled);
  configDoc.setIn(['bubble_town', 'auxiliary_llm', 'reasoning_effort'], nextSettings.reasoningEffort);
  configDoc.setIn(['bubble_town', 'auxiliary_llm', 'default_timeout_ms'], nextSettings.defaultTimeoutMs);
  configDoc.setIn(['bubble_town', 'auxiliary_llm', 'use_for'], nextSettings.useFor);

  const nextApiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : undefined;
  const shouldClearApiKey = input.clearApiKey === true;
  if (nextApiKey !== undefined || shouldClearApiKey) {
    writeSecrets(profileId, {
      [AUXILIARY_LLM_SECRET_KEY]: shouldClearApiKey ? undefined : (nextApiKey || undefined),
    });
    if (!shouldClearApiKey && nextApiKey) {
      configDoc.setIn(['bubble_town', 'auxiliary_llm', 'api_key_ref'], AUXILIARY_LLM_SECRET_REF);
    } else {
      configDoc.deleteIn(['bubble_town', 'auxiliary_llm', 'api_key_ref']);
    }
    configDoc.deleteIn(['bubble_town', 'auxiliary_llm', 'api_key']);
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, String(configDoc), 'utf8');

  return getAuxiliaryLlmSettings(profileId);
}

export function resolveAuxiliaryLlmRuntime(profileId: string | undefined, useCase: AuxiliaryLlmUseCase): ResolvedAuxiliaryLlmRuntime | undefined {
  const settings = getAuxiliaryLlmSettings(profileId);
  const apiKey = getStoredAuxiliaryLlmApiKey(profileId);
  if (!settings.enabled || !settings.useFor.includes(useCase) || !AVAILABLE_AUXILIARY_LLM_USE_CASES.includes(useCase)) {
    return undefined;
  }

  return {
    ...settings,
    apiKey,
  };
}
