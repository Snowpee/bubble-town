import type { ActivityLog, MemoryRecord } from '@bubble-town/shared';

export const SETTINGS_ALL_FILTER_VALUE = 'all';

export type SettingsMemoryRisk =
  | 'old_schema'
  | 'no_source'
  | 'low_confidence'
  | 'time_mismatch'
  | 'transient_world_state';

export type SettingsMemoryAuditRole =
  | 'summary_consolidation'
  | 'manual_replacement'
  | 'duplicate_keeper'
  | 'superseded_by_manual_replacement'
  | 'hidden_duplicate'
  | 'unlinked';

export interface SettingsMemoryFilters {
  status: string;
  kind: string;
  source: string;
  link: string;
  risk: string;
  search: string;
}

export interface SettingsMemoryFilterContext {
  activityLogs?: ActivityLog[];
}

const AUTO_CONSOLIDATION_ELIGIBLE_TAG = 'memory-solidification-v2';

function getTimeDistanceHours(left?: string, right?: string): number | undefined {
  if (!left || !right) {
    return undefined;
  }
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) {
    return undefined;
  }
  return Math.abs(leftMs - rightMs) / 1000 / 60 / 60;
}

export function getMemoryRiskTags(memory: MemoryRecord, context: SettingsMemoryFilterContext = {}): SettingsMemoryRisk[] {
  const risks: SettingsMemoryRisk[] = [];
  const sourceActivities = memory.sourceActivityIds?.length
    ? (context.activityLogs ?? []).filter((activityLog) => memory.sourceActivityIds?.includes(activityLog.id))
    : [];

  if (
    memory.source === 'summary'
    && (!memory.sourceHappenedAtStart || !memory.sourceHappenedAtEnd
      || (sourceActivities.length > 0 && sourceActivities.every((activityLog) => !activityLog.tags.includes(AUTO_CONSOLIDATION_ELIGIBLE_TAG))))
  ) {
    risks.push('old_schema');
  }
  if (!memory.sourceMessageIds?.length && !memory.sourceActivityIds?.length) {
    risks.push('no_source');
  }
  if ((memory.confidence ?? 1) < 0.5) {
    risks.push('low_confidence');
  }
  if ((getTimeDistanceHours(memory.sourceHappenedAtStart, memory.createdAt) ?? 0) > 24) {
    risks.push('time_mismatch');
  }
  if (
    memory.kind === 'world_object_state'
    && memory.semanticEvents?.some((event) => (
      event.stability === 'transient'
      || event.temporalScope === 'instantaneous'
    ))
  ) {
    risks.push('transient_world_state');
  }
  return risks;
}

function isManualCorrectionReplacement(memory: MemoryRecord) {
  return memory.source === 'manual'
    && Boolean(memory.supersedes?.length)
    && /纠正|replacement|替代/.test(memory.reason ?? '');
}

export function getMemoryAuditRole(memory: MemoryRecord, allMemories: MemoryRecord[] = []): SettingsMemoryAuditRole {
  if (memory.source === 'summary') {
    return 'summary_consolidation';
  }
  if (isManualCorrectionReplacement(memory)) {
    return 'manual_replacement';
  }
  if (memory.supersedes?.length) {
    return 'duplicate_keeper';
  }
  if (memory.supersededBy) {
    const replacement = allMemories.find((candidate) => candidate.id === memory.supersededBy);
    return replacement && isManualCorrectionReplacement(replacement)
      ? 'superseded_by_manual_replacement'
      : 'hidden_duplicate';
  }
  return 'unlinked';
}

export function filterSettingsMemories(
  memories: MemoryRecord[],
  filters: SettingsMemoryFilters,
  context: SettingsMemoryFilterContext = {},
): MemoryRecord[] {
  const query = filters.search.trim().toLowerCase();

  return memories.filter((memory) => {
    if (filters.status !== SETTINGS_ALL_FILTER_VALUE && memory.status !== filters.status) {
      return false;
    }
    if (filters.kind !== SETTINGS_ALL_FILTER_VALUE && (memory.kind ?? 'unclassified') !== filters.kind) {
      return false;
    }
    if (filters.source !== SETTINGS_ALL_FILTER_VALUE && memory.source !== filters.source) {
      return false;
    }
    if (filters.link === 'superseded' && !memory.supersededBy) {
      return false;
    }
    if (filters.link === 'supersedes' && !memory.supersedes?.length) {
      return false;
    }
    if (filters.link === 'unlinked' && (memory.supersededBy || memory.supersedes?.length)) {
      return false;
    }
    if (filters.risk !== SETTINGS_ALL_FILTER_VALUE && !getMemoryRiskTags(memory, context).includes(filters.risk as SettingsMemoryRisk)) {
      return false;
    }
    if (!query) {
      return true;
    }

    return [memory.content, memory.reason, memory.kind, memory.source, memory.status, ...getMemoryRiskTags(memory, context)]
      .some((value) => value?.toLowerCase().includes(query));
  });
}
