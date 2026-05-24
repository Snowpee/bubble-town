import type {
  AuxiliaryLlmSettingsResponse,
  AuxiliaryLlmSettings,
  TestAuxiliaryLlmConnectionRequest,
  TestAuxiliaryLlmConnectionResponse,
  UpdateAuxiliaryLlmSettingsRequest,
} from '@bubble-town/shared';
import {
  AVAILABLE_AUXILIARY_LLM_USE_CASES,
  getAuxiliaryLlmSettings,
  getAuxiliaryLlmStatus,
  getStoredAuxiliaryLlmApiKey,
  updateAuxiliaryLlmSettings,
} from '../store/auxiliary-llm-store.js';

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

function resolveEffectiveApiKey(input: TestAuxiliaryLlmConnectionRequest): string | undefined {
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    return input.apiKey.trim();
  }
  return getStoredAuxiliaryLlmApiKey(input.profileId);
}

export function getAuxiliaryLlmSettingsResponse(profileId?: string): AuxiliaryLlmSettingsResponse {
  return {
    settings: getAuxiliaryLlmSettings(profileId),
    availableUseCases: [...AVAILABLE_AUXILIARY_LLM_USE_CASES],
    status: getAuxiliaryLlmStatus(profileId),
  };
}

export function updateAuxiliaryLlmSettingsResponse(input: UpdateAuxiliaryLlmSettingsRequest): AuxiliaryLlmSettingsResponse {
  const settings = updateAuxiliaryLlmSettings(input);
  return {
    settings,
    availableUseCases: [...AVAILABLE_AUXILIARY_LLM_USE_CASES],
    status: getAuxiliaryLlmStatus(settings.profileId),
  };
}

export async function testAuxiliaryLlmConnectionResponse(
  input: TestAuxiliaryLlmConnectionRequest,
): Promise<TestAuxiliaryLlmConnectionResponse> {
  const apiKey = resolveEffectiveApiKey(input);
  const baseUrl = normalizeBaseUrl(input.baseUrl.trim());
  const model = input.model.trim();
  const timeoutMs = Number.isFinite(input.defaultTimeoutMs) ? Math.max(1000, Math.round(input.defaultTimeoutMs)) : 15_000;

  if (!baseUrl) {
    return { ok: false, message: 'Base URL 不能为空。' };
  }
  if (!model) {
    return { ok: false, message: 'Model 不能为空。' };
  }
  if (!apiKey) {
    return { ok: false, message: 'API Key 未配置。' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const details = await response.text();
      return {
        ok: false,
        message: `连接测试失败：${response.status}${details ? ` ${details}` : ''}`,
      };
    }

    const payload = (await response.json()) as { data?: unknown[] };
    return {
      ok: true,
      message: '连接成功。',
      modelCount: Array.isArray(payload.data) ? payload.data.length : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `连接测试失败：${error.message}` : '连接测试失败。',
    };
  } finally {
    clearTimeout(timer);
  }
}
