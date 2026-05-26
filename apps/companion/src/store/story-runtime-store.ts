import crypto from 'node:crypto';
import fs from 'node:fs';
import type {
  ActivityLog,
  Character,
  CreateActivityLogRequest,
  CreateCharacterRequest,
  CreateMemoryRequest,
  CreateStorylineRequest,
  CreateSuppressedMemoryRequest,
  MemoryRecord,
  MemoryCandidate,
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
  selectRuntimeSessionForStoryline,
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
  const removedCharacterCount = data.characters.length - nextCharacters.length;

  if (
    removedStorylineCount > 0
    || removedRuntimeSessionCount > 0
    || removedMemoryCount > 0
    || removedSuppressedMemoryCount > 0
    || removedActivityLogCount > 0
    || removedPendingSemanticFrameCount > 0
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
    removedCharacterCount,
  };
}
