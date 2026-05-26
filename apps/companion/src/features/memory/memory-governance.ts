import type { ActivityLog, CorrectMemoryResponse, MemoryConsolidationResult, MemoryRecord } from '@bubble-town/shared';
import {
  getMemoryRecordFromRuntime,
  getStorylineRuntimeContext,
} from '../../services/runtime-service.js';
import {
  updateActivityLog,
  updateMemoryRecord,
} from '../../store/story-runtime-store.js';
import {
  canonicalMemoryContent,
  createManualMemory,
  createStoryFactCandidateFromActivityLogs,
  persistMemoryCandidate,
} from './memory-write-service.js';

export const CONSOLIDATED_TAG = 'consolidated';
export const AUTO_CONSOLIDATION_ELIGIBLE_TAG = 'memory-solidification-v2';

function chooseDuplicateKeeper(memories: MemoryRecord[]): MemoryRecord {
  return [...memories].sort((left, right) => {
    const leftScore = (left.importance ?? 0.45) + (left.confidence ?? 0.55) + (left.accessCount ?? 0) * 0.02;
    const rightScore = (right.importance ?? 0.45) + (right.confidence ?? 0.55) + (right.accessCount ?? 0) * 0.02;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  })[0]!;
}

function unconsolidatedActivityLogs(activityLogs: ActivityLog[], limit: number): ActivityLog[] {
  return activityLogs
    .filter((entry) => entry.status === 'active')
    .filter((entry) => !entry.tags.includes(CONSOLIDATED_TAG))
    .sort((left, right) => left.happenedAt.localeCompare(right.happenedAt))
    .slice(0, limit);
}

function createSummaryMemory(storylineId: string, activityLogs: ActivityLog[]): MemoryRecord | undefined {
  const candidate = createStoryFactCandidateFromActivityLogs(activityLogs);
  if (!candidate) {
    return undefined;
  }
  const result = persistMemoryCandidate({
    storylineId,
    candidate,
    allowPendingConfirmation: false,
  });
  if (result.outcome !== 'created' || !result.memoryId) {
    return undefined;
  }
  const runtimeContext = getStorylineRuntimeContext(storylineId);
  return runtimeContext?.allMemoryRecords.find((memory) => memory.id === result.memoryId);
}

function mergeDuplicateMemories(memories: MemoryRecord[]): Pick<MemoryConsolidationResult, 'duplicateKeepers' | 'hiddenDuplicates'> {
  const groups = new Map<string, MemoryRecord[]>();
  for (const memory of memories) {
    if (memory.status !== 'active' || memory.supersededBy) {
      continue;
    }
    if (memory.source === 'summary') {
      continue;
    }
    const key = canonicalMemoryContent(memory.content);
    if (key.length < 4) {
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), memory]);
  }

  const duplicateKeepers: MemoryRecord[] = [];
  const hiddenDuplicates: MemoryRecord[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    const keeper = chooseDuplicateKeeper(group);
    const duplicates = group.filter((memory) => memory.id !== keeper.id);
    const supersedes = Array.from(new Set([...(keeper.supersedes ?? []), ...duplicates.map((memory) => memory.id)]));
    const updatedKeeper = updateMemoryRecord(keeper.id, {
      supersedes,
      importance: Math.max(keeper.importance ?? 0.45, ...duplicates.map((memory) => memory.importance ?? 0.45)),
      confidence: Math.max(keeper.confidence ?? 0.55, ...duplicates.map((memory) => memory.confidence ?? 0.55)),
      reason: keeper.reason ?? '重复记忆合并后的保留记录。',
    });
    if (updatedKeeper) {
      duplicateKeepers.push(updatedKeeper);
    }
    for (const duplicate of duplicates) {
      const hidden = updateMemoryRecord(duplicate.id, {
        status: 'hidden',
        supersededBy: keeper.id,
        reason: duplicate.reason ?? `重复记忆，已由 ${keeper.id} 代表。`,
      });
      if (hidden) {
        hiddenDuplicates.push(hidden);
      }
    }
  }

  return { duplicateKeepers, hiddenDuplicates };
}

export function consolidateStorylineMemory(input: {
  storylineId: string;
  activityLimit?: number;
}): MemoryConsolidationResult {
  const runtimeContext = getStorylineRuntimeContext(input.storylineId);
  if (!runtimeContext?.storyline) {
    throw new Error('未找到目标剧情。');
  }

  const activityLogs = unconsolidatedActivityLogs(runtimeContext.allActivityLogs, input.activityLimit ?? 8);
  const summaryMemory = createSummaryMemory(input.storylineId, activityLogs);
  const duplicates = mergeDuplicateMemories(runtimeContext.allMemoryRecords);
  const consolidatedActivityLogs = summaryMemory
    ? activityLogs
      .map((entry) => updateActivityLog(entry.id, { tags: Array.from(new Set([...entry.tags, CONSOLIDATED_TAG])) }))
      .filter((entry): entry is ActivityLog => Boolean(entry))
    : [];

  return {
    summaryMemory,
    duplicateKeepers: duplicates.duplicateKeepers,
    hiddenDuplicates: duplicates.hiddenDuplicates,
    consolidatedActivityLogs,
  };
}

export function correctMemory(input: {
  memoryId: string;
  content: string;
  reason?: string;
}): CorrectMemoryResponse {
  const existing = getMemoryRecordFromRuntime(input.memoryId);
  if (!existing?.storylineId || existing.status === 'deleted') {
    throw new Error('未找到可纠正的记忆。');
  }

  const replacement = createManualMemory(existing.storylineId, {
    content: input.content,
    scope: existing.scope,
    source: 'manual',
    kind: existing.kind,
    lifespan: existing.lifespan,
    importance: existing.importance,
    confidence: 0.95,
    reason: input.reason?.trim() || `用户纠正旧记忆 ${existing.id} 后创建的新记忆。`,
    sourceMessageIds: existing.sourceMessageIds,
    sourceActivityIds: existing.sourceActivityIds,
    supersedes: [existing.id],
  });
  const superseded = updateMemoryRecord(existing.id, {
    status: 'hidden',
    supersededBy: replacement.id,
    reason: existing.reason ?? `用户纠正后由 ${replacement.id} 替代。`,
  });
  if (!superseded) {
    throw new Error('更新旧记忆失败。');
  }

  return { replacement, superseded };
}
