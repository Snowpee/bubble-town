import { homedir } from 'node:os';
import path from 'node:path';

export const DEFAULT_PROFILE_ID = 'default';

export function getHermesRoot(): string {
  return process.env.HERMES_HOME || path.join(homedir(), '.hermes');
}

export function getProfilesRoot(): string {
  return path.join(getHermesRoot(), 'profiles');
}

export function getActiveProfilePath(): string {
  return path.join(getHermesRoot(), 'active_profile');
}

export function getProfileHome(profileId = DEFAULT_PROFILE_ID): string {
  if (!profileId || profileId === DEFAULT_PROFILE_ID) {
    return getHermesRoot();
  }

  return path.join(getProfilesRoot(), profileId);
}

export function getSessionsDir(profileId = DEFAULT_PROFILE_ID): string {
  return path.join(getProfileHome(profileId), 'sessions');
}

export function getStateDbPath(profileId = DEFAULT_PROFILE_ID): string {
  return path.join(getProfileHome(profileId), 'state.db');
}

export function getResponseStoreDbPath(profileId = DEFAULT_PROFILE_ID): string {
  return path.join(getProfileHome(profileId), 'response_store.db');
}

export function getConfigPath(profileId = DEFAULT_PROFILE_ID): string {
  return path.join(getProfileHome(profileId), 'config.yaml');
}

export function getSessionFilePath(sessionId: string, profileId = DEFAULT_PROFILE_ID): string {
  return path.join(getSessionsDir(profileId), `session_${sessionId}.json`);
}
