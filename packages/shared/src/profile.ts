import type { PromptBoundaryValidation } from './story.js';

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

export interface PrepareProfileForStorylineResponse {
  profileId: string;
  configPath: string;
  soulPath: string;
  changes: string[];
  promptBoundaryValidation?: PromptBoundaryValidation;
}

export interface ResetProfileRuntimeSummary {
  storylineIds: string[];
  removedStorylineCount: number;
  removedRuntimeSessionCount: number;
  removedMemoryCount: number;
  removedSuppressedMemoryCount: number;
  removedActivityLogCount: number;
  removedPendingSemanticFrameCount?: number;
  removedOpenLoopCount?: number;
  removedSceneStateCount?: number;
  removedOffscreenResolutionCount?: number;
  removedRelationshipStateCount?: number;
  removedRelationshipEventCount?: number;
  removedCharacterCount: number;
  removedEmbeddingCount: number;
}

export interface ResetProfileForStorylineResponse {
  profileId: string;
  configPath: string;
  soulPath: string;
  changes: string[];
  runtimeReset: ResetProfileRuntimeSummary;
  promptBoundaryValidation?: PromptBoundaryValidation;
}
