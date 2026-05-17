import type { ProfileSummary, ProfilesResponse } from '@bubble-town/shared';

export function markActiveProfileInResponse(
  payload: ProfilesResponse | undefined,
  activeProfileId: string,
  activeProfile?: ProfileSummary,
): ProfilesResponse | undefined {
  if (!payload) {
    return payload;
  }

  const profiles = payload.profiles.map((profile) => ({
    ...profile,
    isActive: profile.id === activeProfileId,
  }));

  if (activeProfile && !profiles.some((profile) => profile.id === activeProfile.id)) {
    profiles.push({
      ...activeProfile,
      isActive: true,
    });
  }

  return {
    ...payload,
    activeProfileId,
    profiles,
  };
}
