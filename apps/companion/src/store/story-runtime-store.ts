import crypto from 'node:crypto';
import fs from 'node:fs';
import type {
  ActivityLog,
  Character,
  CreateActivityLogRequest,
  CreateCharacterRequest,
  CreateMemoryRequest,
  CreateOffscreenResolutionRequest,
  CreateOpenLoopRequest,
  CreateRelationshipEventRequest,
  CreateRelationshipStateRequest,
  CreateSceneStateRequest,
  CreateStorylineRequest,
  CreateSuppressedMemoryRequest,
  MemoryRecord,
  MemoryCandidate,
  OffscreenResolution,
  OpenLoop,
  RelationshipEvent,
  RelationshipState,
  SceneState,
  SemanticEvent,
  PendingSemanticFrame,
  PendingSemanticFrameKind,
  PendingSemanticFrameStatus,
  RuntimeSession,
  Storyline,
  SuppressedMemory,
  UpdateActivityLogRequest,
  UpdateCharacterRequest,
  UpdateMemoryRequest,
  UpdateOpenLoopRequest,
  UpdateRelationshipStateRequest,
  UpdateSceneStateRequest,
  UpdateStorylineRequest,
} from '@bubble-town/shared';
import {
  getStoryRuntimeRepository,
  getStoryRuntimeStorePath,
  selectActiveStoryline,
  selectActiveStorylineForProfile,
  selectActiveStorylineId,
  selectActivityLogs,
  selectAllActivityLogs,
  selectAllMemoryRecords,
  selectPendingSemanticFrames,
  selectAllSuppressedMemories,
  selectCharacterById,
  selectCharacters,
  selectMemoryRecordById,
  selectMemoryRecords,
  selectOffscreenResolutions,
  selectOpenLoops,
  selectRelationshipEvents,
  selectRelationshipStates,
  selectRuntimeSessionForStoryline,
  selectSceneStates,
  selectStorylineById,
  selectStorylines,
  selectSuppressedMemories,
  type StoryRuntimeSnapshot,
} from '../runtime/story-runtime-repository.js';

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizeSemanticEvents(events: SemanticEvent[] | undefined, happenedAt?: string): SemanticEvent[] | undefined {
  if (!events?.length) {
    return undefined;
  }
  return events
    .map((event) => ({
      ...event,
      id: event.id || createId('semantic_event'),
      evidenceSpan: event.evidenceSpan.trim(),
      confidence: Math.max(0, Math.min(1, event.confidence)),
      happenedAt: event.happenedAt ?? happenedAt,
    }))
    .filter((event) => event.evidenceSpan);
}

function readData(): StoryRuntimeSnapshot {
  return getStoryRuntimeRepository().load();
}

function writeData(data: StoryRuntimeSnapshot): void {
  getStoryRuntimeRepository().save(data);
}

export function listCharacters(): Character[] {
  return selectCharacters(readData());
}

export function getCharacter(id: string): Character | undefined {
  return selectCharacterById(readData(), id);
}

