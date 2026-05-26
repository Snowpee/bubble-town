import crypto from 'node:crypto';
import type {
  MemoryRecord,
  SceneProjection,
  SemanticEvent,
  SemanticStability,
  SemanticTemporalScope,
  Storyline,
  WorldStateUpdateCandidate,
} from '@bubble-town/shared';
import {
  getStoryRuntimeRepository,
  selectAllActivityLogs,
  selectAllMemoryRecords,
  selectStorylineById,
} from '../../runtime/story-runtime-repository.js';
import { createMemoryRecord, updateMemoryRecord } from '../../store/story-runtime-store.js';

export const DEFAULT_SCENE_ID = 'default_scene';

export function normalizeSceneId(sceneId?: string): string {
  return sceneId?.trim() || DEFAULT_SCENE_ID;
}

export function normalizeWorldStateText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isExpired(memory: MemoryRecord): boolean {
  if (!memory.expiresAt) {
    return false;
  }
  const expiresAt = new Date(memory.expiresAt).getTime();
  return !Number.isNaN(expiresAt) && expiresAt <= Date.now();
}

export function normalizeObjectLabel(value: string): string | undefined {
  const normalized = normalizeWorldStateText(
    value.replace(/^(我把|把|我将|我把那|我把这|我把那个|我把这个|那|这|那个|这个|一盏|一扇|一只|一件|一张|一把|我的)/, ''),
  );
  if (!normalized || /^(它|它们|东西|那个|这个|那里|这里|object|objects|item|items|thing|things|something|物品|某物|该物|此物)$/i.test(normalized)) {
    return undefined;
  }
  return normalized;
}

export function createWorldObjectId(sceneId: string, objectLabel: string): string {
  const digest = crypto
    .createHash('sha1')
    .update(`${sceneId}:${objectLabel}`)
    .digest('hex')
    .slice(0, 12);
  return `obj_${digest}`;
}

export function buildStateContent(objectLabel: string, state: string): string {
  switch (state) {
    case 'broken':
      return `${objectLabel}已经损坏。`;
    case 'intact':
      return `${objectLabel}已经修好，恢复完好。`;
    case 'open':
      return `${objectLabel}现在是打开的。`;
    case 'closed':
      return `${objectLabel}现在是关着的。`;
    default:
      return `${objectLabel}当前状态为 ${state}。`;
  }
}

export function buildLocationContent(objectLabel: string, locationText: string): string {
  return `${objectLabel}现在放在${locationText}。`;
}

function isStableWorldStateCandidate(input: {
  isCurrentStableState: boolean;
  temporalScope?: SemanticTemporalScope;
  stability?: SemanticStability;
}): boolean {
  if (!input.isCurrentStableState) {
    return false;
  }
  if (input.stability && input.stability !== 'stable') {
    return false;
  }
  if (input.temporalScope && !['stable', 'recurring', 'session'].includes(input.temporalScope)) {
    return false;
  }
  return true;
}

export function buildWorldStateContent(input: {
  objectLabel: string;
  stateKind: 'status' | 'location';
  state: string;
  locationText?: string;
}): string {
  if (input.stateKind === 'location') {
    return buildLocationContent(input.objectLabel, input.locationText ?? input.state);
  }
  return buildStateContent(input.objectLabel, input.state);
}

function buildWorldStateSemanticEvent(input: {
  candidate: WorldStateUpdateCandidate;
  happenedAt?: string;
}): SemanticEvent {
  return {
    id: `semantic_event_${crypto.randomUUID()}`,
    eventType: 'world_state_change',
    entities: [
      {
        label: input.candidate.objectLabel,
        type: 'object',
        role: 'object',
        confidence: input.candidate.confidence,
      },
      ...(input.candidate.locationText ? [{
        label: input.candidate.locationText,
        type: 'place' as const,
        role: 'location' as const,
        confidence: input.candidate.confidence,
      }] : []),
    ],
    stateChange: {
      property: input.candidate.stateKind,
      to: input.candidate.locationText ?? input.candidate.state,
    },
    temporalScope: input.candidate.temporalScope ?? 'stable',
    stability: input.candidate.stability ?? 'stable',
    stabilityReason: input.candidate.stabilityReason,
    evidenceSpan: input.candidate.sourceSpan ?? input.candidate.reason,
    confidence: input.candidate.confidence,
    sourceMessageIds: input.candidate.sourceMessageIds,
    happenedAt: input.happenedAt,
  };
}

