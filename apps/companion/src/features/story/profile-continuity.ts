import fs from 'node:fs';
import YAML from 'yaml';
import type { ProfileContinuityValidationResponse } from '@bubble-town/shared';
import { getConfigPath } from '../../adapters/hermes/hermes-paths.js';

export function validateProfileContinuity(profileId: string): ProfileContinuityValidationResponse {
  const configPath = getConfigPath(profileId);
  const warnings: string[] = [];
  const recommendations: string[] = [
    'SOUL / profile instructions 应声明 Bubble Town ContextPack 与 authoritative time 优先。',
    '角色不应依赖固定的 Conversation started 判断当前时间。',
    '可用时启用 profile 内 session_search 与 fact_store；不可用时由 Bubble Town 降级检索。',
  ];
  if (!fs.existsSync(configPath)) {
    return {
      profileId,
      configPath,
      exists: false,
      sessionResetModeValid: false,
      warnings: ['未找到 Hermes profile config.yaml。'],
      recommendations,
    };
  }

  try {
    const parsed = YAML.parse(fs.readFileSync(configPath, 'utf8')) as {
      session_reset?: { mode?: unknown };
    } | null;
    const mode = typeof parsed?.session_reset?.mode === 'string' ? parsed.session_reset.mode : undefined;
    if (mode !== 'none') {
      warnings.push(`session_reset.mode 当前为 ${mode ?? '未设置'}，陪伴型 Storyline 建议设置为 none。`);
    }
    return {
      profileId,
      configPath,
      exists: true,
      sessionResetMode: mode,
      sessionResetModeValid: mode === 'none',
      warnings,
      recommendations,
    };
  } catch (error) {
    return {
      profileId,
      configPath,
      exists: true,
      sessionResetModeValid: false,
      warnings: [`读取或解析 config.yaml 失败：${error instanceof Error ? error.message : '未知错误'}`],
      recommendations,
    };
  }
}