export function createCharacter(input: CreateCharacterRequest): Character {
  const name = input.name.trim();
  const templateProfileId = input.templateProfileId.trim();
  if (!name) {
    throw new Error('角色名称不能为空。');
  }
  if (!templateProfileId) {
    throw new Error('角色模板 profile 不能为空。');
  }

  const data = readData();
  const now = nowIso();
  const character: Character = {
    id: createId('char'),
    name,
    templateProfileId,
    avatar: input.avatar?.trim() || undefined,
    description: input.description?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  data.characters.push(character);
  writeData(data);
  return character;
}

export function updateCharacter(id: string, input: UpdateCharacterRequest): Character | undefined {
  const data = readData();
  const index = data.characters.findIndex((character) => character.id === id);
  if (index === -1) {
    return undefined;
  }

  const current = data.characters[index]!;
  const updated: Character = {
    ...current,
    name: input.name?.trim() || current.name,
    templateProfileId: input.templateProfileId?.trim() || current.templateProfileId,
    avatar: input.avatar === undefined ? current.avatar : input.avatar.trim() || undefined,
    description: input.description === undefined ? current.description : input.description.trim() || undefined,
    updatedAt: nowIso(),
  };
  data.characters[index] = updated;
  writeData(data);
  return updated;
}

export function listStorylines(): Storyline[] {
  return selectStorylines(readData());
}

export function getActiveStorylineId(): string | undefined {
  return selectActiveStorylineId(readData());
}

export function getActiveStoryline(): Storyline | undefined {
  return selectActiveStoryline(readData());
}

export function getActiveStorylineForProfile(hermesProfileId: string): Storyline | undefined {
  return selectActiveStorylineForProfile(readData(), hermesProfileId);
}

export function getStoryline(id: string): Storyline | undefined {
  return selectStorylineById(readData(), id);
}

function assertUniqueStorylineProfile(data: StoryRuntimeSnapshot, hermesProfileId: string, currentStorylineId?: string): void {
  const conflict = data.storylines.find(
    (storyline) => storyline.id !== currentStorylineId && storyline.status === 'active' && storyline.hermesProfileId === hermesProfileId,
  );
  if (conflict) {
    throw new Error(`Hermes profile 已绑定到剧情：${conflict.title}`);
  }
}

export function createStoryline(input: CreateStorylineRequest): Storyline {
  const characterId = input.characterId.trim();
  const hermesProfileId = input.hermesProfileId.trim();
  const title = input.title.trim();
  if (!characterId) {
    throw new Error('角色不能为空。');
  }
  if (!hermesProfileId) {
    throw new Error('Hermes profile 不能为空。');
  }
  if (!title) {
    throw new Error('剧情标题不能为空。');
  }

  const data = readData();
  if (!data.characters.some((character) => character.id === characterId)) {
    throw new Error('未找到目标角色。');
  }
  assertUniqueStorylineProfile(data, hermesProfileId);

  const now = nowIso();
  const storyline: Storyline = {
    id: createId('story'),
    characterId,
    hermesProfileId,
    title,
    description: input.description?.trim() || undefined,
    currentSceneId: input.currentSceneId?.trim() || 'default_scene',
    createdAt: now,
    updatedAt: now,
    status: 'active',
  };
  data.storylines.push(storyline);
  data.activeStorylineId = storyline.id;
  writeData(data);
  return storyline;
}

export function updateStoryline(id: string, input: UpdateStorylineRequest): Storyline | undefined {
  const data = readData();
  const index = data.storylines.findIndex((storyline) => storyline.id === id);
  if (index === -1) {
    return undefined;
  }

  const current = data.storylines[index]!;
  const nextStatus = input.status ?? current.status;
  if (nextStatus === 'active') {
    assertUniqueStorylineProfile(data, current.hermesProfileId, current.id);
  }

  const updated: Storyline = {
    ...current,
    title: input.title?.trim() || current.title,
    description: input.description === undefined ? current.description : input.description.trim() || undefined,
    currentSceneId: input.currentSceneId === undefined ? current.currentSceneId : input.currentSceneId.trim() || 'default_scene',
    status: nextStatus,
    updatedAt: nowIso(),
  };
  data.storylines[index] = updated;
  if (updated.status === 'archived' && data.activeStorylineId === updated.id) {
    data.activeStorylineId = undefined;
  }
  writeData(data);
  return updated;
}

export function setActiveStoryline(id: string): Storyline | undefined {
  const data = readData();
  const storyline = data.storylines.find((entry) => entry.id === id && entry.status === 'active');
  if (!storyline) {
    return undefined;
  }

  data.activeStorylineId = storyline.id;
  writeData(data);
  return storyline;
}

export function setActiveStorylineForProfile(hermesProfileId: string): Storyline | undefined {
  const profileId = hermesProfileId.trim();
  if (!profileId) {
    return undefined;
  }

  const data = readData();
  const storyline = data.storylines.find((entry) => entry.hermesProfileId === profileId && entry.status === 'active');
  if (!storyline) {
    data.activeStorylineId = undefined;
    writeData(data);
    return undefined;
  }

  data.activeStorylineId = storyline.id;
  writeData(data);
  return storyline;
}

export function getRuntimeSessionForStoryline(storylineId: string): RuntimeSession | undefined {
  return selectRuntimeSessionForStoryline(readData(), storylineId);
}

export function upsertRuntimeSession(input: {
  storylineId: string;
  hermesProfileId: string;
  hermesSessionId?: string;
  previousResponseId?: string;
  reason: RuntimeSession['reason'];
}): RuntimeSession {
  const data = readData();
  const existingIndex = data.runtimeSessions.findIndex((session) => session.storylineId === input.storylineId);
  const now = nowIso();

  if (existingIndex !== -1) {
    const current = data.runtimeSessions[existingIndex]!;
    const updated: RuntimeSession = {
      ...current,
      hermesProfileId: input.hermesProfileId,
      hermesSessionId: input.hermesSessionId ?? current.hermesSessionId,
      previousResponseId: input.previousResponseId ?? current.previousResponseId,
      reason: input.reason,
      updatedAt: now,
    };
    data.runtimeSessions[existingIndex] = updated;
    writeData(data);
    return updated;
  }

  const created: RuntimeSession = {
    id: createId('runtime'),
    storylineId: input.storylineId,
    hermesProfileId: input.hermesProfileId,
    hermesSessionId: input.hermesSessionId,
    previousResponseId: input.previousResponseId,
    reason: input.reason,
    createdAt: now,
    updatedAt: now,
  };
  data.runtimeSessions.push(created);
  writeData(data);
  return created;
}

export function clearRuntimeSessionContinuation(input: {
  storylineId: string;
  hermesProfileId: string;
  reason: RuntimeSession['reason'];
}): RuntimeSession {
  const data = readData();
  const existingIndex = data.runtimeSessions.findIndex((session) => session.storylineId === input.storylineId);
  const now = nowIso();

  if (existingIndex !== -1) {
    const current = data.runtimeSessions[existingIndex]!;
    const updated: RuntimeSession = {
      ...current,
      hermesProfileId: input.hermesProfileId,
      hermesSessionId: undefined,
      previousResponseId: undefined,
      reason: input.reason,
      updatedAt: now,
    };
    data.runtimeSessions[existingIndex] = updated;
    writeData(data);
    return updated;
  }

  const created: RuntimeSession = {
    id: createId('runtime'),
    storylineId: input.storylineId,
    hermesProfileId: input.hermesProfileId,
    reason: input.reason,
    createdAt: now,
    updatedAt: now,
  };
  data.runtimeSessions.push(created);
  writeData(data);
  return created;
}

export function touchStorylineInteraction(storylineId: string, at = nowIso()): Storyline | undefined {
  const data = readData();
  const index = data.storylines.findIndex((storyline) => storyline.id === storylineId);
  if (index === -1) {
    return undefined;
  }
  const updated = {
    ...data.storylines[index]!,
    lastInteractionAt: at,
    updatedAt: at,
  };
  data.storylines[index] = updated;
  writeData(data);
  return updated;
}

export function listMemoryRecords(storylineId: string, characterId: string): MemoryRecord[] {
  return selectMemoryRecords(readData(), storylineId, characterId);
}

export function listAllMemoryRecords(storylineId: string): MemoryRecord[] {
  return selectAllMemoryRecords(readData(), storylineId);
}

export function getMemoryRecord(id: string): MemoryRecord | undefined {
  return selectMemoryRecordById(readData(), id);
}

export function createMemoryRecord(storylineId: string, input: CreateMemoryRequest): MemoryRecord {
  const storyline = getStoryline(storylineId);
  if (!storyline) {
    throw new Error('未找到目标剧情。');
  }
  const content = input.content.trim();
  if (!content) {
    throw new Error('记忆内容不能为空。');
  }

  const data = readData();
  const now = nowIso();
  const memory: MemoryRecord = {
    id: createId('mem'),
    storylineId,
    characterId: storyline.characterId,
    content,
    scope: input.scope ?? 'story',
    source: input.source ?? 'manual',
    status: 'active',
    kind: input.kind,
    lifespan: input.lifespan,
    reason: input.reason?.trim() || undefined,
    importance: input.importance,
    confidence: input.confidence,
    createdAt: now,
    updatedAt: now,
    sourceMessageIds: input.sourceMessageIds,
    supersedes: input.supersedes,
    supersededBy: input.supersededBy,
    sourceActivityIds: input.sourceActivityIds,
    sourceHappenedAtStart: input.sourceHappenedAtStart,
    sourceHappenedAtEnd: input.sourceHappenedAtEnd,
    semanticEvents: input.semanticEvents,
    semanticSchemaVersion: input.semanticEvents?.length ? 1 : undefined,
    semanticSource: input.semanticEvents?.length ? 'structured' : undefined,
    lastAccessedAt: input.lastAccessedAt,
    accessCount: input.accessCount,
    expiresAt: input.expiresAt,
    embeddingRef: input.embeddingRef,
    embeddingModel: input.embeddingModel,
    embeddingText: input.embeddingText,
    embeddingUpdatedAt: input.embeddingUpdatedAt,
    worldState: input.worldState,
  };
  data.memoryRecords.push(memory);
  writeData(data);
  return memory;
}

export function updateMemoryRecord(id: string, input: UpdateMemoryRequest): MemoryRecord | undefined {
  const data = readData();
  const index = data.memoryRecords.findIndex((memory) => memory.id === id);
  if (index === -1) {
    return undefined;
  }
  const current = data.memoryRecords[index]!;
  const updated: MemoryRecord = {
    ...current,
    content: input.content?.trim() || current.content,
    scope: input.scope ?? current.scope,
    source: input.source ?? current.source,
    status: input.status ?? current.status,
    kind: input.kind ?? current.kind,
    lifespan: input.lifespan ?? current.lifespan,
    reason: input.reason === undefined ? current.reason : input.reason.trim() || undefined,
    importance: input.importance ?? current.importance,
    confidence: input.confidence ?? current.confidence,
    sourceMessageIds: input.sourceMessageIds ?? current.sourceMessageIds,
    supersedes: input.supersedes ?? current.supersedes,
    supersededBy: input.supersededBy ?? current.supersededBy,
    sourceActivityIds: input.sourceActivityIds ?? current.sourceActivityIds,
    sourceHappenedAtStart: input.sourceHappenedAtStart ?? current.sourceHappenedAtStart,
    sourceHappenedAtEnd: input.sourceHappenedAtEnd ?? current.sourceHappenedAtEnd,
    semanticEvents: input.semanticEvents ?? current.semanticEvents,
    semanticSchemaVersion: input.semanticSchemaVersion ?? current.semanticSchemaVersion,
    semanticSource: input.semanticSource ?? current.semanticSource,
    lastAccessedAt: input.lastAccessedAt ?? current.lastAccessedAt,
    accessCount: input.accessCount ?? current.accessCount,
    expiresAt: input.expiresAt ?? current.expiresAt,
    embeddingRef: input.embeddingRef ?? current.embeddingRef,
    embeddingModel: input.embeddingModel ?? current.embeddingModel,
    embeddingText: input.embeddingText ?? current.embeddingText,
    embeddingUpdatedAt: input.embeddingUpdatedAt ?? current.embeddingUpdatedAt,
    worldState: input.worldState ?? current.worldState,
    updatedAt: nowIso(),
  };
  data.memoryRecords[index] = updated;
  writeData(data);
  return updated;
}

export function permanentlyDeleteMemoryRecord(id: string): MemoryRecord | undefined {
  const data = readData();
  const index = data.memoryRecords.findIndex((memory) => memory.id === id);
  if (index === -1) {
    return undefined;
  }
  const [deleted] = data.memoryRecords.splice(index, 1);
  writeData(data);
  return deleted;
}

export function markMemoryRecordsAccessed(ids: string[], at = nowIso()): MemoryRecord[] {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) {
    return [];
  }

  const data = readData();
  const updated: MemoryRecord[] = [];
  for (const id of uniqueIds) {
    const index = data.memoryRecords.findIndex((memory) => memory.id === id);
    if (index === -1) {
      continue;
    }
    const current = data.memoryRecords[index]!;
    const next = {
      ...current,
      lastAccessedAt: at,
      accessCount: (current.accessCount ?? 0) + 1,
    };
    data.memoryRecords[index] = next;
    updated.push(next);
  }
  if (updated.length > 0) {
    writeData(data);
  }
  return updated;
}

