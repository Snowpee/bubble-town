import fs from 'node:fs';
import path from 'node:path';
import type {
  ActivityLog,
  Character,
  MemoryRecord,
  PendingSemanticFrame,
  RuntimeSession,
  Storyline,
  SuppressedMemory,
} from '@bubble-town/shared';
import { getHermesRoot } from '../adapters/hermes/hermes-paths.js';

export interface StoryRuntimeSnapshot {
  version: 1;
  activeStorylineId?: string;
  characters: Character[];
  storylines: Storyline[];
  runtimeSessions: RuntimeSession[];
  memoryRecords: MemoryRecord[];
  suppressedMemories: SuppressedMemory[];
  activityLogs: ActivityLog[];
  pendingSemanticFrames: PendingSemanticFrame[];
}

export const EMPTY_STORY_RUNTIME_SNAPSHOT: StoryRuntimeSnapshot = {
  version: 1,
  characters: [],
  storylines: [],
  runtimeSessions: [],
  memoryRecords: [],
  suppressedMemories: [],
  activityLogs: [],
  pendingSemanticFrames: [],
};

export interface StoryRuntimePersistenceAdapter {
  read(): string | undefined;
  write(content: string): void;
}

export interface StoryRuntimeRepository {
  load(): StoryRuntimeSnapshot;
  save(snapshot: StoryRuntimeSnapshot): void;
}

export function getStoryRuntimeStorePath(): string {
  return path.join(getHermesRoot(), 'bubble-town-runtime.json');
}

export class JsonFileStoryRuntimeAdapter implements StoryRuntimePersistenceAdapter {
  read(): string | undefined {
    const storePath = getStoryRuntimeStorePath();
    if (!fs.existsSync(storePath)) {
      return undefined;
    }
    return fs.readFileSync(storePath, 'utf8');
  }

  write(content: string): void {
    const storePath = getStoryRuntimeStorePath();
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, content, 'utf8');
  }
}

export function normalizeStoryRuntimeSnapshot(parsed?: Partial<StoryRuntimeSnapshot>): StoryRuntimeSnapshot {
  return {
    version: 1,
    activeStorylineId: parsed?.activeStorylineId,
    characters: Array.isArray(parsed?.characters) ? parsed.characters : [],
    storylines: Array.isArray(parsed?.storylines) ? parsed.storylines : [],
    runtimeSessions: Array.isArray(parsed?.runtimeSessions) ? parsed.runtimeSessions : [],
    memoryRecords: Array.isArray(parsed?.memoryRecords) ? parsed.memoryRecords : [],
    suppressedMemories: Array.isArray(parsed?.suppressedMemories) ? parsed.suppressedMemories : [],
    activityLogs: Array.isArray(parsed?.activityLogs) ? parsed.activityLogs : [],
    pendingSemanticFrames: Array.isArray(parsed?.pendingSemanticFrames) ? parsed.pendingSemanticFrames : [],
  };
}

export function createStoryRuntimeRepository(
  adapter: StoryRuntimePersistenceAdapter = new JsonFileStoryRuntimeAdapter(),
): StoryRuntimeRepository {
  return {
    load() {
      const content = adapter.read();
      if (!content) {
        return { ...EMPTY_STORY_RUNTIME_SNAPSHOT };
      }

      try {
        return normalizeStoryRuntimeSnapshot(JSON.parse(content) as Partial<StoryRuntimeSnapshot>);
      } catch {
        return { ...EMPTY_STORY_RUNTIME_SNAPSHOT };
      }
    },
    save(snapshot) {
      adapter.write(`${JSON.stringify(normalizeStoryRuntimeSnapshot(snapshot), null, 2)}\n`);
    },
  };
}

let defaultRepository: StoryRuntimeRepository | undefined;

export function getStoryRuntimeRepository(): StoryRuntimeRepository {
  defaultRepository ??= createStoryRuntimeRepository();
  return defaultRepository;
}

