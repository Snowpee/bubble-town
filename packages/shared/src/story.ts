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
export type MemoryKind =
  | 'identity'
  | 'preference'
  | 'boundary'
  | 'commitment'
  | 'relationship'
  | 'story_fact'
  | 'emotion_state'
  | 'world_object_state'
  | 'world_event'
  | 'unclassified';
export type MemoryLifespan = 'short_term' | 'long_term' | 'episodic' | 'temporary';
export type MemoryEmbeddingTargetType = 'memory' | 'activity';
export type RuntimeRecordStatus = 'active' | 'hidden' | 'deleted';
export type SuppressedMemoryStatus = 'active' | 'deleted';
export type ContinuityMode = 'live' | 'same_day' | 'new_day' | 'long_gap';
export type WorldStateKind = 'status' | 'location';
export type WorldStateActionType = 'place' | 'move' | 'open' | 'close' | 'break' | 'repair' | 'unknown';
export type SemanticEventType =
  | 'preference'
  | 'commitment'
  | 'relationship_change'
  | 'world_state_change'
  | 'story_event'
  | 'correction'
  | 'unknown';
export type SemanticEntityType = 'person' | 'object' | 'place' | 'concept' | 'unknown';
export type SemanticEntityRole = 'subject' | 'object' | 'location' | 'target' | 'context';
export type SemanticTemporalScope = 'instantaneous' | 'session' | 'stable' | 'recurring' | 'historical' | 'unknown';
export type SemanticStability = 'transient' | 'stable' | 'uncertain' | 'unknown';

export interface SemanticEntity {
  id?: string;
  label: string;
  type: SemanticEntityType;
  role: SemanticEntityRole;
  confidence?: number;
}

export interface SemanticStateChange {
  targetEntityRef?: string;
  property: string;
  from?: string;
  to?: string;
}

export interface SemanticEvent {
  id: string;
  eventType: SemanticEventType;
  entities?: SemanticEntity[];
  stateChange?: SemanticStateChange;
  temporalScope: SemanticTemporalScope;
  stability: SemanticStability;
  stabilityReason?: string;
  evidenceSpan: string;
  confidence: number;
  sourceMessageIds?: string[];
  happenedAt?: string;
}

export interface WorldStateMetadata {
  sceneId: string;
  objectId: string;
  objectLabel: string;
  stateKind: WorldStateKind;
  state: string;
  locationText?: string;
  version: number;
}

export interface SceneProjectionItem {
  memoryId: string;
  objectId: string;
  objectLabel: string;
  stateKind: WorldStateKind;
  state: string;
  locationText?: string;
  content: string;
}

export interface SceneProjection {
  sceneId: string;
  summary: string;
  items: SceneProjectionItem[];
}

export interface WorldStateUpdateCandidate {
  sceneId: string;
  objectLabel: string;
  stateKind: WorldStateKind;
  state: string;
  locationText?: string;
  actionType: WorldStateActionType;
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
}

export interface WorldStateDebugApplyResult {
  outcome: 'created' | 'existing' | 'error';
  candidate: WorldStateUpdateCandidate;
  createdMemoryId?: string;
  existingMemoryId?: string;
  supersededMemoryIds?: string[];
  error?: string;
}

export type WorldStateProcessingStatus = 'scheduled' | 'completed';
export type WorldStateProcessingPath = 'skip' | 'direct_apply' | 'uncertain_fallback_extractor';
export type WorldStateSideChannelDecision = 'skip' | 'direct_apply' | 'uncertain';
export type WorldStateExecutionMode = 'legacy_inline' | 'auxiliary_async';
export type WorldStateDebugPhase =
  | 'scheduled'
  | 'gate_started'
  | 'gate_completed'
  | 'extractor_started'
  | 'extractor_completed'
  | 'apply_completed'
  | 'completed'
  | 'failed';

export interface WorldStateSideChannelTrace {
  decision: WorldStateSideChannelDecision;
  reason?: string;
  confidence: number;
  candidates: WorldStateUpdateCandidate[];
}

export interface WorldStateDebugEvent {
  phase: WorldStateDebugPhase;
  at: string;
  detail?: string;
}