export function createWorldStateUpdateCandidate(input: {
  sceneId?: string;
  objectLabel: string;
  stateKind: 'status' | 'location';
  state: string;
  locationText?: string;
  actionType: 'place' | 'move' | 'open' | 'close' | 'break' | 'repair' | 'unknown';
  sourceSpan?: string;
  isCurrentStableState: boolean;
  temporalScope?: SemanticTemporalScope;
  stability?: SemanticStability;
  stabilityReason?: string;
  reason: string;
  confidence: number;
  sourceMessageIds?: string[];
  sourceActivityIds?: string[];
  sourceHappenedAtStart?: string;
  sourceHappenedAtEnd?: string;
}): WorldStateUpdateCandidate | undefined {
  const sceneId = normalizeSceneId(input.sceneId);
  const objectLabel = normalizeObjectLabel(input.objectLabel);
  const stateKind = input.stateKind;
  const state = normalizeWorldStateText(input.state);
  const locationText = input.locationText ? normalizeWorldStateText(input.locationText) : undefined;
  if (!objectLabel || !state || (stateKind === 'location' && !locationText)) {
    return undefined;
  }
  if (!isStableWorldStateCandidate(input)) {
    return undefined;
  }

  return {
    sceneId,
    objectLabel,
    stateKind,
    state,
    locationText,
    actionType: input.actionType,
    sourceSpan: input.sourceSpan ? normalizeWorldStateText(input.sourceSpan) : undefined,
    isCurrentStableState: input.isCurrentStableState,
    temporalScope: input.temporalScope,
    stability: input.stability,
    stabilityReason: input.stabilityReason,
    reason: input.reason,
    confidence: Math.max(0, Math.min(1, input.confidence)),
    sourceMessageIds: input.sourceMessageIds,
    sourceActivityIds: input.sourceActivityIds,
    sourceHappenedAtStart: input.sourceHappenedAtStart,
    sourceHappenedAtEnd: input.sourceHappenedAtEnd,
  };
}

export function getStorylineSceneId(storyline: Pick<Storyline, 'currentSceneId'>): string {
  return normalizeSceneId(storyline.currentSceneId);
}

export function listSceneWorldObjectStates(storylineId: string, sceneId: string): MemoryRecord[] {
  const snapshot = getStoryRuntimeRepository().load();
  return listSceneWorldObjectStatesFromMemories(selectAllMemoryRecords(snapshot, storylineId), sceneId);
}

