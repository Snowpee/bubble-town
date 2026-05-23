import type { CreateProfileRequest, ProfilesResponse, ProfileSummary, SwitchProfileRequest, UpdateProfileRequest } from '@bubble-town/shared';
import { createProfile, listProfiles, prepareProfileForStoryline, removeProfile, renameProfile, setActiveProfile } from './profile-store.js';
import { listSessions } from './session-store.js';

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
