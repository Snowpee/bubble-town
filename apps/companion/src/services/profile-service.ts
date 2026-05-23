import type {
  CreateProfileRequest,
  ProfilesResponse,
  ProfileSummary,
  SwitchProfileRequest,
  UpdateProfileRequest,
} from '@bubble-town/shared';
import { createProfile, listProfiles, prepareProfileForStoryline, removeProfile, renameProfile, resetProfileForStoryline, setActiveProfile } from './profile-store.js';
import { restartManagedHermesGateway } from './hermes-gateway.js';
import { removeEmbeddingsForStorylines } from './memory-embeddings.js';
import { listSessions } from './session-store.js';
import { resetProfileRuntimeState } from './story-runtime-store.js';

export function getProfilesResponse(): ProfilesResponse {
  const profiles = listProfiles();
  return {
    activeProfileId: profiles.find((profile) => profile.isActive)?.id,
    profiles,
  };
}

export function handleCreateProfile(input: CreateProfileRequest): ProfileSummary {
  return createProfile(input);
}

export function handleRenameProfile(id: string, input: UpdateProfileRequest): ProfileSummary | undefined {
  return renameProfile(id, input);
}

export function handleDeleteProfile(id: string): boolean {
  return removeProfile(id);
}

export function handleSwitchProfile(input: SwitchProfileRequest) {
  const activeProfile = setActiveProfile(input.profileId);
  return {
    activeProfile,
    sessions: listSessions(input.profileId),
  };
}

export function handlePrepareProfileForStoryline(profileId: string) {
  return prepareProfileForStoryline(profileId);
}

export async function handleResetProfileForStoryline(profileId: string, confirmationProfileName: string) {
  const runtimeReset = resetProfileRuntimeState(profileId);
  const removedEmbeddingCount = removeEmbeddingsForStorylines(runtimeReset.storylineIds);
  const result = resetProfileForStoryline(profileId, {
    ...runtimeReset,
    removedEmbeddingCount,
  }, confirmationProfileName);
  await restartManagedHermesGateway(result.profileId);
  return result;
}