export function listSuppressedMemories(storylineId: string, characterId: string): SuppressedMemory[] {
  return selectSuppressedMemories(readData(), storylineId, characterId);
}

export function listAllSuppressedMemories(storylineId: string): SuppressedMemory[] {
  return selectAllSuppressedMemories(readData(), storylineId);
}

export function createSuppressedMemory(storylineId: string, input: CreateSuppressedMemoryRequest): SuppressedMemory {
  const storyline = getStoryline(storylineId);
  if (!storyline) {
    throw new Error('未找到目标剧情。');
  }
  const pattern = input.pattern.trim();
  if (!pattern) {
    throw new Error('抑制规则不能为空。');
  }
  const data = readData();
  const now = nowIso();
  const memory: SuppressedMemory = {
    id: createId('suppress'),
    storylineId,
    characterId: storyline.characterId,
    pattern,
    reason: input.reason?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    status: 'active',
  };
  data.suppressedMemories.push(memory);
  writeData(data);
  return memory;
}

export function deleteSuppressedMemory(id: string): boolean {
  const data = readData();
  const index = data.suppressedMemories.findIndex((memory) => memory.id === id);
  if (index === -1) {
    return false;
  }
  data.suppressedMemories[index] = {
    ...data.suppressedMemories[index]!,
    status: 'deleted',
    updatedAt: nowIso(),
  };
  writeData(data);
  return true;
}