function isExpiredMemory(memory: MemoryRecord, now = Date.now()): boolean {
  if (!memory.expiresAt) {
    return false;
  }
  const expiresAt = new Date(memory.expiresAt).getTime();
  return !Number.isNaN(expiresAt) && expiresAt <= now;
}

export function selectCharacters(snapshot: StoryRuntimeSnapshot): Character[] {
  return [...snapshot.characters].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function selectCharacterById(snapshot: StoryRuntimeSnapshot, id: string): Character | undefined {
  return snapshot.characters.find((character) => character.id === id);
}

export function selectStorylines(snapshot: StoryRuntimeSnapshot): Storyline[] {
  return [...snapshot.storylines].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function selectActiveStorylineId(snapshot: StoryRuntimeSnapshot): string | undefined {
  return snapshot.activeStorylineId;
}

export function selectActiveStoryline(snapshot: StoryRuntimeSnapshot): Storyline | undefined {
  return snapshot.storylines.find((storyline) => storyline.id === snapshot.activeStorylineId && storyline.status === 'active');
}

export function selectActiveStorylineForProfile(
  snapshot: StoryRuntimeSnapshot,
  hermesProfileId: string,
): Storyline | undefined {
  const profileId = hermesProfileId.trim();
  if (!profileId) {
    return undefined;
  }

  return snapshot.storylines.find((storyline) => storyline.hermesProfileId === profileId && storyline.status === 'active');
}

export function selectStorylineById(snapshot: StoryRuntimeSnapshot, id: string): Storyline | undefined {
  return snapshot.storylines.find((storyline) => storyline.id === id);
}

export function selectRuntimeSessionForStoryline(
  snapshot: StoryRuntimeSnapshot,
  storylineId: string,
): RuntimeSession | undefined {
  return snapshot.runtimeSessions
    .filter((session) => session.storylineId === storylineId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function selectMemoryRecords(
  snapshot: StoryRuntimeSnapshot,
  storylineId: string,
  characterId: string,
): MemoryRecord[] {
  return snapshot.memoryRecords.filter((memory) => {
    if (memory.status !== 'active') {
      return false;
    }
    if (memory.supersededBy || isExpiredMemory(memory)) {
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

export function selectAllMemoryRecords(snapshot: StoryRuntimeSnapshot, storylineId: string): MemoryRecord[] {
  return snapshot.memoryRecords
    .filter((memory) => memory.storylineId === storylineId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function selectMemoryRecordById(snapshot: StoryRuntimeSnapshot, id: string): MemoryRecord | undefined {
  return snapshot.memoryRecords.find((memory) => memory.id === id);
}

export function selectSuppressedMemories(
  snapshot: StoryRuntimeSnapshot,
  storylineId: string,
  characterId: string,
): SuppressedMemory[] {
  return snapshot.suppressedMemories.filter((memory) => {
    if (memory.status !== 'active') {
      return false;
    }
    return memory.storylineId === storylineId || memory.characterId === characterId;
  });
}

export function selectAllSuppressedMemories(snapshot: StoryRuntimeSnapshot, storylineId: string): SuppressedMemory[] {
  return snapshot.suppressedMemories
    .filter((memory) => memory.storylineId === storylineId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function selectActivityLogs(snapshot: StoryRuntimeSnapshot, storylineId: string): ActivityLog[] {
  return snapshot.activityLogs
    .filter((entry) => entry.storylineId === storylineId && entry.status === 'active')
    .sort((left, right) => right.happenedAt.localeCompare(left.happenedAt))
    .slice(0, 20);
}

export function selectAllActivityLogs(snapshot: StoryRuntimeSnapshot, storylineId: string): ActivityLog[] {
  return snapshot.activityLogs
    .filter((entry) => entry.storylineId === storylineId)
    .sort((left, right) => right.happenedAt.localeCompare(left.happenedAt));
}

export function selectPendingSemanticFrames(snapshot: StoryRuntimeSnapshot, storylineId: string): PendingSemanticFrame[] {
  return snapshot.pendingSemanticFrames
    .filter((frame) => frame.storylineId === storylineId && frame.status === 'pending')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
