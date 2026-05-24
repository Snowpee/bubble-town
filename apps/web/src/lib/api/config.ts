import type {
  AuxiliaryLlmSettingsResponse,
  TestAuxiliaryLlmConnectionRequest,
  TestAuxiliaryLlmConnectionResponse,
  UpdateAuxiliaryLlmSettingsRequest,
} from '@bubble-town/shared';
import { apiGet, apiPatch, apiPost } from './client';

export function fetchAuxiliaryLlmSettings(profileId: string) {
  const search = new URLSearchParams({ profileId });
  return apiGet<AuxiliaryLlmSettingsResponse>(`/api/config/auxiliary-llm?${search.toString()}`);
}

export function updateAuxiliaryLlmSettings(input: UpdateAuxiliaryLlmSettingsRequest) {
  return apiPatch<AuxiliaryLlmSettingsResponse>('/api/config/auxiliary-llm', input);
}

export function testAuxiliaryLlmConnection(input: TestAuxiliaryLlmConnectionRequest) {
  return apiPost<TestAuxiliaryLlmConnectionResponse>('/api/config/auxiliary-llm/test', input);
}