export function listActivityLogs(storylineId: string): ActivityLog[] {
  return selectActivityLogs(readData(), storylineId);
}

export function listAllActivityLogs(storylineId: string): ActivityLog[] {
  return selectAllActivityLogs(readData(), storylineId);
}

export function listPendingSemanticFrames(storylineId: string): PendingSemanticFrame[] {
  return selectPendingSemanticFrames(readData(), storylineId);
}

export function listOpenLoops(storylineId: string): OpenLoop[] {
  return selectOpenLoops(readData(), storylineId);
}

export function createOpenLoop(storylineId: string, input: CreateOpenLoopRequest): OpenLoop {
  if (!getStoryline(storylineId)) {
    throw new Error('未找到目标剧情。');
  }
  const summary = input.summary.trim();
  const lastBeat = input.lastBeat.trim();
  const suggestedResume = input.suggestedResume.trim();
  if (!summary || !lastBeat || !suggestedResume) {
    throw new Error('OpenLoop 摘要、最后节拍和恢复建议不能为空。');
  }
  const data = readData();
  const now = nowIso();
  const openLoop: OpenLoop = {
    id: createId('open_loop'),
    storylineId,
    kind: input.kind,
    status: input.status ?? 'active',
    summary,
    lastBeat,
    suggestedResume,
    sensitivity: input.sensitivity ?? 'medium',
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt,
    sourceActivityIds: input.sourceActivityIds,
    sourceMessageIds: input.sourceMessageIds,
  };
  data.openLoops.push(openLoop);
  writeData(data);
  return openLoop;
}

