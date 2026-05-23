import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ActivityLog,
  Character,
  CreateActivityLogRequest,
  CreateCharacterRequest,
  CreateMemoryRequest,
  CreateStorylineRequest,
  CreateSuppressedMemoryRequest,
  MemoryRecord,
  RuntimeSession,
  Storyline,
  SuppressedMemory,
  UpdateActivityLogRequest,
  UpdateCharacterRequest,
  UpdateMemoryRequest,
  UpdateStorylineRequest,
} from '@bubble-town/shared';
import { getHermesRoot } from './hermes-paths.js';

interface StoryRuntimeData {
  version: 1;
  activeStorylineId?: string;
  characters: Character[];
  storylines: Storyline[];
  runtimeSessions: RuntimeSession[];
  memoryRecords: MemoryRecord[];
  suppressedMemories: SuppressedMemory[];
  activityLogs: ActivityLog[];
}

const EMPTY_DATA: StoryRuntimeData = {
  version: 1,
  characters: [],
  storylines: [],
  runtimeSessions: [],
  memoryRecords: [],
  suppressedMemories: [],
  activityLogs: [],
};

function getRuntimeStorePath(): string {
  return path.join(getHermesRoot(), 'bubble-town-runtime.json');
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function readData(): StoryRuntimeData {
  const storePath = getRuntimeStorePath();
  if (!fs.existsSync(storePath)) {
    return { ...EMPTY_DATA };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8')) as Partial<StoryRuntimeData>;
    return {
      version: 1,
      activeStorylineId: parsed.activeStorylineId,
      characters: Array.isArray(parsed.characters) ? parsed.characters : [],
      storylines: Array.isArray(parsed.storylines) ? parsed.storylines : [],
      runtimeSessions: Array.isArray(parsed.runtimeSessions) ? parsed.runtimeSessions : [],
      memoryRecords: Array.isArray(parsed.memoryRecords) ? parsed.memoryRecords : [],
      suppressedMemories: Array.isArray(parsed.suppressedMemories) ? parsed.suppressedMemories : [],
      activityLogs: Array.isArray(parsed.activityLogs) ? parsed.activityLogs : [],
    };
  } catch {
    return { ...EMPTY_DATA };
  }
}

function writeData(data: StoryRuntimeData): void {
  const storePath = getRuntimeStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function listCharacters(): Character[] {
  return readData().characters.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function getCharacter(id: string): Character | undefined {
  return readData().characters.find((character) => character.id === id);
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
  return readData().storylines.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function getActiveStorylineId(): string | undefined {
  return readData().activeStorylineId;
}

export function getActiveStoryline(): Storyline | undefined {
  const data = readData();
  return data.storylines.find((storyline) => storyline.id === data.activeStorylineId && storyline.status === 'active');
}

export function getActiveStorylineForProfile(hermesProfileId: string): Storyline | undefined {
  const profileId = hermesProfileId.trim();
  if (!profileId) {
    return undefined;
  }

  return readData().storylines.find((storyline) => storyline.hermesProfileId === profileId && storyline.status === 'active');
}

export function getStoryline(id: string): Storyline | undefined {
  return readData().storylines.find((storyline) => storyline.id === id);
}

function assertUniqueStorylineProfile(data: StoryRuntimeData, hermesProfileId: string, currentStorylineId?: string): void {
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
  return readData()
    .runtimeSessions
    .filter((session) => session.storylineId === storylineId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
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
  return readData().memoryRecords.filter((memory) => {
    if (memory.status !== 'active') {
      return false;
    }
    if (memory.scope === 'character') {
      return memory.characterId === characterId;
    }
    if (memory.scope === 'user') {
      return !memory.storylineId || memory.storylineId === storylineId;
    }
    return memory.storylineId === storylineId;
  });
}

export function listAllMemoryRecords(storylineId: string): MemoryRecord[] {
  return readData()
    .memoryRecords
    .filter((memory) => memory.storylineId === storylineId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
    lastAccessedAt: input.lastAccessedAt,
    accessCount: input.accessCount,
    embeddingRef: input.embeddingRef,
    embeddingModel: input.embeddingModel,
    embeddingText: input.embeddingText,
    embeddingUpdatedAt: input.embeddingUpdatedAt,
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
    lastAccessedAt: input.lastAccessedAt ?? current.lastAccessedAt,
    accessCount: input.accessCount ?? current.accessCount,
    embeddingRef: input.embeddingRef ?? current.embeddingRef,
    embeddingModel: input.embeddingModel ?? current.embeddingModel,
    embeddingText: input.embeddingText ?? current.embeddingText,
    embeddingUpdatedAt: input.embeddingUpdatedAt ?? current.embeddingUpdatedAt,
    updatedAt: nowIso(),
  };
  data.memoryRecords[index] = updated;
  writeData(data);
  return updated;
}

export function listSuppressedMemories(storylineId: string, characterId: string): SuppressedMemory[] {
  return readData().suppressedMemories.filter((memory) => {
    if (memory.status !== 'active') {
      return false;
    }
    return memory.storylineId === storylineId || memory.characterId === characterId;
  });
}

export function listAllSuppressedMemories(storylineId: string): SuppressedMemory[] {
  return readData()
    .suppressedMemories
    .filter((memory) => memory.storylineId === storylineId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
  return readData()
    .activityLogs
    .filter((entry) => entry.storylineId === storylineId && entry.status === 'active')
    .sort((left, right) => right.happenedAt.localeCompare(left.happenedAt))
    .slice(0, 20);
}

export function listAllActivityLogs(storylineId: string): ActivityLog[] {
  return readData()
    .activityLogs
    .filter((entry) => entry.storylineId === storylineId)
    .sort((left, right) => right.happenedAt.localeCompare(left.happenedAt));
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
  const activity: ActivityLog = {
    id: createId('activity'),
    storylineId,
    happenedAt: input.happenedAt ?? now,
    timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    summary,
    tags: input.tags ?? [],
    status: 'active',
    sourceMessageIds: input.sourceMessageIds,
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
  const updated: ActivityLog = {
    ...current,
    happenedAt: input.happenedAt ?? current.happenedAt,
    timezone: input.timezone ?? current.timezone,
    summary: input.summary?.trim() || current.summary,
    tags: input.tags ?? current.tags,
    status: input.status ?? current.status,
    sourceMessageIds: input.sourceMessageIds ?? current.sourceMessageIds,
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
  const storePath = getRuntimeStorePath();
  if (fs.existsSync(storePath)) {
    fs.unlinkSync(storePath);
  }
}