export function listSceneWorldObjectStatesFromMemories(memories: MemoryRecord[], sceneId: string): MemoryRecord[] {
  const targetSceneId = normalizeSceneId(sceneId);
  return memories
    .filter((memory) => (
      memory.kind === 'world_object_state'
      && memory.status === 'active'
      && !memory.supersededBy
      && !isExpired(memory)
      && memory.worldState?.sceneId === targetSceneId
    ))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function buildSceneProjection(storylineId: string, sceneId: string): SceneProjection | undefined {
  const snapshot = getStoryRuntimeRepository().load();
  return buildSceneProjectionFromMemories(selectAllMemoryRecords(snapshot, storylineId), sceneId);
}

export function buildSceneProjectionFromMemories(
  memories: MemoryRecord[],
  sceneId: string,
): SceneProjection | undefined {
  const states = listSceneWorldObjectStatesFromMemories(memories, sceneId);
  if (states.length === 0) {
    return undefined;
  }

  const items = states.map((memory) => ({
    memoryId: memory.id,
    objectId: memory.worldState!.objectId,
    objectLabel: memory.worldState!.objectLabel,
    stateKind: memory.worldState!.stateKind,
    state: memory.worldState!.state,
    locationText: memory.worldState?.locationText,
    content: memory.content,
  }));

  return {
    sceneId: normalizeSceneId(sceneId),
    summary: items.map((item) => item.content).join(' '),
    items,
  };
}

export function applyWorldStateUpdateCandidate(input: {
  storylineId: string;
  candidate: WorldStateUpdateCandidate;
}): { created?: MemoryRecord; existing?: MemoryRecord; superseded: MemoryRecord[] } {
  const snapshot = getStoryRuntimeRepository().load();
  const storyline = selectStorylineById(snapshot, input.storylineId);
  if (!storyline) {
    throw new Error('未找到目标剧情。');
  }

  const sceneId = normalizeSceneId(input.candidate.sceneId);
  const objectLabel = normalizeObjectLabel(input.candidate.objectLabel);
  const objectId = objectLabel ? createWorldObjectId(sceneId, objectLabel) : '';
  const stateKind = input.candidate.stateKind;
  const state = normalizeWorldStateText(input.candidate.state);
  const locationText = input.candidate.locationText ? normalizeWorldStateText(input.candidate.locationText) : undefined;
  const content = buildWorldStateContent({
    objectLabel: objectLabel ?? '',
    stateKind,
    state,
    locationText,
  });
  if (!objectLabel || !objectId || !state || !isStableWorldStateCandidate(input.candidate) || (stateKind === 'location' && !locationText)) {
    throw new Error('world state candidate 缺少必要字段。');
  }

  const historicalStates = selectAllMemoryRecords(snapshot, input.storylineId)
    .filter((memory) => (
      memory.kind === 'world_object_state'
      && memory.worldState?.sceneId === sceneId
      && memory.worldState.objectId === objectId
    ));
  const activeStates = listSceneWorldObjectStatesFromMemories(historicalStates, sceneId)
    .filter((memory) => memory.worldState?.objectId === objectId);
  const exactExisting = activeStates.find((memory) => (
    memory.worldState?.state === state
    && memory.worldState?.stateKind === stateKind
    && (memory.worldState?.locationText ?? '') === (locationText ?? '')
    && normalizeWorldStateText(memory.content) === content
  ));
  if (exactExisting) {
    return {
      existing: exactExisting,
      superseded: [],
    };
  }

  const version = historicalStates.reduce((max, memory) => Math.max(max, memory.worldState?.version ?? 0), 0) + 1;
  const sourceActivityIds = input.candidate.sourceActivityIds;
  const sourceActivityTimes = sourceActivityIds
    ? selectAllActivityLogs(snapshot, input.storylineId)
      .filter((entry) => sourceActivityIds.includes(entry.id))
      .map((entry) => entry.happenedAt)
      .sort()
    : [];
  const sourceHappenedAtStart = input.candidate.sourceHappenedAtStart ?? sourceActivityTimes[0];
  const sourceHappenedAtEnd = input.candidate.sourceHappenedAtEnd ?? sourceActivityTimes[sourceActivityTimes.length - 1];
  const created = createMemoryRecord(input.storylineId, {
    content,
    scope: 'story',
    source: 'auto_extract',
    kind: 'world_object_state',
    lifespan: 'long_term',
    reason: input.candidate.reason,
    importance: 0.9,
    confidence: input.candidate.confidence,
    sourceMessageIds: input.candidate.sourceMessageIds,
    sourceActivityIds,
    sourceHappenedAtStart,
    sourceHappenedAtEnd,
    semanticEvents: [buildWorldStateSemanticEvent({
      candidate: input.candidate,
      happenedAt: sourceHappenedAtEnd ?? sourceHappenedAtStart,
    })],
    semanticSchemaVersion: 1,
    semanticSource: 'structured',
    supersedes: activeStates.map((memory) => memory.id),
    worldState: {
      sceneId,
      objectId,
      objectLabel,
      stateKind,
      state,
      locationText,
      version,
    },
  });

  const superseded = activeStates
    .map((memory) => updateMemoryRecord(memory.id, {
      status: 'hidden',
      supersededBy: created.id,
    }))
    .filter((memory): memory is MemoryRecord => Boolean(memory));

  return {
    created,
    superseded,
  };
}