export function updateOpenLoop(id: string, input: UpdateOpenLoopRequest): OpenLoop | undefined {
  const data = readData();
  const index = data.openLoops.findIndex((loop) => loop.id === id);
  if (index === -1) {
    return undefined;
  }
  const current = data.openLoops[index]!;
  const updated: OpenLoop = {
    ...current,
    kind: input.kind ?? current.kind,
    status: input.status ?? current.status,
    summary: input.summary === undefined ? current.summary : input.summary.trim() || current.summary,
    lastBeat: input.lastBeat === undefined ? current.lastBeat : input.lastBeat.trim() || current.lastBeat,
    suggestedResume: input.suggestedResume === undefined ? current.suggestedResume : input.suggestedResume.trim() || current.suggestedResume,
    sensitivity: input.sensitivity ?? current.sensitivity,
    expiresAt: input.expiresAt === undefined ? current.expiresAt : input.expiresAt,
    sourceActivityIds: input.sourceActivityIds ?? current.sourceActivityIds,
    sourceMessageIds: input.sourceMessageIds ?? current.sourceMessageIds,
    updatedAt: nowIso(),
  };
  data.openLoops[index] = updated;
  writeData(data);
  return updated;
}

export function listSceneStates(storylineId: string): SceneState[] {
  return selectSceneStates(readData(), storylineId);
}

export function createSceneState(storylineId: string, input: CreateSceneStateRequest): SceneState {
  if (!getStoryline(storylineId)) {
    throw new Error('未找到目标剧情。');
  }
  const sceneId = input.sceneId.trim();
  const lastBeatSummary = input.lastBeatSummary.trim();
  if (!sceneId || !lastBeatSummary) {
    throw new Error('SceneState 的 sceneId 和 lastBeatSummary 不能为空。');
  }
  const data = readData();
  const now = nowIso();
  const sceneState: SceneState = {
    id: createId('scene_state'),
    storylineId,
    sceneId,
    kind: input.kind,
    status: input.status ?? 'active',
    inWorldTimeMode: input.inWorldTimeMode ?? 'compressed',
    pausedAtRealTime: input.pausedAtRealTime,
    lastBeatSummary,
    nextBeatOptions: input.nextBeatOptions ?? [],
    closurePolicy: input.closurePolicy,
    createdAt: now,
    updatedAt: now,
    sourceActivityIds: input.sourceActivityIds,
    sourceMessageIds: input.sourceMessageIds,
  };
  data.sceneStates.push(sceneState);
  writeData(data);
  return sceneState;
}

export function updateSceneState(id: string, input: UpdateSceneStateRequest): SceneState | undefined {
  const data = readData();
  const index = data.sceneStates.findIndex((state) => state.id === id);
  if (index === -1) {
    return undefined;
  }
  const current = data.sceneStates[index]!;
  const updated: SceneState = {
    ...current,
    kind: input.kind ?? current.kind,
    status: input.status ?? current.status,
    inWorldTimeMode: input.inWorldTimeMode ?? current.inWorldTimeMode,
    pausedAtRealTime: input.pausedAtRealTime === undefined ? current.pausedAtRealTime : input.pausedAtRealTime,
    lastBeatSummary: input.lastBeatSummary === undefined ? current.lastBeatSummary : input.lastBeatSummary.trim() || current.lastBeatSummary,
    nextBeatOptions: input.nextBeatOptions ?? current.nextBeatOptions,
    closurePolicy: input.closurePolicy ?? current.closurePolicy,
    sourceActivityIds: input.sourceActivityIds ?? current.sourceActivityIds,
    sourceMessageIds: input.sourceMessageIds ?? current.sourceMessageIds,
    updatedAt: nowIso(),
  };
  data.sceneStates[index] = updated;
  writeData(data);
  return updated;
}

export function listOffscreenResolutions(storylineId: string): OffscreenResolution[] {
  return selectOffscreenResolutions(readData(), storylineId);
}

export function createOffscreenResolution(
  storylineId: string,
  input: CreateOffscreenResolutionRequest,
): OffscreenResolution {
  if (!getStoryline(storylineId)) {
    throw new Error('未找到目标剧情。');
  }
  const sceneId = input.sceneId.trim();
  if (!sceneId) {
    throw new Error('OffscreenResolution 的 sceneId 不能为空。');
  }
  const data = readData();
  const resolution: OffscreenResolution = {
    id: createId('offscreen_resolution'),
    storylineId,
    sceneId,
    mode: input.mode,
    summary: input.summary?.trim() || undefined,
    generatedAt: nowIso(),
    confidence: Math.max(0, Math.min(1, input.confidence)),
    canonLevel: input.canonLevel,
    sourceSceneStateId: input.sourceSceneStateId,
    sourceActivityIds: input.sourceActivityIds,
    sourceMessageIds: input.sourceMessageIds,
  };
  data.offscreenResolutions.push(resolution);
  writeData(data);
  return resolution;
}

export function listRelationshipStates(storylineId: string): RelationshipState[] {
  return selectRelationshipStates(readData(), storylineId);
}