export interface WorldStateDebugTrace {
  storylineId: string;
  sceneId: string;
  userInput: string;
  assistantOutput: string;
  sourceMessageIds?: string[];
  recentActivityLogs?: Pick<ActivityLog, 'id' | 'happenedAt' | 'summary'>[];
  processingStatus: WorldStateProcessingStatus;
  processingPath?: WorldStateProcessingPath;
  executionMode?: WorldStateExecutionMode;
  auxiliaryLlm?: {
    enabledForTurn: boolean;
    gateViaInvoker: boolean;
    extractorViaInvoker: boolean;
    taskType: 'world-state';
  };
  rejectDecision?: {
    rejected: boolean;
    reason?: string;
  };
  gatingRequest?: {
    instructions: string;
    prompt: string;
  };
  gatingResponse?: WorldStateSideChannelTrace;
  llmRequest?: {
    instructions: string;
    prompt: string;
  };
  llmResponse?: {
    candidates: WorldStateUpdateCandidate[];
  };
  applyResults: WorldStateDebugApplyResult[];
  updated: boolean;
  skippedReason?: string;
  error?: string;
  events?: WorldStateDebugEvent[];
  lastUpdatedAt?: string;
  sceneProjectionBefore?: SceneProjection;
  sceneProjectionAfter?: SceneProjection;
}

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
  currentSceneId?: string;
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
  sourceActivityIds?: string[];
  sourceHappenedAtStart?: string;
  sourceHappenedAtEnd?: string;
  semanticEvents?: SemanticEvent[];
  semanticSchemaVersion?: number;
  semanticSource?: 'structured' | 'legacy';
  lastAccessedAt?: string;
  accessCount?: number;
  expiresAt?: string;
  embeddingRef?: string;
  embeddingModel?: string;
  embeddingText?: string;
  embeddingUpdatedAt?: string;
  worldState?: WorldStateMetadata;
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
  supersedes?: string[];
  worldState?: WorldStateMetadata;
  sourceActivityIds?: string[];
  sourceHappenedAtStart?: string;
  sourceHappenedAtEnd?: string;
  semanticEvents?: SemanticEvent[];
  semanticSchemaVersion?: number;
  semanticSource?: 'structured' | 'legacy';
  confirmationRequired?: boolean;
  confirmationPrompt?: string;
}

export type ProductMemoryWriteOutcome =
  | 'created'
  | 'existing'
  | 'pending_confirmation'
  | 'skipped'
  | 'rejected'
  | 'error';

export interface ProductMemoryWriteResult {
  outcome: ProductMemoryWriteOutcome;
  candidate: MemoryCandidate;
  memoryId?: string;
  existingMemoryId?: string;
  pendingFrameId?: string;
  reason?: string;
  error?: string;
}

export type RuntimeDiagnosticsStatus = 'processing' | 'updated' | 'failed' | 'skipped' | 'uncertain';

export interface ProductMemoryDiagnosticsEntry {
  outcome: ProductMemoryWriteOutcome;
  kind: MemoryKind;
  content: string;
  memoryId?: string;
  existingMemoryId?: string;
  pendingFrameId?: string;
  reason?: string;
  error?: string;
}

export interface ProductMemoryDiagnosticsSnapshot {
  storylineId: string;
  userInput: string;
  assistantOutput: string;
  writeResults: ProductMemoryDiagnosticsEntry[];
  pendingSemanticFrames: PendingSemanticFrame[];
  resolvedPendingSemanticFrame?: PendingSemanticFrame;
  lastUpdatedAt: string;
}

export type PendingSemanticFrameKind =
  | 'preference_confirm'
  | 'commitment_confirm'
  | 'relationship_confirm';

export type PendingSemanticFrameStatus = 'pending' | 'resolved' | 'cancelled';

export interface PendingSemanticFrame {
  id: string;
  storylineId: string;
  kind: PendingSemanticFrameKind;
  candidate: MemoryCandidate;
  prompt: string;
  status: PendingSemanticFrameStatus;
  createdAt: string;
  updatedAt: string;
  sourceMessageIds?: string[];
  resolvedByMessageIds?: string[];
  lastUserReply?: string;
}

