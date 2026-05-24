export type AuxiliaryLlmProvider = 'openai-compatible';
export type AuxiliaryLlmReasoningEffort = 'high' | 'max';

export type AuxiliaryLlmUseCase = 'world-state';

export interface AuxiliaryLlmAuditEntry {
  id: string;
  taskType: AuxiliaryLlmUseCase;
  status: 'success' | 'error';
  message: string;
  happenedAt: string;
  model: string;
  baseUrl: string;
}

export interface AuxiliaryLlmStatusSnapshot {
  lastInvocation?: AuxiliaryLlmAuditEntry;
  lastError?: AuxiliaryLlmAuditEntry;
  recentAudit: AuxiliaryLlmAuditEntry[];
}

export interface AuxiliaryLlmSettings {
  profileId: string;
  enabled: boolean;
  provider: AuxiliaryLlmProvider;
  baseUrl: string;
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: AuxiliaryLlmReasoningEffort;
  defaultTimeoutMs: number;
  useFor: AuxiliaryLlmUseCase[];
  apiKeyConfigured: boolean;
}

export interface AuxiliaryLlmSettingsResponse {
  settings: AuxiliaryLlmSettings;
  availableUseCases: AuxiliaryLlmUseCase[];
  status: AuxiliaryLlmStatusSnapshot;
}

export interface UpdateAuxiliaryLlmSettingsRequest {
  profileId: string;
  enabled: boolean;
  provider: AuxiliaryLlmProvider;
  baseUrl: string;
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: AuxiliaryLlmReasoningEffort;
  defaultTimeoutMs: number;
  useFor: AuxiliaryLlmUseCase[];
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface TestAuxiliaryLlmConnectionRequest extends UpdateAuxiliaryLlmSettingsRequest {}

export interface TestAuxiliaryLlmConnectionResponse {
  ok: boolean;
  message: string;
  modelCount?: number;
}
