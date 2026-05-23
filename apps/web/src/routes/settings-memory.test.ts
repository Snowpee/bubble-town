import { describe, expect, it } from 'vitest';
import type { MemoryRecord } from '@bubble-town/shared';
import { SETTINGS_ALL_FILTER_VALUE, filterSettingsMemories } from './settings-memory';

function createMemory(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: overrides.id ?? 'mem_1',
    storylineId: 'story_1',
    characterId: 'char_1',
    content: overrides.content ?? '用户喜欢晚饭后散步。',
    scope: 'user',
    source: overrides.source ?? 'manual',
    status: overrides.status ?? 'active',
    kind: overrides.kind,
    lifespan: overrides.lifespan,
    reason: overrides.reason,
    importance: overrides.importance,
    confidence: overrides.confidence,
    createdAt: '2026-05-23T10:00:00.000Z',
    updatedAt: '2026-05-23T10:00:00.000Z',
    supersedes: overrides.supersedes,
    supersededBy: overrides.supersededBy,
  };
}

function applyFilters(memories: MemoryRecord[], overrides = {}) {
  return filterSettingsMemories(memories, {
    status: SETTINGS_ALL_FILTER_VALUE,
    kind: SETTINGS_ALL_FILTER_VALUE,
    source: SETTINGS_ALL_FILTER_VALUE,
    link: SETTINGS_ALL_FILTER_VALUE,
    search: '',
    ...overrides,
  });
}

describe('settings memory filters', () => {
  const memories = [
    createMemory({ id: 'active-manual', kind: 'preference', source: 'manual', status: 'active' }),
    createMemory({ id: 'hidden-auto', kind: 'boundary', source: 'auto_extract', status: 'hidden', supersededBy: 'replacement' }),
    createMemory({ id: 'replacement', kind: 'preference', source: 'manual', status: 'active', supersedes: ['hidden-auto'], reason: '用户纠正旧记忆' }),
  ];

  it('按状态、类型和来源过滤 Settings 记忆列表', () => {
    expect(applyFilters(memories, { status: 'hidden' }).map((memory) => memory.id)).toEqual(['hidden-auto']);
    expect(applyFilters(memories, { kind: 'boundary' }).map((memory) => memory.id)).toEqual(['hidden-auto']);
    expect(applyFilters(memories, { source: 'auto_extract' }).map((memory) => memory.id)).toEqual(['hidden-auto']);
  });

  it('按 supersedes 链路过滤 correction 和 duplicate 审计记录', () => {
    expect(applyFilters(memories, { link: 'superseded' }).map((memory) => memory.id)).toEqual(['hidden-auto']);
    expect(applyFilters(memories, { link: 'supersedes' }).map((memory) => memory.id)).toEqual(['replacement']);
    expect(applyFilters(memories, { link: 'unlinked' }).map((memory) => memory.id)).toEqual(['active-manual']);
  });

  it('搜索内容、原因和元数据时保留当前筛选范围', () => {
    expect(applyFilters(memories, { search: '纠正' }).map((memory) => memory.id)).toEqual(['replacement']);
    expect(applyFilters(memories, { status: 'active', search: 'auto_extract' })).toEqual([]);
  });
});
