import {
  DEFAULT_PROFILE_ID,
  type CreateProfileRequest,
  type PrepareProfileForStorylineResponse,
  type ProfileSummary,
  type ProfilesResponse,
  type ResetProfileForStorylineResponse,
  type UpdateProfileRequest,
} from '@bubble-town/shared';
import type { SessionSummary } from '@bubble-town/shared';
import { apiDelete, apiGet, apiPatch, apiPost } from './client';

export function fetchProfiles() {
  return apiGet<ProfilesResponse>('/api/profiles');
}

export function switchProfile(profileId: string) {
  return apiPost<{ activeProfile?: ProfileSummary; sessions: SessionSummary[] }>('/api/profiles/switch', {
    profileId: profileId || DEFAULT_PROFILE_ID,
  });
}

export function createProfile(input: CreateProfileRequest) {
  return apiPost<ProfileSummary>('/api/profiles', input);
}

export function renameProfile(profileId: string, input: UpdateProfileRequest) {
  return apiPatch<ProfileSummary>(`/api/profiles/${profileId}`, input);
}

export function deleteProfile(profileId: string) {
  return apiDelete<{ success: boolean }>(`/api/profiles/${profileId}`);
}

export function prepareProfileForStoryline(profileId: string) {
  return apiPost<PrepareProfileForStorylineResponse>(`/api/profiles/${profileId || DEFAULT_PROFILE_ID}/prepare-storyline`, {});
}

export function resetProfileForStoryline(profileId: string, confirmationProfileName: string) {
  return apiPost<ResetProfileForStorylineResponse>(`/api/profiles/${profileId || DEFAULT_PROFILE_ID}/reset-storyline`, {
    confirmationProfileName,
  });
}
