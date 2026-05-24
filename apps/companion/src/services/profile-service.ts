import type {
  CreateProfileRequest,
  ProfilesResponse,
  ProfileSummary,
  SwitchProfileRequest,
  UpdateProfileRequest,
} from '@bubble-town/shared';
import { createProfile, listProfiles, prepareProfileForStoryline, removeProfile, renameProfile, resetProfileForStoryline, setActiveProfile } from '../store/profile-store.js';
import { ensureManagedHermesGateway, restartManagedHermesGateway } from '../adapters/hermes/hermes-gateway.js';
import { removeEmbeddingsForStorylines } from '../features/memory/memory-embeddings.js';
import { listSessions } from '../store/session-store.js';
import { resetProfileRuntimeState } from '../store/story-runtime-store.js';

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

interface ProfileServiceLogger {
  info: (...args: unknown[]) => void;
}

export async function handleSwitchProfileRequest(input: SwitchProfileRequest, log?: ProfileServiceLogger) {
  log?.info({ requestedProfileId: input.profileId }, 'profile switch request');
  const gateway = await ensureManagedHermesGateway(input.profileId);
  const gatewayInstance = gateway.gateways?.find((entry) => entry.expectedProfileId === gateway.profileId);

  log?.info({
    requestedProfileId: input.profileId,
    gatewayExpectedProfileId: gatewayInstance?.expectedProfileId ?? gateway.profileId,
    gatewayActualProfileId: gatewayInstance?.actualProfileId,
    gatewayApiBaseUrl: gateway.apiBaseUrl,
    gatewayPort: gateway.port,
    gatewayPid: gateway.pid,
    expectedHermesHome: gatewayInstance?.expectedHermesHome,
    actualHermesHome: gatewayInstance?.actualHermesHome,
  }, 'profile switch gateway ready');

  const result = handleSwitchProfile(input);

  log?.info({
    requestedProfileId: input.profileId,
    returnedActiveProfileId: result.activeProfile?.id,
    returnedSessionProfiles: Array.from(new Set(result.sessions.map((session) => session.profileId))),
  }, 'profile switch complete');

  return result;
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
