import type {
  ActivityLog,
  Character,
  MemoryRecord,
  OffscreenResolution,
  OpenLoop,
  PendingSemanticFrame,
  PromptBoundaryValidation,
  RelationshipEvent,
  RelationshipState,
  RuntimeSession,
  SceneProjection,
  SceneState,
  Storyline,
  SuppressedMemory,
} from '@bubble-town/shared';
import { buildSceneProjectionFromMemories, getStorylineSceneId } from '../features/world-state/world-state.js';
import { validateProfileBoundaryForProfile } from '../features/story/prompt-boundary-validation.js';
import { markMemoryRecordsAccessed } from '../store/story-runtime-store.js';
import {
  getStoryRuntimeRepository,
  selectActiveStoryline,
  selectActiveStorylineId,
  selectAllActivityLogs,
  selectAllMemoryRecords,
  selectPendingSemanticFrames,
  selectAllSuppressedMemories,
  selectCharacterById,
  selectMemoryRecordById,
  selectMemoryRecords,
  selectOffscreenResolutionForScene,
  selectOpenLoops,
  selectRelationshipEvents,
  selectRelationshipStateForStoryline,
  selectRuntimeSessionForStoryline,
  selectSceneStateForScene,
  selectStorylineById,
  selectStorylines,
  selectSuppressedMemories,
  type StoryRuntimeSnapshot,
} from '../runtime/story-runtime-repository.js';

export interface StorylineRuntimeContext {
  snapshot: StoryRuntimeSnapshot;
  storyline: Storyline;
  character: Character;
  runtimeSession?: RuntimeSession;
  activeMemories: MemoryRecord[];
  allMemoryRecords: MemoryRecord[];
  suppressedMemories: SuppressedMemory[];
  activityLogs: ActivityLog[];
  allActivityLogs: ActivityLog[];
  pendingSemanticFrames: PendingSemanticFrame[];
  openLoops: OpenLoop[];
  sceneState?: SceneState;
  offscreenResolution?: OffscreenResolution;
  relationshipState?: RelationshipState;
  relationshipEvents: RelationshipEvent[];
  promptBoundaryValidation?: PromptBoundaryValidation;
  sceneProjection?: SceneProjection;
}

function getRuntimeSnapshot(): StoryRuntimeSnapshot {
  return getStoryRuntimeRepository().load();
}

export function getRuntimeSnapshotForRead(): StoryRuntimeSnapshot {
  return getRuntimeSnapshot();
}

export function listStorylinesFromRuntime(): Storyline[] {
  return selectStorylines(getRuntimeSnapshot());
}

export function getActiveStorylineIdFromRuntime(): string | undefined {
  return selectActiveStorylineId(getRuntimeSnapshot());
}

export function getActiveStorylineFromRuntime(): Storyline | undefined {
  return selectActiveStoryline(getRuntimeSnapshot());
}

export function getStorylineFromRuntime(storylineId: string): Storyline | undefined {
  return selectStorylineById(getRuntimeSnapshot(), storylineId);
}

export function getStorylineRuntimeContextFromSnapshot(
  snapshot: StoryRuntimeSnapshot,
  storylineId: string,
): StorylineRuntimeContext | undefined {
  const storyline = selectStorylineById(snapshot, storylineId);
  if (!storyline) {
    return undefined;
  }

  const character = selectCharacterById(snapshot, storyline.characterId);
  if (!character) {
    return undefined;
  }

  const allMemoryRecords = selectAllMemoryRecords(snapshot, storyline.id);
  const sceneId = getStorylineSceneId(storyline);
  return {
    snapshot,
    storyline,
    character,
    runtimeSession: selectRuntimeSessionForStoryline(snapshot, storyline.id),
    activeMemories: selectMemoryRecords(snapshot, storyline.id, character.id),
    allMemoryRecords,
    suppressedMemories: selectSuppressedMemories(snapshot, storyline.id, character.id),
    activityLogs: selectAllActivityLogs(snapshot, storyline.id)
      .filter((entry) => entry.status === 'active')
      .slice(0, 20),
    allActivityLogs: selectAllActivityLogs(snapshot, storyline.id),
    pendingSemanticFrames: selectPendingSemanticFrames(snapshot, storyline.id),
    openLoops: selectOpenLoops(snapshot, storyline.id),
    sceneState: selectSceneStateForScene(snapshot, storyline.id, sceneId),
    offscreenResolution: selectOffscreenResolutionForScene(snapshot, storyline.id, sceneId),
    relationshipState: selectRelationshipStateForStoryline(snapshot, storyline.id, character.id),
    relationshipEvents: selectRelationshipEvents(snapshot, storyline.id).slice(0, 8),
    promptBoundaryValidation: validateProfileBoundaryForProfile(storyline.hermesProfileId),
    sceneProjection: buildSceneProjectionFromMemories(allMemoryRecords, sceneId),
  };
}

export function getStorylineRuntimeContext(storylineId: string): StorylineRuntimeContext | undefined {
  return getStorylineRuntimeContextFromSnapshot(getRuntimeSnapshot(), storylineId);
}

export function getMemoryRecordFromRuntime(id: string): MemoryRecord | undefined {
  return selectMemoryRecordById(getRuntimeSnapshot(), id);
}

export function listAllMemoryRecordsFromRuntime(storylineId: string): MemoryRecord[] {
  return selectAllMemoryRecords(getRuntimeSnapshot(), storylineId);
}

export function listAllActivityLogsFromRuntime(storylineId: string): ActivityLog[] {
  return selectAllActivityLogs(getRuntimeSnapshot(), storylineId);
}

export function listAllSuppressedMemoriesFromRuntime(storylineId: string): SuppressedMemory[] {
  return selectAllSuppressedMemories(getRuntimeSnapshot(), storylineId);
}

export function markRuntimeMemoryRecordsAccessed(ids: string[], at?: string): MemoryRecord[] {
  return markMemoryRecordsAccessed(ids, at);
}
