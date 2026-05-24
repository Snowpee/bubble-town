import { buildTimeContext } from '../features/story/context-pack.js';
import { validateProfileContinuity } from '../features/story/profile-continuity.js';
import { searchRelativeTime } from '../features/story/relative-time-search.js';
import {
  getActiveStorylineFromRuntime,
  getActiveStorylineIdFromRuntime,
  listAllActivityLogsFromRuntime,
  listAllMemoryRecordsFromRuntime,
  listAllSuppressedMemoriesFromRuntime,
  getRuntimeSnapshotForRead,
  getStorylineFromRuntime,
  getStorylineRuntimeContext,
  listStorylinesFromRuntime,
} from './runtime-service.js';

export {
  consolidateStorylineMemory,
  correctMemory,
} from '../features/memory/memory-governance.js';

export {
  createActivityLog,
  createMemoryRecord,
  createSuppressedMemory,
  createStoryline,
  deleteSuppressedMemory,
  setActiveStoryline,
  setActiveStorylineForProfile,
  updateActivityLog,
  updateMemoryRecord,
  updateStoryline,
} from '../store/story-runtime-store.js';

export const getActiveStoryline = getActiveStorylineFromRuntime;
export const getActiveStorylineId = getActiveStorylineIdFromRuntime;
export const listStorylines = listStorylinesFromRuntime;
export const getStoryline = getStorylineFromRuntime;
export { getStorylineRuntimeContext };

export function listStorylineMemories(storylineId: string) {
  return listAllMemoryRecordsFromRuntime(storylineId);
}

export function listStorylineSuppressedMemories(storylineId: string) {
  return listAllSuppressedMemoriesFromRuntime(storylineId);
}

export function listStorylineActivityLogs(storylineId: string) {
  return listAllActivityLogsFromRuntime(storylineId);
}

export function getRuntimeReadDiagnostics() {
  const snapshot = getRuntimeSnapshotForRead();
  return {
    storylineCount: snapshot.storylines.length,
    runtimeSessionCount: snapshot.runtimeSessions.length,
    memoryCount: snapshot.memoryRecords.length,
    suppressedMemoryCount: snapshot.suppressedMemories.length,
    activityLogCount: snapshot.activityLogs.length,
  };
}

export function searchStorylineRelativeTime(storylineId: string, input?: string) {
  const storyline = getStorylineFromRuntime(storylineId);
  if (!storyline) {
    return undefined;
  }

  const normalizedInput = input?.trim();
  if (!normalizedInput) {
    throw new Error('检索输入不能为空。');
  }

  return {
    results: searchRelativeTime(
      storyline.id,
      normalizedInput,
      buildTimeContext(storyline.lastInteractionAt),
    ),
  };
}

export function validateStorylineProfileContinuity(storylineId: string) {
  const storyline = getStorylineFromRuntime(storylineId);
  if (!storyline) {
    return undefined;
  }

  return validateProfileContinuity(storyline.hermesProfileId);
}
