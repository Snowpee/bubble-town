export const DEFAULT_PROFILE_ID = 'default';

export interface ProfileSummary {
  id: string;
  name: string;
  isActive: boolean;
  sessionCount?: number;
  updatedAt?: string;
}

export interface ProfilesResponse {
  activeProfileId?: string;
  profiles: ProfileSummary[];
}

export interface CreateProfileRequest {
  name: string;
}

export interface UpdateProfileRequest {
  name: string;
}

export interface SwitchProfileRequest {
  profileId: string;
}
