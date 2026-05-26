import { describe, expect, it } from 'vitest';
import type { ActivityLog, MemoryRecord } from '@bubble-town/shared';
import { SETTINGS_ALL_FILTER_VALUE, filterSettingsMemories, getMemoryAuditRole, getMemoryRiskTags } from './settings-memory';

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
    semanticEvents: overrides.semanticEvents,
    semanticSchemaVersion: overrides.semanticSchemaVersion,
    semanticSource: overrides.semanticSource,
    sourceActivityIds: overrides.sourceActivityIds,
    sourceMessageIds: overrides.sourceMessageIds,
    sourceHappenedAtStart: overrides.sourceHappenedAtStart,
    sourceHappenedAtEnd: overrides.sourceHappenedAtEnd,
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
    risk: SETTINGS_ALL_FILTER_VALUE,
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

  it('标记旧 summary、无来源、低置信和时间错位风险', () => {
    const oldSummary = createMemory({ id: 'old-summary', source: 'summary', sourceActivityIds: ['act_old'] });
    const activityLogs: ActivityLog[] = [{
      id: 'act_old',
      storylineId: 'story_1',
      happenedAt: '2026-05-20T10:00:00.000Z',
      timezone: 'Asia/Shanghai',
      summary: '旧日志',
      tags: ['legacy'],
      status: 'active',
    }];
    const risky = createMemory({
      id: 'risky',
      confidence: 0.32,
      sourceHappenedAtStart: '2026-05-20T10:00:00.000Z',
      sourceHappenedAtEnd: '2026-05-20T10:00:00.000Z',
    });

    expect(getMemoryRiskTags(oldSummary, { activityLogs })).toContain('old_schema');
    expect(getMemoryRiskTags(risky)).toEqual(expect.arrayContaining(['no_source', 'low_confidence', 'time_mismatch']));
    expect(applyFilters([oldSummary, risky], { risk: 'old_schema' }).map((memory) => memory.id)).toEqual(['old-summary']);
  });

  it('通过结构化稳定性字段标记 transient world-state 风险', () => {
    const transientWorldState = createMemory({
      id: 'transient-world-state',
      kind: 'world_object_state',
      semanticEvents: [{
        id: 'semantic_1',
        eventType: 'world_state_change',
        temporalScope: 'instantaneous',
        stability: 'transient',
        evidenceSpan: 'found in a coat pocket for the current moment',
        confidence: 0.86,
      }],
    });
    const stableWorldState = createMemory({
      id: 'stable-world-state',
      kind: 'world_object_state',
      content: '用户说东西在口袋里。',
      semanticEvents: [{
        id: 'semantic_2',
        eventType: 'world_state_change',
        temporalScope: 'stable',
        stability: 'stable',
        evidenceSpan: 'stable storage rule',
        confidence: 0.86,
      }],
    });

    expect(getMemoryRiskTags(transientWorldState)).toContain('transient_world_state');
    expect(getMemoryRiskTags(stableWorldState)).not.toContain('transient_world_state');
  });

  it('区分 summary、人工纠正 replacement 和重复合并 keeper', () => {
    const summary = createMemory({ id: 'summary', source: 'summary', sourceActivityIds: ['act_1'] });
    const hiddenManual = createMemory({ id: 'hidden-manual', status: 'hidden', supersededBy: 'manual-replacement' });
    const manualReplacement = createMemory({
      id: 'manual-replacement',
      source: 'manual',
      status: 'active',
      supersedes: ['hidden-manual'],
      reason: '用户纠正旧记忆',
    });
    const hiddenDuplicate = createMemory({ id: 'hidden-duplicate', status: 'hidden', supersededBy: 'duplicate-keeper' });
    const duplicateKeeper = createMemory({
      id: 'duplicate-keeper',
      source: 'auto_extract',
      status: 'active',
      supersedes: ['hidden-duplicate'],
      reason: '重复记忆合并后的保留记录。',
    });
    const auditMemories = [summary, hiddenManual, manualReplacement, hiddenDuplicate, duplicateKeeper];

    expect(getMemoryAuditRole(summary, auditMemories)).toBe('summary_consolidation');
    expect(getMemoryAuditRole(manualReplacement, auditMemories)).toBe('manual_replacement');
    expect(getMemoryAuditRole(hiddenManual, auditMemories)).toBe('superseded_by_manual_replacement');
    expect(getMemoryAuditRole(duplicateKeeper, auditMemories)).toBe('duplicate_keeper');
    expect(getMemoryAuditRole(hiddenDuplicate, auditMemories)).toBe('hidden_duplicate');
  });
});