export interface PendingSemanticFramesResponse {
  pendingSemanticFrames: PendingSemanticFrame[];
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
  semanticEvents?: SemanticEvent[];
  semanticSchemaVersion?: number;
  semanticSource?: 'structured' | 'legacy';
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

export interface ConversationPacing {
  elapsedMs?: number;
  topicShiftCommentAllowed: boolean;
  topicShiftCommentWindowMinutes: number;
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
  conversationPacing: ConversationPacing;
  sessionAnchors: SessionAnchors;
  recentMessages: ChatMessage[];
  memories: MemoryRecord[];
  memoryRetrievals?: MemoryRetrievalMetadata[];
  suppressedMemories: SuppressedMemory[];
  suppressionDisclosureAllowed?: boolean;
  activityLogs: ActivityLog[];
  continuityHints: ContinuityHint[];
  relativeTimeResults: RelativeTimeSearchResult[];
  pendingSemanticFrames?: PendingSemanticFrame[];
  sceneProjection?: SceneProjection;
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
  currentSceneId?: string;
}

export interface UpdateStorylineRequest {
  title?: string;
  description?: string;
  currentSceneId?: string;
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
  worldStateDebug?: WorldStateDebugTrace;
}

export interface StorylineChatStreamStartEvent extends ChatStreamStartEvent {
  storylineId: string;
  runtimeSessionId: string;
}

export interface StorylineChatStreamCompleteEvent extends ChatStreamCompleteEvent {
  storylineId: string;
  runtimeSessionId: string;
  worldStateDebug?: WorldStateDebugTrace;
}

export interface ContextPreviewRequest {
  storylineId: string;
  input?: string;
}

export interface ContextPreviewResponse {
  contextPack: ContextPack;
  renderedInstructions: string;
  worldStateDebug?: WorldStateDebugTrace;
}

export interface WorldStateDebugSnapshotResponse {
  storylineId: string;
  sceneProjection?: SceneProjection;
  worldStateDebug?: WorldStateDebugTrace;
}

export interface RuntimeDiagnosticsSnapshotResponse {
  storylineId: string;
  status: RuntimeDiagnosticsStatus;
  statusDetail?: string;
  canRetry: boolean;
  retryDisabledReason?: string;
  sceneProjection?: SceneProjection;
  worldStateDebug?: WorldStateDebugTrace;
  productMemory?: ProductMemoryDiagnosticsSnapshot;
  lastUpdatedAt?: string;
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

export type BatchMemoryAction = 'hide' | 'restore' | 'delete';

export interface BatchMemoryRequest {
  memoryIds: string[];
  action: BatchMemoryAction;
}

export interface BatchMemoryResponse {
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
  sourceActivityIds?: string[];
  sourceHappenedAtStart?: string;
  sourceHappenedAtEnd?: string;
  semanticEvents?: SemanticEvent[];
  semanticSchemaVersion?: number;
  semanticSource?: 'structured' | 'legacy';
  lastAccessedAt?: string;
  accessCount?: number;
  expiresAt?: string;
  embeddingRef?: string;
  embeddingModel?: string;
  embeddingText?: string;
  embeddingUpdatedAt?: string;
  worldState?: WorldStateMetadata;
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
  sourceActivityIds?: string[];
  sourceHappenedAtStart?: string;
  sourceHappenedAtEnd?: string;
  semanticEvents?: SemanticEvent[];
  semanticSchemaVersion?: number;
  semanticSource?: 'structured' | 'legacy';
  lastAccessedAt?: string;
  accessCount?: number;
  expiresAt?: string;
  embeddingRef?: string;
  embeddingModel?: string;
  embeddingText?: string;
  embeddingUpdatedAt?: string;
  worldState?: WorldStateMetadata;
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

export interface MemoryConsolidationResult {
  summaryMemory?: MemoryRecord;
  duplicateKeepers: MemoryRecord[];
  hiddenDuplicates: MemoryRecord[];
  consolidatedActivityLogs: ActivityLog[];
}

export interface CorrectMemoryRequest {
  content: string;
  reason?: string;
}

export interface CorrectMemoryResponse {
  replacement: MemoryRecord;
  superseded: MemoryRecord;
}

export interface CreateActivityLogRequest {
  happenedAt?: string;
  timezone?: string;
  summary: string;
  tags?: string[];
  sourceMessageIds?: string[];
  semanticEvents?: SemanticEvent[];
  semanticSchemaVersion?: number;
  semanticSource?: 'structured' | 'legacy';
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
  semanticEvents?: SemanticEvent[];
  semanticSchemaVersion?: number;
  semanticSource?: 'structured' | 'legacy';
  embeddingRef?: string;
  embeddingModel?: string;
  embeddingText?: string;
  embeddingUpdatedAt?: string;
}