export function createRelationshipState(storylineId: string, input: CreateRelationshipStateRequest): RelationshipState {
  const storyline = getStoryline(storylineId);
  if (!storyline) {
    throw new Error('未找到目标剧情。');
  }
  const summary = input.summary.trim();
  if (!summary) {
    throw new Error('RelationshipState 的 summary 不能为空。');
  }
  const data = readData();
  const now = nowIso();
  const state: RelationshipState = {
    id: createId('relationship_state'),
    storylineId,
    characterId: storyline.characterId,
    status: input.status ?? 'neutral',
    distance: input.distance ?? 'professional',
    repairState: input.repairState ?? 'none',
    boundaryRiskLevel: input.boundaryRiskLevel ?? 'none',
    trustTrend: input.trustTrend ?? 'flat',
    conflictTrend: input.conflictTrend ?? 'flat',
    summary,
    privateNotes: input.privateNotes,
    sourceEventIds: input.sourceEventIds,
    sourceActivityIds: input.sourceActivityIds,
    createdAt: now,
    updatedAt: now,
  };
  data.relationshipStates.push(state);
  writeData(data);
  return state;
}

export function updateRelationshipState(
  id: string,
  input: UpdateRelationshipStateRequest,
): RelationshipState | undefined {
  const data = readData();
  const index = data.relationshipStates.findIndex((state) => state.id === id);
  if (index === -1) {
    return undefined;
  }
  const current = data.relationshipStates[index]!;
  const updated: RelationshipState = {
    ...current,
    status: input.status ?? current.status,
    distance: input.distance ?? current.distance,
    repairState: input.repairState ?? current.repairState,
    boundaryRiskLevel: input.boundaryRiskLevel ?? current.boundaryRiskLevel,
    trustTrend: input.trustTrend ?? current.trustTrend,
    conflictTrend: input.conflictTrend ?? current.conflictTrend,
    summary: input.summary === undefined ? current.summary : input.summary.trim() || current.summary,
    privateNotes: input.privateNotes ?? current.privateNotes,
    sourceEventIds: input.sourceEventIds ?? current.sourceEventIds,
    sourceActivityIds: input.sourceActivityIds ?? current.sourceActivityIds,
    updatedAt: nowIso(),
  };
  data.relationshipStates[index] = updated;
  writeData(data);
  return updated;
}

export function listRelationshipEvents(storylineId: string): RelationshipEvent[] {
  return selectRelationshipEvents(readData(), storylineId);
}

export function createRelationshipEvent(storylineId: string, input: CreateRelationshipEventRequest): RelationshipEvent {
  const storyline = getStoryline(storylineId);
  if (!storyline) {
    throw new Error('未找到目标剧情。');
  }
  const summary = input.summary.trim();
  const reason = input.reason.trim();
  if (!summary || !reason) {
    throw new Error('RelationshipEvent 的 summary 和 reason 不能为空。');
  }
  const data = readData();
  const event: RelationshipEvent = {
    id: createId('relationship_event'),
    storylineId,
    characterId: storyline.characterId,
    kind: input.kind,
    status: input.status ?? (input.confidence >= 0.78 ? 'confirmed' : 'candidate'),
    violationLevel: input.violationLevel,
    summary,
    evidenceSpan: input.evidenceSpan?.trim() || undefined,
    reason,
    confidence: Math.max(0, Math.min(1, input.confidence)),
    createdAt: nowIso(),
    sourceActivityId: input.sourceActivityId,
    sourceMessageIds: input.sourceMessageIds,
  };
  data.relationshipEvents.push(event);
  writeData(data);
  return event;
}

export function createPendingSemanticFrame(input: {
  storylineId: string;
  kind: PendingSemanticFrameKind;
  candidate: MemoryCandidate;
  prompt: string;
  sourceMessageIds?: string[];
}): PendingSemanticFrame {
  if (!getStoryline(input.storylineId)) {
    throw new Error('未找到目标剧情。');
  }
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error('待确认语义提示不能为空。');
  }
  const data = readData();
  const now = nowIso();
  const frame: PendingSemanticFrame = {
    id: createId('pending'),
    storylineId: input.storylineId,
    kind: input.kind,
    candidate: input.candidate,
    prompt,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    sourceMessageIds: input.sourceMessageIds,
  };
  data.pendingSemanticFrames.push(frame);
  writeData(data);
  return frame;
}

