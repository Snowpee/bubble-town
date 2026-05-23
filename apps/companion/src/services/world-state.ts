import crypto from 'node:crypto';
import type { MemoryRecord, SceneProjection, Storyline, WorldStateUpdateCandidate } from '@bubble-town/shared';
import { createMemoryRecord, getStoryline, listAllMemoryRecords, updateMemoryRecord } from './story-runtime-store.js';

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
  if (!normalized || /^(它|它们|东西|那个|这个|那里|这里)$/.test(normalized)) {
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

export function createWorldStateUpdateCandidate(input: {
  sceneId?: string;
  objectLabel: string;
  stateKind: 'status' | 'location';
  state: string;
  locationText?: string;
  actionType: 'place' | 'move' | 'open' | 'close' | 'break' | 'repair' | 'unknown';
  sourceSpan?: string;
  isCurrentStableState: boolean;
  reason: string;
  confidence: number;
  sourceMessageIds?: string[];
  sourceActivityIds?: string[];
}): WorldStateUpdateCandidate | undefined {
  const sceneId = normalizeSceneId(input.sceneId);
  const objectLabel = normalizeObjectLabel(input.objectLabel);
  const stateKind = input.stateKind;
  const state = normalizeWorldStateText(input.state);
  const locationText = input.locationText ? normalizeWorldStateText(input.locationText) : undefined;
  if (!objectLabel || !state || (stateKind === 'location' && !locationText)) {
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
    reason: input.reason,
    confidence: Math.max(0, Math.min(1, input.confidence)),
    sourceMessageIds: input.sourceMessageIds,
    sourceActivityIds: input.sourceActivityIds,
  };
}

export function getStorylineSceneId(storyline: Pick<Storyline, 'currentSceneId'>): string {
  return normalizeSceneId(storyline.currentSceneId);
}

export function listSceneWorldObjectStates(storylineId: string, sceneId: string): MemoryRecord[] {
  const targetSceneId = normalizeSceneId(sceneId);
  return listAllMemoryRecords(storylineId)
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
  const states = listSceneWorldObjectStates(storylineId, sceneId);
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
  const storyline = getStoryline(input.storylineId);
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
  if (!objectLabel || !objectId || !state || !input.candidate.isCurrentStableState || (stateKind === 'location' && !locationText)) {
    throw new Error('world state candidate 缺少必要字段。');
  }

  const activeStates = listSceneWorldObjectStates(input.storylineId, sceneId)
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

  const historicalStates = listAllMemoryRecords(input.storylineId)
    .filter((memory) => (
      memory.kind === 'world_object_state'
      && memory.worldState?.sceneId === sceneId
      && memory.worldState.objectId === objectId
    ));
  const version = historicalStates.reduce((max, memory) => Math.max(max, memory.worldState?.version ?? 0), 0) + 1;
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
    sourceActivityIds: input.candidate.sourceActivityIds,
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
