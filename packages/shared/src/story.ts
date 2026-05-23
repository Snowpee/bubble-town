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
export type MemoryKind = 'identity' | 'preference' | 'boundary' | 'commitment' | 'relationship' | 'story_fact' | 'emotion_state' | 'unclassified';
export type MemoryLifespan = 'short_term' | 'long_term' | 'episodic' | 'temporary';
export type MemoryEmbeddingTargetType = 'memory' | 'activity';
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
  kind?: MemoryKind;
  lifespan?: MemoryLifespan;
  reason?: string;
  importance?: number;
  confidence?: number;
  createdAt: string;
  updatedAt: string;
  sourceMessageIds?: string[];
  supersedes?: string[];
  supersededBy?: string;
  lastAccessedAt?: string;
  accessCount?: number;
  embeddingRef?: string;
  embeddingModel?: string;
  embeddingText?: string;
  embeddingUpdatedAt?: string;
}

export interface MemoryEmbedding {
  id: string;
  storylineId: string;
  targetType: MemoryEmbeddingTargetType;
  targetId: string;
  embeddingModel: string;
  embeddingText: string;
  vector: number[];
  dimension: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryCandidate {
  kind: MemoryKind;
  content: string;
  scope: MemoryScope;
  importance: number;
  confidence: number;
  lifespan: MemoryLifespan;
  source: MemorySource;
  reason: string;
  shouldPersist: boolean;
  sourceMessageIds?: string[];
}

export interface MemoryRetrievalMetadata {
  memoryId: string;
  score: number;
  relevance: number;
  importance: number;
  confidence: number;
  semantic?: number;
  recency: number;
  matchedSuppression?: boolean;
  reasons: string[];
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
  embeddingRef?: string;
  embeddingModel?: string;
  embeddingText?: string;
  embeddingUpdatedAt?: string;
}

export interface TimeContext {
  now: string;
  timezone: string;
  localNow: string;
  localDate: string;
  localTime: string;
  today: [string, string];
  yesterday: [string, string];
  dayBeforeYesterday: [string, string];
  lastNight: [string, string];
  tonight: [string, string];
  elapsedSinceLastInteraction?: string;
}

export type RelativeTimeReference = 'today' | 'yesterday' | 'day_before_yesterday' | 'tonight' | 'last_night' | 'previous';

export interface RelativeTimeSearchResult {
  reference: RelativeTimeReference;
  label: string;
  range?: [string, string];
  query: string;
  activityLogs: ActivityLog[];
  memories: MemoryRecord[];
  messages: ChatMessage[];
  hit: boolean;
}

export interface ContinuityHint {
  kind: 'live' | 'same_day' | 'new_day' | 'long_gap' | 'relative_time_hit' | 'relative_time_miss';
  message: string;
}

export interface SessionAnchors {
  messageCount: number;
  firstUserMessage?: ChatMessage;
  firstAssistantMessage?: ChatMessage;
  latestUserMessage?: ChatMessage;
  latestAssistantMessage?: ChatMessage;
}

export interface ContextPack {
  storylineId: string;
  characterId: string;
  hermesProfileId: string;
  time: TimeContext;
  continuityMode: ContinuityMode;
  sessionAnchors: SessionAnchors;
  recentMessages: ChatMessage[];
  memories: MemoryRecord[];
  memoryRetrievals?: MemoryRetrievalMetadata[];
  suppressedMemories: SuppressedMemory[];
  suppressionDisclosureAllowed?: boolean;
  activityLogs: ActivityLog[];
  continuityHints: ContinuityHint[];
  relativeTimeResults: RelativeTimeSearchResult[];
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

export interface RelativeTimeSearchRequest {
  input: string;
}

export interface RelativeTimeSearchResponse {
  results: RelativeTimeSearchResult[];
}

export interface ProfileContinuityValidationResponse {
  profileId: string;
  configPath: string;
  exists: boolean;
  sessionResetMode?: string;
  sessionResetModeValid: boolean;
  warnings: string[];
  recommendations: string[];
}

export interface MemoriesResponse {
  memories: MemoryRecord[];
}

export interface CreateMemoryRequest {
  content: string;
  scope?: MemoryScope;
  source?: MemorySource;
  kind?: MemoryKind;
  lifespan?: MemoryLifespan;
  reason?: string;
  importance?: number;
  confidence?: number;
  sourceMessageIds?: string[];
  supersedes?: string[];
  supersededBy?: string;
  lastAccessedAt?: string;
  accessCount?: number;
  embeddingRef?: string;
  embeddingModel?: string;
  embeddingText?: string;
  embeddingUpdatedAt?: string;
}

export interface UpdateMemoryRequest {
  content?: string;
  scope?: MemoryScope;
  source?: MemorySource;
  status?: RuntimeRecordStatus;
  kind?: MemoryKind;
  lifespan?: MemoryLifespan;
  reason?: string;
  importance?: number;
  confidence?: number;
  sourceMessageIds?: string[];
  supersedes?: string[];
  supersededBy?: string;
  lastAccessedAt?: string;
  accessCount?: number;
  embeddingRef?: string;
  embeddingModel?: string;
  embeddingText?: string;
  embeddingUpdatedAt?: string;
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
  embeddingRef?: string;
  embeddingModel?: string;
  embeddingText?: string;
  embeddingUpdatedAt?: string;
}

export interface UpdateActivityLogRequest {
  happenedAt?: string;
  timezone?: string;
  summary?: string;
  tags?: string[];
  status?: RuntimeRecordStatus;
  sourceMessageIds?: string[];
  embeddingRef?: string;
  embeddingModel?: string;
  embeddingText?: string;
  embeddingUpdatedAt?: string;
}