export function updatePendingSemanticFrame(id: string, input: {
  status?: PendingSemanticFrameStatus;
  prompt?: string;
  candidate?: MemoryCandidate;
  resolvedByMessageIds?: string[];
  lastUserReply?: string;
}): PendingSemanticFrame | undefined {
  const data = readData();
  const index = data.pendingSemanticFrames.findIndex((frame) => frame.id === id);
  if (index === -1) {
    return undefined;
  }
  const current = data.pendingSemanticFrames[index]!;
  const updated: PendingSemanticFrame = {
    ...current,
    status: input.status ?? current.status,
    prompt: input.prompt === undefined ? current.prompt : input.prompt.trim() || current.prompt,
    candidate: input.candidate ?? current.candidate,
    resolvedByMessageIds: input.resolvedByMessageIds ?? current.resolvedByMessageIds,
    lastUserReply: input.lastUserReply === undefined ? current.lastUserReply : input.lastUserReply.trim() || undefined,
    updatedAt: nowIso(),
  };
  data.pendingSemanticFrames[index] = updated;
  writeData(data);
  return updated;
}

export function createActivityLog(storylineId: string, input: CreateActivityLogRequest): ActivityLog {
  if (!getStoryline(storylineId)) {
    throw new Error('未找到目标剧情。');
  }
  const summary = input.summary.trim();
  if (!summary) {
    throw new Error('活动摘要不能为空。');
  }
  const data = readData();
  const now = nowIso();
  const happenedAt = input.happenedAt ?? now;
  const semanticEvents = normalizeSemanticEvents(input.semanticEvents, happenedAt);
  const activity: ActivityLog = {
    id: createId('activity'),
    storylineId,
    happenedAt,
    timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    summary,
    tags: input.tags ?? [],
    status: 'active',
    sourceMessageIds: input.sourceMessageIds,
    semanticEvents,
    semanticSchemaVersion: input.semanticSchemaVersion ?? (semanticEvents?.length ? 1 : undefined),
    semanticSource: input.semanticSource ?? (semanticEvents?.length ? 'structured' : undefined),
    embeddingRef: input.embeddingRef,
    embeddingModel: input.embeddingModel,
    embeddingText: input.embeddingText,
    embeddingUpdatedAt: input.embeddingUpdatedAt,
  };
  data.activityLogs.push(activity);
  writeData(data);
  return activity;
}

export function updateActivityLog(id: string, input: UpdateActivityLogRequest): ActivityLog | undefined {
  const data = readData();
  const index = data.activityLogs.findIndex((entry) => entry.id === id);
  if (index === -1) {
    return undefined;
  }
  const current = data.activityLogs[index]!;
  const happenedAt = input.happenedAt ?? current.happenedAt;
  const semanticEvents = input.semanticEvents === undefined
    ? current.semanticEvents
    : normalizeSemanticEvents(input.semanticEvents, happenedAt);
  const updated: ActivityLog = {
    ...current,
    happenedAt,
    timezone: input.timezone ?? current.timezone,
    summary: input.summary?.trim() || current.summary,
    tags: input.tags ?? current.tags,
    status: input.status ?? current.status,
    sourceMessageIds: input.sourceMessageIds ?? current.sourceMessageIds,
    semanticEvents,
    semanticSchemaVersion: input.semanticSchemaVersion ?? current.semanticSchemaVersion ?? (semanticEvents?.length ? 1 : undefined),
    semanticSource: input.semanticSource ?? current.semanticSource ?? (semanticEvents?.length ? 'structured' : undefined),
    embeddingRef: input.embeddingRef ?? current.embeddingRef,
    embeddingModel: input.embeddingModel ?? current.embeddingModel,
    embeddingText: input.embeddingText ?? current.embeddingText,
    embeddingUpdatedAt: input.embeddingUpdatedAt ?? current.embeddingUpdatedAt,
  };
  data.activityLogs[index] = updated;
  writeData(data);
  return updated;
}

export function resetStoryRuntimeForTests(): void {
  const storePath = getStoryRuntimeStorePath();
  if (fs.existsSync(storePath)) {
    fs.unlinkSync(storePath);
  }
}

