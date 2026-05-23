import type { MemoryRecord } from '@bubble-town/shared';

export const SETTINGS_ALL_FILTER_VALUE = 'all';

export interface SettingsMemoryFilters {
  status: string;
  kind: string;
  source: string;
  link: string;
  search: string;
}

export function filterSettingsMemories(memories: MemoryRecord[], filters: SettingsMemoryFilters): MemoryRecord[] {
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
    if (!query) {
      return true;
    }

    return [memory.content, memory.reason, memory.kind, memory.source, memory.status]
      .some((value) => value?.toLowerCase().includes(query));
  });
}
