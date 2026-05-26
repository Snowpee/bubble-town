import type {
  ActivityLog,
  Character,
  MemoryRecord,
  PendingSemanticFrame,
  RuntimeSession,
  SceneProjection,
  Storyline,
  SuppressedMemory,
} from '@bubble-town/shared';
import { buildSceneProjectionFromMemories, getStorylineSceneId } from '../features/world-state/world-state.js';
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
  selectRuntimeSessionForStoryline,
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
    sceneProjection: buildSceneProjectionFromMemories(allMemoryRecords, getStorylineSceneId(storyline)),
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