export function resetProfileRuntimeState(profileId: string): {
  storylineIds: string[];
  removedStorylineCount: number;
  removedRuntimeSessionCount: number;
  removedMemoryCount: number;
  removedSuppressedMemoryCount: number;
  removedActivityLogCount: number;
  removedPendingSemanticFrameCount: number;
  removedOpenLoopCount: number;
  removedSceneStateCount: number;
  removedOffscreenResolutionCount: number;
  removedRelationshipStateCount: number;
  removedRelationshipEventCount: number;
  removedCharacterCount: number;
} {
  const targetProfileId = profileId.trim();
  if (!targetProfileId) {
    return {
      storylineIds: [],
      removedStorylineCount: 0,
      removedRuntimeSessionCount: 0,
      removedMemoryCount: 0,
      removedSuppressedMemoryCount: 0,
      removedActivityLogCount: 0,
      removedPendingSemanticFrameCount: 0,
      removedOpenLoopCount: 0,
      removedSceneStateCount: 0,
      removedOffscreenResolutionCount: 0,
      removedRelationshipStateCount: 0,
      removedRelationshipEventCount: 0,
      removedCharacterCount: 0,
    };
  }

  const data = readData();
  const storylineIds = data.storylines
    .filter((storyline) => storyline.hermesProfileId === targetProfileId)
    .map((storyline) => storyline.id);
  const storylineIdSet = new Set(storylineIds);
  const characterIds = data.storylines
    .filter((storyline) => storylineIdSet.has(storyline.id))
    .map((storyline) => storyline.characterId);
  const characterIdSet = new Set(characterIds);

  const nextStorylines = data.storylines.filter((storyline) => !storylineIdSet.has(storyline.id));
  const nextRuntimeSessions = data.runtimeSessions.filter((session) => (
    session.hermesProfileId !== targetProfileId && !storylineIdSet.has(session.storylineId)
  ));
  const nextMemoryRecords = data.memoryRecords.filter((memory) => !storylineIdSet.has(memory.storylineId ?? ''));
  const nextSuppressedMemories = data.suppressedMemories.filter((memory) => !storylineIdSet.has(memory.storylineId ?? ''));
  const nextActivityLogs = data.activityLogs.filter((activityLog) => !storylineIdSet.has(activityLog.storylineId));
  const nextPendingSemanticFrames = data.pendingSemanticFrames.filter((frame) => !storylineIdSet.has(frame.storylineId));
  const nextOpenLoops = data.openLoops.filter((loop) => !storylineIdSet.has(loop.storylineId));
  const nextSceneStates = data.sceneStates.filter((state) => !storylineIdSet.has(state.storylineId));
  const nextOffscreenResolutions = data.offscreenResolutions.filter((resolution) => !storylineIdSet.has(resolution.storylineId));
  const nextRelationshipStates = data.relationshipStates.filter((state) => !storylineIdSet.has(state.storylineId));
  const nextRelationshipEvents = data.relationshipEvents.filter((event) => !storylineIdSet.has(event.storylineId));
  const usedCharacterIds = new Set(nextStorylines.map((storyline) => storyline.characterId));
  const nextCharacters = data.characters.filter((character) => !characterIdSet.has(character.id) || usedCharacterIds.has(character.id));
  const nextActiveStorylineId = data.activeStorylineId && storylineIdSet.has(data.activeStorylineId)
    ? undefined
    : data.activeStorylineId;

  const removedStorylineCount = data.storylines.length - nextStorylines.length;
  const removedRuntimeSessionCount = data.runtimeSessions.length - nextRuntimeSessions.length;
  const removedMemoryCount = data.memoryRecords.length - nextMemoryRecords.length;
  const removedSuppressedMemoryCount = data.suppressedMemories.length - nextSuppressedMemories.length;
  const removedActivityLogCount = data.activityLogs.length - nextActivityLogs.length;
  const removedPendingSemanticFrameCount = data.pendingSemanticFrames.length - nextPendingSemanticFrames.length;
  const removedOpenLoopCount = data.openLoops.length - nextOpenLoops.length;
  const removedSceneStateCount = data.sceneStates.length - nextSceneStates.length;
  const removedOffscreenResolutionCount = data.offscreenResolutions.length - nextOffscreenResolutions.length;
  const removedRelationshipStateCount = data.relationshipStates.length - nextRelationshipStates.length;
  const removedRelationshipEventCount = data.relationshipEvents.length - nextRelationshipEvents.length;
  const removedCharacterCount = data.characters.length - nextCharacters.length;

  if (
    removedStorylineCount > 0
    || removedRuntimeSessionCount > 0
    || removedMemoryCount > 0
    || removedSuppressedMemoryCount > 0
    || removedActivityLogCount > 0
    || removedPendingSemanticFrameCount > 0
    || removedOpenLoopCount > 0
    || removedSceneStateCount > 0
    || removedOffscreenResolutionCount > 0
    || removedRelationshipStateCount > 0
    || removedRelationshipEventCount > 0
    || removedCharacterCount > 0
    || nextActiveStorylineId !== data.activeStorylineId
  ) {
    writeData({
      ...data,
      activeStorylineId: nextActiveStorylineId,
      characters: nextCharacters,
      storylines: nextStorylines,
      runtimeSessions: nextRuntimeSessions,
      memoryRecords: nextMemoryRecords,
      suppressedMemories: nextSuppressedMemories,
      activityLogs: nextActivityLogs,
      pendingSemanticFrames: nextPendingSemanticFrames,
      openLoops: nextOpenLoops,
      sceneStates: nextSceneStates,
      offscreenResolutions: nextOffscreenResolutions,
      relationshipStates: nextRelationshipStates,
      relationshipEvents: nextRelationshipEvents,
    });
  }

  return {
    storylineIds,
    removedStorylineCount,
    removedRuntimeSessionCount,
    removedMemoryCount,
    removedSuppressedMemoryCount,
    removedActivityLogCount,
    removedPendingSemanticFrameCount,
    removedOpenLoopCount,
    removedSceneStateCount,
    removedOffscreenResolutionCount,
    removedRelationshipStateCount,
    removedRelationshipEventCount,
    removedCharacterCount,
  };
}
