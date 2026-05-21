import type {
  ChatImageAttachment,
  ChatMode,
  ChatResponse,
  ChatStreamCompleteEvent,
  ChatStreamStartEvent,
} from './chat.js';
import type { ChatMessage } from './session.js';

export type StorylineStatus = 'active' | 'archived';
export type RuntimeSessionReason = 'storyline_start' | 'continue' | 'context_rollover' | 'debug';
export type MemoryScope = 'character' | 'user' | 'story' | 'activity';
export type MemorySource = 'manual' | 'auto_extract' | 'conversation' | 'summary';
export type RuntimeRecordStatus = 'active' | 'hidden' | 'deleted';
export type SuppressedMemoryStatus = 'active' | 'deleted';
export type ContinuityMode = 'live' | 'same_day' | 'new_day' | 'long_gap';

export interface Character {
  id: string;
  name: string;
  templateProfileId: string;
  avatar?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Storyline {
  id: string;
  characterId: string;
  hermesProfileId: string;
  title: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  lastInteractionAt?: string;
  status: StorylineStatus;
}

export interface RuntimeSession {
  id: string;
  storylineId: string;
  hermesProfileId: string;
  hermesSessionId?: string;
  previousResponseId?: string;
  createdAt: string;
  updatedAt: string;
  reason: RuntimeSessionReason;
}

export interface MemoryRecord {
  id: string;
  storylineId?: string;
  characterId?: string;
  content: string;
  scope: MemoryScope;
  source: MemorySource;
  status: RuntimeRecordStatus;
  importance?: number;
  confidence?: number;
  createdAt: string;
  updatedAt: string;
  sourceMessageIds?: string[];
}

export interface SuppressedMemory {
  id: string;
  storylineId?: string;
  characterId?: string;
  pattern: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  status: SuppressedMemoryStatus;
}

export interface ActivityLog {
  id: string;
  storylineId: string;
  happenedAt: string;
  timezone: string;
  summary: string;
  tags: string[];
  status: RuntimeRecordStatus;
  sourceMessageIds?: string[];
}

export interface TimeContext {
  now: string;
  timezone: string;
  today: [string, string];
  yesterday: [string, string];
  lastNight: [string, string];
  tonight: [string, string];
  elapsedSinceLastInteraction?: string;
}

export interface ContextPack {
  storylineId: string;
  characterId: string;
  hermesProfileId: string;
  time: TimeContext;
  continuityMode: ContinuityMode;
  recentMessages: ChatMessage[];
  memories: MemoryRecord[];
  suppressedMemories: SuppressedMemory[];
  activityLogs: ActivityLog[];
  systemInstructions: string[];
}

export interface CharactersResponse {
  characters: Character[];
}

export interface CreateCharacterRequest {
  name: string;
  templateProfileId: string;
  avatar?: string;
  description?: string;
}

export interface UpdateCharacterRequest {
  name?: string;
  templateProfileId?: string;
  avatar?: string;
  description?: string;
}

export interface StorylinesResponse {
  activeStorylineId?: string;
  storylines: Storyline[];
}

export interface ActiveStorylineResponse {
  activeStoryline?: Storyline;
}

export interface CreateStorylineRequest {
  characterId: string;
  hermesProfileId: string;
  title: string;
  description?: string;
}

export interface UpdateStorylineRequest {
  title?: string;
  description?: string;
  status?: StorylineStatus;
}

export interface StorylineChatRequest {
  storylineId: string;
  input: string;
  attachments?: ChatImageAttachment[];
  mode?: ChatMode;
}

export interface StorylineChatResponse extends ChatResponse {
  storylineId: string;
  runtimeSessionId: string;
}

export interface StorylineChatStreamStartEvent extends ChatStreamStartEvent {
  storylineId: string;
  runtimeSessionId: string;
}

export interface StorylineChatStreamCompleteEvent extends ChatStreamCompleteEvent {
  storylineId: string;
  runtimeSessionId: string;
}

export interface ContextPreviewRequest {
  storylineId: string;
  input?: string;
}

export interface ContextPreviewResponse {
  contextPack: ContextPack;
  renderedInstructions: string;
}

export interface MemoriesResponse {
  memories: MemoryRecord[];
}

export interface CreateMemoryRequest {
  content: string;
  scope?: MemoryScope;
  source?: MemorySource;
  importance?: number;
  confidence?: number;
  sourceMessageIds?: string[];
}

export interface UpdateMemoryRequest {
  content?: string;
  scope?: MemoryScope;
  source?: MemorySource;
  status?: RuntimeRecordStatus;
  importance?: number;
  confidence?: number;
  sourceMessageIds?: string[];
}

export interface SuppressedMemoriesResponse {
  suppressedMemories: SuppressedMemory[];
}

export interface CreateSuppressedMemoryRequest {
  pattern: string;
  reason?: string;
}

export interface ActivityLogsResponse {
  activityLogs: ActivityLog[];
}

export interface CreateActivityLogRequest {
  happenedAt?: string;
  timezone?: string;
  summary: string;
  tags?: string[];
  sourceMessageIds?: string[];
}

export interface UpdateActivityLogRequest {
  happenedAt?: string;
  timezone?: string;
  summary?: string;
  tags?: string[];
  status?: RuntimeRecordStatus;
  sourceMessageIds?: string[];
}
