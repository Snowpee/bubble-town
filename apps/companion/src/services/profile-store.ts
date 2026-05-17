import fs from 'node:fs';
import path from 'node:path';
import type { CreateProfileRequest, ProfileSummary, UpdateProfileRequest } from '@bubble-town/shared';
import { runHermesProfileCommand } from './profile-cli.js';
import { DEFAULT_PROFILE_ID, getActiveProfilePath, getProfileHome, getProfilesRoot, getSessionsDir } from './hermes-paths.js';

export function getActiveProfileId(): string {
  const activeProfilePath = getActiveProfilePath();
  if (!fs.existsSync(activeProfilePath)) {
    return DEFAULT_PROFILE_ID;
  }

  const value = fs.readFileSync(activeProfilePath, 'utf8').trim();
  return value || DEFAULT_PROFILE_ID;
}

function countProfileSessions(profileId: string): number {
  const sessionsDir = getSessionsDir(profileId);
  if (!fs.existsSync(sessionsDir)) {
    return 0;
  }

  return fs
    .readdirSync(sessionsDir)
    .filter((entry) => entry.startsWith('session_') && entry.endsWith('.json'))
    .length;
}

function getProfileUpdatedAt(profileId: string): string | undefined {
  const profileHome = getProfileHome(profileId);
  if (!fs.existsSync(profileHome)) {
    return undefined;
  }

  return fs.statSync(profileHome).mtime.toISOString();
}

function buildProfileSummary(profileId: string, activeProfileId: string): ProfileSummary {
  return {
    id: profileId,
    name: profileId,
    isActive: profileId === activeProfileId,
    sessionCount: countProfileSessions(profileId),
    updatedAt: getProfileUpdatedAt(profileId),
  };
}

export function listProfiles(): ProfileSummary[] {
  const activeProfileId = getActiveProfileId();
  const profiles = [buildProfileSummary(DEFAULT_PROFILE_ID, activeProfileId)];
  const profilesRoot = getProfilesRoot();

  if (!fs.existsSync(profilesRoot)) {
    return profiles;
  }

  const namedProfiles = fs
    .readdirSync(profilesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const profileId of namedProfiles) {
    profiles.push(buildProfileSummary(profileId, activeProfileId));
  }

  return profiles;
}

export function createProfile(input: CreateProfileRequest): ProfileSummary {
  runHermesProfileCommand(['create', input.name, '--clone', '--no-alias']);
  const createdId = input.name.trim().toLowerCase().replace(/\s+/g, '-');
  return listProfiles().find((profile) => profile.id === createdId) ?? buildProfileSummary(createdId, getActiveProfileId());
}

export function renameProfile(id: string, input: UpdateProfileRequest): ProfileSummary | undefined {
  try {
    runHermesProfileCommand(['rename', id, input.name]);
  } catch {
    return undefined;
  }

  const nextId = input.name.trim().toLowerCase().replace(/\s+/g, '-');
  return listProfiles().find((profile) => profile.id === nextId);
}

export function removeProfile(id: string): boolean {
  try {
    runHermesProfileCommand(['delete', id, '--yes']);
    return !fs.existsSync(path.join(getProfilesRoot(), id));
  } catch {
    return false;
  }
}

export function setActiveProfile(profileId: string): ProfileSummary | undefined {
  try {
    runHermesProfileCommand(['use', profileId]);
  } catch {
    return undefined;
  }

  return listProfiles().find((profile) => profile.id === profileId);
}
