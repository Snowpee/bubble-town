import crypto from 'node:crypto';
import type {
  MemoryCandidate,
  PendingSemanticFrame,
  ProductMemoryDiagnosticsEntry,
  ProductMemoryDiagnosticsSnapshot,
  ProductMemoryWriteResult,
  RuntimeDiagnosticsSnapshotResponse,
  RuntimeDiagnosticsStatus,
  SemanticEvent,
  Storyline,
  WorldStateDebugTrace,
  WorldStateUpdateCandidate,
} from '@bubble-town/shared';
import {
  createActivityLog,
  createMemoryRecord,
  createSuppressedMemory,
  listAllActivityLogs,
  listAllMemoryRecords,
  listPendingSemanticFrames,
  listAllSuppressedMemories,
  updateActivityLog,
} from '../../store/story-runtime-store.js';
import { resolveAuxiliaryLlmRuntime } from '../../store/auxiliary-llm-store.js';
import { extractLegacyRuleBasedMemoryCandidates } from '../memory/memory-candidates.js';
import { AUTO_CONSOLIDATION_ELIGIBLE_TAG, CONSOLIDATED_TAG } from '../memory/memory-governance.js';
import {
  createStoryFactCandidateFromActivityLogs,
  persistMemoryCandidate,
  resolvePendingSemanticFrameReply,
} from '../memory/memory-write-service.js';
import type { WorldStateCandidateExtractor, WorldStateExtractorExecutionOptions } from '../world-state/world-state-extractor.js';
import { createStructuredWorldStateExtractor } from '../world-state/world-state-extractor.js';
import type { WorldStateSideChannelGate } from '../world-state/world-state-side-channel.js';
import { createStructuredWorldStateSideChannelGate } from '../world-state/world-state-side-channel.js';
import { applyWorldStateUpdateCandidate, buildSceneProjection, getStorylineSceneId } from '../world-state/world-state.js';

const pendingWorldStateJobs = new Map<string, Promise<void>>();
const latestWorldStateDebugByStoryline = new Map<string, WorldStateDebugTrace>();
const latestProductMemoryDiagnosticsByStoryline = new Map<string, ProductMemoryDiagnosticsSnapshot>();
const latestRetryContextByStoryline = new Map<string, {
  userInput: string;
  assistantOutput: string;
  sourceMessageIds?: string[];
}>();

function cloneWorldStateDebugTrace(trace: WorldStateDebugTrace): WorldStateDebugTrace {
  return JSON.parse(JSON.stringify(trace)) as WorldStateDebugTrace;
}

function cloneProductMemoryDiagnosticsSnapshot(
  snapshot: ProductMemoryDiagnosticsSnapshot,
): ProductMemoryDiagnosticsSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ProductMemoryDiagnosticsSnapshot;
}

function storeLatestWorldStateDebug(trace: WorldStateDebugTrace) {
  latestWorldStateDebugByStoryline.set(trace.storylineId, cloneWorldStateDebugTrace(trace));
}

function storeLatestProductMemoryDiagnostics(snapshot: ProductMemoryDiagnosticsSnapshot) {
  latestProductMemoryDiagnosticsByStoryline.set(
    snapshot.storylineId,
    cloneProductMemoryDiagnosticsSnapshot(snapshot),
  );
}

function mapWriteResultEntry(result: ProductMemoryWriteResult): ProductMemoryDiagnosticsEntry {
  return {
    outcome: result.outcome,
    kind: result.candidate.kind,
    content: result.candidate.content,
    memoryId: result.memoryId,
    existingMemoryId: result.existingMemoryId,
    pendingFrameId: result.pendingFrameId,
    reason: result.reason,
    error: result.error,
  };
}

function getWorldStateDiagnosticsStatus(trace?: WorldStateDebugTrace): RuntimeDiagnosticsStatus | undefined {
  if (!trace) {
    return undefined;
  }
  if (trace.processingStatus === 'scheduled') {
    return 'processing';
  }
  if (trace.error || trace.applyResults.some((result) => result.outcome === 'error')) {
    return 'failed';
  }
  if (trace.updated) {
    return 'updated';
  }
  if (trace.processingPath === 'uncertain_fallback_extractor') {
    return 'uncertain';
  }
  return 'skipped';
}

function getProductMemoryDiagnosticsStatus(
  snapshot?: ProductMemoryDiagnosticsSnapshot,
): RuntimeDiagnosticsStatus | undefined {
  if (!snapshot) {
    return undefined;
  }
  if (snapshot.writeResults.some((result) => result.outcome === 'error')) {
    return 'failed';
  }
  if (snapshot.writeResults.some((result) => result.outcome === 'created')) {
    return 'updated';
  }
  if (
    snapshot.writeResults.some((result) => result.outcome === 'pending_confirmation')
    || snapshot.pendingSemanticFrames.length > 0
  ) {
    return 'uncertain';
  }
  return 'skipped';
}

function buildRuntimeDiagnosticsStatusDetail(input: {
  worldStateDebug?: WorldStateDebugTrace;
  productMemory?: ProductMemoryDiagnosticsSnapshot;
  status: RuntimeDiagnosticsStatus;
}): string | undefined {
  if (input.status === 'failed') {
    return input.worldStateDebug?.error
      ?? input.productMemory?.writeResults.find((result) => result.error)?.error
      ?? '最近一次后台派生执行失败。';
  }
  if (input.status === 'processing') {
    return input.worldStateDebug?.skippedReason ?? '最近一次后台派生仍在处理中。';
  }
  if (input.status === 'updated') {
    const createdCount = input.productMemory?.writeResults
      .filter((result) => result.outcome === 'created').length ?? 0;
    if (input.worldStateDebug?.updated && createdCount > 0) {
      return `最近一次派生已更新 world-state，并写入 ${createdCount} 条 product memory。`;
    }
    if (input.worldStateDebug?.updated) {
      return '最近一次派生已更新 world-state。';
    }
    if (createdCount > 0) {
      return `最近一次派生已写入 ${createdCount} 条 product memory。`;
    }
    return '最近一次后台派生已完成更新。';
  }
  if (input.status === 'uncertain') {
    return input.productMemory?.pendingSemanticFrames[0]?.prompt
      ?? input.worldStateDebug?.skippedReason
      ?? '最近一次派生需要确认或进入了 uncertain 路径。';
  }
  return input.worldStateDebug?.skippedReason
    ?? input.productMemory?.writeResults[0]?.reason
    ?? '最近一次后台派生未产生新的更新。';
}

function markWorldStateDebugEvent(
  trace: WorldStateDebugTrace,
  phase: NonNullable<WorldStateDebugTrace['events']>[number]['phase'],
  detail?: string,
) {
  trace.events ??= [];
  trace.lastUpdatedAt = new Date().toISOString();
  trace.events.push({
    phase,
    at: trace.lastUpdatedAt,
    ...(detail ? { detail } : {}),
  });
  storeLatestWorldStateDebug(trace);
}

function compact(value: string, maxLength = 140): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}...`;
}

export function summarizeSessionRollover(input: {
  previousHermesSessionId: string;
  messageCount: number;
  startedAt?: string;
  updatedAt?: string;
}): string {
  const range = input.startedAt && input.updatedAt
    ? `，时间范围 ${input.startedAt} 至 ${input.updatedAt}`
    : '';
  return `底层 Hermes session ${input.previousHermesSessionId} 已滚动归档，共 ${input.messageCount} 条消息${range}；后续连续性以 ActivityLog、MemoryRecord 和新的运行 session 维持。`;
}

function isLowInformation(input: string, output: string): boolean {
  const normalized = `${input} ${output}`.replace(/\s+/g, '').toLowerCase();
  if (normalized.length < 16) {
    return true;
  }
  return /^(hi|hello|你好|在吗|嗯|哦|好|ok|test|测试)+$/i.test(normalized);
}

function hasDuplicateMemory(storylineId: string, content: string): boolean {
  return listAllMemoryRecords(storylineId).some((memory) => memory.status === 'active' && memory.content === content);
}

function hasDuplicateSuppression(storylineId: string, pattern: string): boolean {
  return listAllSuppressedMemories(storylineId).some((memory) => memory.status === 'active' && memory.pattern === pattern);
}

function extractSuppression(input: string): { pattern: string; reason: string } | undefined {
  if (!/不要.*提|别.*提|不想.*提|以后别提/.test(input)) {
    return undefined;
  }
  return {
    pattern: compact(input, 100),
    reason: '用户在对话中表达了不要主动提及该内容的意图。',
  };
}

function createActivitySummary(input: string, output: string): string {
  return `用户提到「${compact(input, 64)}」，角色回应「${compact(output, 72)}」。`;
}

function createTurnSemanticEvent(input: {
  userInput: string;
  sourceMessageIds?: string[];
}): SemanticEvent {
  return {
    id: `semantic_event_${crypto.randomUUID()}`,
    eventType: 'story_event',
    temporalScope: 'session',
    stability: 'uncertain',
    evidenceSpan: compact(input.userInput, 360),
    confidence: 0.62,
    sourceMessageIds: input.sourceMessageIds,
  };
}

function collectCreatedMemory(storylineId: string, memoryId?: string) {
  if (!memoryId) {
    return undefined;
  }
  return listAllMemoryRecords(storylineId).find((memory) => memory.id === memoryId);
}

function listUnconsolidatedActivityLogs(storylineId: string, limit = 3) {
  const logs = listAllActivityLogs(storylineId)
    .filter((entry) => entry.status === 'active')
    .filter((entry) => entry.tags.includes(AUTO_CONSOLIDATION_ELIGIBLE_TAG))
    .filter((entry) => !entry.tags.includes(CONSOLIDATED_TAG))
    .sort((left, right) => left.happenedAt.localeCompare(right.happenedAt));
  return Number.isFinite(limit) ? logs.slice(0, limit) : logs;
}

function findLatestActiveStoryFact(storylineId: string) {
  return listAllMemoryRecords(storylineId)
    .filter((memory) => memory.kind === 'story_fact' && memory.status === 'active' && !memory.supersededBy)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function resolveActivityLogsByIds(storylineId: string, activityIds: string[]) {
  const byId = new Map(listAllActivityLogs(storylineId).map((entry) => [entry.id, entry]));
  return activityIds
    .map((id) => byId.get(id))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => left.happenedAt.localeCompare(right.happenedAt));
}

function createStoryFactCandidateForCurrentState(storylineId: string) {
  const unconsolidated = listUnconsolidatedActivityLogs(storylineId, Number.POSITIVE_INFINITY);
  const existing = findLatestActiveStoryFact(storylineId);
  if (existing?.sourceActivityIds && unconsolidated.length >= 2) {
    const previousLogs = resolveActivityLogsByIds(storylineId, existing.sourceActivityIds);
    const combinedLogs = [...previousLogs, ...unconsolidated]
      .sort((left, right) => left.happenedAt.localeCompare(right.happenedAt));
    return createStoryFactCandidateFromActivityLogs(combinedLogs, {
      supersedes: [existing.id],
    });
  }

  if (unconsolidated.length >= 3) {
    return createStoryFactCandidateFromActivityLogs(unconsolidated.slice(0, 3));
  }

  return undefined;
}

function listRecentActivityLogContext(storylineId: string, currentActivityId?: string, limit = 3) {
  return listAllActivityLogs(storylineId)
    .filter((entry) => entry.status === 'active')
    .sort((left, right) => right.happenedAt.localeCompare(left.happenedAt))
    .slice(0, limit)
    .reverse()
    .map((entry) => ({
      id: entry.id,
      happenedAt: entry.happenedAt,
      summary: entry.summary,
      ...(entry.id === currentActivityId ? { isCurrentTurn: true } : {}),
    }));
}

function applyWorldStateCandidates(input: {
  storylineId: string;
  candidates: WorldStateUpdateCandidate[];
  worldStateDebug: WorldStateDebugTrace;
}): NonNullable<ReturnType<typeof createMemoryRecord>>[] {
  const created: NonNullable<ReturnType<typeof createMemoryRecord>>[] = [];

  for (const candidate of input.candidates) {
    try {
      const result = applyWorldStateUpdateCandidate({
        storylineId: input.storylineId,
        candidate,
      });
      if (result.created) {
        created.push(result.created);
      }
      input.worldStateDebug.applyResults.push({
        outcome: result.created ? 'created' : 'existing',
        candidate,
        createdMemoryId: result.created?.id,
        existingMemoryId: result.existing?.id,
        supersededMemoryIds: result.superseded.map((memory) => memory.id),
      });
    } catch (error) {
      input.worldStateDebug.applyResults.push({
        outcome: 'error',
        candidate,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  input.worldStateDebug.updated = created.length > 0;
  return created;
}

function enqueueWorldStateJob(storylineId: string, task: () => Promise<void>): Promise<void> {
  const previous = pendingWorldStateJobs.get(storylineId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await task();
    })
    .finally(() => {
      if (pendingWorldStateJobs.get(storylineId) === next) {
        pendingWorldStateJobs.delete(storylineId);
      }
    });
  pendingWorldStateJobs.set(storylineId, next);
  return next;
}

async function runWorldStatePipeline(input: {
  storyline: Storyline;
  worldStateInput: {
    storyline: Storyline;
    userInput: string;
    assistantOutput: string;
    sourceMessageIds?: string[];
    sourceActivityIds?: string[];
    executionOptions?: WorldStateExtractorExecutionOptions;
    debugTrace: WorldStateDebugTrace;
  };
  worldStateDebug: WorldStateDebugTrace;
  gate: WorldStateSideChannelGate;
  extractor: WorldStateCandidateExtractor;
  createdWorldStateMemories: NonNullable<ReturnType<typeof createMemoryRecord>>[];
  scheduleFallbackExtractor: boolean;
  awaitBackgroundWorldState?: boolean;
}) {
  const gateResult = await input.gate.decide(input.worldStateInput);
  if (gateResult.decision === 'skip') {
    input.worldStateDebug.processingPath = 'skip';
    input.worldStateDebug.skippedReason = gateResult.reason ?? 'world state side-channel 判定当前 turn 不需要更新。';
    markWorldStateDebugEvent(input.worldStateDebug, 'gate_completed', input.worldStateDebug.skippedReason);
    return;
  }

  if (gateResult.decision === 'direct_apply') {
    input.worldStateDebug.processingPath = 'direct_apply';
    if (gateResult.candidates.length === 0) {
      input.worldStateDebug.skippedReason = 'world state side-channel 判定可直接应用，但未产出可写入 candidate。';
      markWorldStateDebugEvent(input.worldStateDebug, 'gate_completed', input.worldStateDebug.skippedReason);
      return;
    }
    markWorldStateDebugEvent(input.worldStateDebug, 'gate_completed', 'world state side-channel 直接产出可应用 candidate。');
    input.createdWorldStateMemories.push(...applyWorldStateCandidates({
      storylineId: input.storyline.id,
      candidates: gateResult.candidates,
      worldStateDebug: input.worldStateDebug,
    }));
    markWorldStateDebugEvent(
      input.worldStateDebug,
      'apply_completed',
      `已处理 ${input.worldStateDebug.applyResults.length} 条 world state apply result。`,
    );
    return;
  }

  const runExtractor = async () => {
    markWorldStateDebugEvent(input.worldStateDebug, 'extractor_started', '已进入 fallback extractor。');
    const candidates = await input.extractor.extract(input.worldStateInput);
    if (candidates.length === 0 && !input.worldStateDebug.rejectDecision?.rejected) {
      input.worldStateDebug.skippedReason = 'fallback extractor 未产出可写入的 world state candidate。';
      markWorldStateDebugEvent(input.worldStateDebug, 'extractor_completed', input.worldStateDebug.skippedReason);
      return;
    }
    markWorldStateDebugEvent(input.worldStateDebug, 'extractor_completed', `fallback extractor 产出 ${candidates.length} 条 candidate。`);
    input.createdWorldStateMemories.push(...applyWorldStateCandidates({
      storylineId: input.storyline.id,
      candidates,
      worldStateDebug: input.worldStateDebug,
    }));
    markWorldStateDebugEvent(
      input.worldStateDebug,
      'apply_completed',
      `已处理 ${input.worldStateDebug.applyResults.length} 条 world state apply result。`,
    );
  };

  if (!input.scheduleFallbackExtractor) {
    input.worldStateDebug.processingPath = 'uncertain_fallback_extractor';
    markWorldStateDebugEvent(input.worldStateDebug, 'gate_completed', 'world state side-channel 判定为 uncertain，立即进入 extractor。');
    await runExtractor();
    return;
  }

  input.worldStateDebug.processingStatus = 'scheduled';
  input.worldStateDebug.processingPath = 'uncertain_fallback_extractor';
  input.worldStateDebug.skippedReason = 'world state side-channel 判定为 uncertain，已异步调度 fallback extractor。';
  markWorldStateDebugEvent(input.worldStateDebug, 'gate_completed', input.worldStateDebug.skippedReason);
  markWorldStateDebugEvent(input.worldStateDebug, 'scheduled', 'fallback extractor 已进入后台队列。');
  const job = enqueueWorldStateJob(input.storyline.id, async () => {
    try {
      await runExtractor();
    } catch (error) {
      input.worldStateDebug.error = error instanceof Error
        ? `world state fallback extractor failed before apply stage: ${error.message}`
        : 'world state fallback extractor failed before apply stage';
      markWorldStateDebugEvent(input.worldStateDebug, 'failed', input.worldStateDebug.error);
    } finally {
      input.worldStateDebug.processingStatus = 'completed';
      input.worldStateDebug.sceneProjectionAfter = buildSceneProjection(input.storyline.id, getStorylineSceneId(input.storyline));
      markWorldStateDebugEvent(input.worldStateDebug, 'completed', '后台 fallback extractor 已结束。');
    }
  });
  if (input.awaitBackgroundWorldState) {
    await job;
  }
}

export async function waitForPendingWorldStateJobsForTests(): Promise<void> {
  await Promise.all(
    [...pendingWorldStateJobs.values()].map((job) => job.catch(() => undefined)),
  );
}

export function getLatestWorldStateDebugForStoryline(storylineId: string): WorldStateDebugTrace | undefined {
  const trace = latestWorldStateDebugByStoryline.get(storylineId);
  return trace ? cloneWorldStateDebugTrace(trace) : undefined;
}

export function getLatestRuntimeDiagnosticsForStoryline(
  storylineId: string,
): RuntimeDiagnosticsSnapshotResponse | undefined {
  const worldStateDebug = getLatestWorldStateDebugForStoryline(storylineId);
  const productMemory = latestProductMemoryDiagnosticsByStoryline.get(storylineId);
  if (!worldStateDebug && !productMemory) {
    return undefined;
  }

  const worldStateStatus = getWorldStateDiagnosticsStatus(worldStateDebug);
  const productMemoryStatus = getProductMemoryDiagnosticsStatus(productMemory);
  let status: RuntimeDiagnosticsStatus = 'skipped';

  if (worldStateStatus === 'processing') {
    status = 'processing';
  } else if (worldStateStatus === 'failed' || productMemoryStatus === 'failed') {
    status = 'failed';
  } else if (worldStateStatus === 'updated' || productMemoryStatus === 'updated') {
    status = 'updated';
  } else if (worldStateStatus === 'uncertain' || productMemoryStatus === 'uncertain') {
    status = 'uncertain';
  }

  const lastUpdatedAt = [worldStateDebug?.lastUpdatedAt, productMemory?.lastUpdatedAt]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0];

  const canRetry = status === 'failed' || status === 'uncertain'
    ? latestRetryContextByStoryline.has(storylineId)
    : false;

  return {
    storylineId,
    status,
    statusDetail: buildRuntimeDiagnosticsStatusDetail({
      worldStateDebug,
      productMemory,
      status,
    }),
    canRetry,
    retryDisabledReason: canRetry ? undefined : '最近一次派生不支持重试。',
    worldStateDebug,
    productMemory: productMemory ? cloneProductMemoryDiagnosticsSnapshot(productMemory) : undefined,
    lastUpdatedAt,
  };
}

export async function recordStorylineTurnContinuity(input: {
  storyline: Storyline;
  userInput: string;
  assistantOutput: string;
  sourceMessageIds?: string[];
  worldStateGate?: WorldStateSideChannelGate;
  worldStateExtractor?: WorldStateCandidateExtractor;
  extractorExecutionOptions?: WorldStateExtractorExecutionOptions;
  awaitBackgroundWorldState?: boolean;
  skipActivityLogCreation?: boolean;
}) {
  const worldStateDebug: WorldStateDebugTrace = {
    storylineId: input.storyline.id,
    sceneId: getStorylineSceneId(input.storyline),
    userInput: input.userInput,
    assistantOutput: input.assistantOutput,
    sourceMessageIds: input.sourceMessageIds,
    processingStatus: 'completed',
    executionMode: 'legacy_inline',
    auxiliaryLlm: {
      enabledForTurn: false,
      gateViaInvoker: true,
      extractorViaInvoker: true,
      taskType: 'world-state',
    },
    applyResults: [],
    updated: false,
    events: [],
    lastUpdatedAt: new Date().toISOString(),
    sceneProjectionBefore: buildSceneProjection(input.storyline.id, getStorylineSceneId(input.storyline)),
  };
  storeLatestWorldStateDebug(worldStateDebug);
  const created = {
    activityLog: undefined as ReturnType<typeof createActivityLog> | undefined,
    memories: [] as NonNullable<ReturnType<typeof createMemoryRecord>>[],
    worldStateMemories: [] as NonNullable<ReturnType<typeof createMemoryRecord>>[],
    suppressedMemory: undefined as ReturnType<typeof createSuppressedMemory> | undefined,
    pendingSemanticFrames: [] as ReturnType<typeof listPendingSemanticFrames>,
    resolvedPendingSemanticFrame: undefined as ReturnType<typeof resolvePendingSemanticFrameReply>['frame'],
    productMemoryWriteResults: [] as ProductMemoryWriteResult[],
    worldStateDebug,
  };

  const pendingResolution = resolvePendingSemanticFrameReply({
    storylineId: input.storyline.id,
    userInput: input.userInput,
    sourceMessageIds: input.sourceMessageIds,
  });
  created.resolvedPendingSemanticFrame = pendingResolution.frame;
  if (pendingResolution.writeResult) {
    created.productMemoryWriteResults.push(pendingResolution.writeResult);
  }
  if (pendingResolution.writeResult?.outcome === 'created') {
    const memory = collectCreatedMemory(input.storyline.id, pendingResolution.writeResult.memoryId);
    if (memory) {
      created.memories.push(memory);
    }
  }

  if (!input.skipActivityLogCreation && (!isLowInformation(input.userInput, input.assistantOutput) || input.worldStateGate || input.worldStateExtractor)) {
    created.activityLog = createActivityLog(input.storyline.id, {
      summary: createActivitySummary(input.userInput, input.assistantOutput),
      tags: ['conversation', 'auto', AUTO_CONSOLIDATION_ELIGIBLE_TAG],
      sourceMessageIds: input.sourceMessageIds,
      semanticEvents: [createTurnSemanticEvent({
        userInput: input.userInput,
        sourceMessageIds: input.sourceMessageIds,
      })],
      semanticSchemaVersion: 1,
      semanticSource: 'structured',
    });
  }
  const recentActivityLogs = listRecentActivityLogContext(input.storyline.id, created.activityLog?.id);
  worldStateDebug.recentActivityLogs = recentActivityLogs;

  const suppression = extractSuppression(input.userInput);
  if (!suppression) {
    if (input.worldStateGate || input.worldStateExtractor || input.extractorExecutionOptions) {
      const gate = input.worldStateGate ?? createStructuredWorldStateSideChannelGate();
      const extractor = input.worldStateExtractor ?? createStructuredWorldStateExtractor();
      const worldStateInput = {
        storyline: input.storyline,
        userInput: input.userInput,
        assistantOutput: input.assistantOutput,
        sourceMessageIds: input.sourceMessageIds,
        sourceActivityIds: created.activityLog ? [created.activityLog.id] : undefined,
        recentActivityLogs,
        executionOptions: input.extractorExecutionOptions,
        debugTrace: worldStateDebug,
      };
      const useAuxiliaryAsyncWorldState = Boolean(
        resolveAuxiliaryLlmRuntime(input.storyline.hermesProfileId, 'world-state'),
      );
      worldStateDebug.executionMode = useAuxiliaryAsyncWorldState ? 'auxiliary_async' : 'legacy_inline';
      worldStateDebug.auxiliaryLlm = {
        enabledForTurn: useAuxiliaryAsyncWorldState,
        gateViaInvoker: true,
        extractorViaInvoker: true,
        taskType: 'world-state',
      };
      markWorldStateDebugEvent(
        worldStateDebug,
        useAuxiliaryAsyncWorldState ? 'scheduled' : 'gate_started',
        useAuxiliaryAsyncWorldState
          ? '已切换到抽象层 LLM，等待后台 world-state job 执行。'
          : '使用当前兼容路径执行 world-state gate。',
      );

      if (useAuxiliaryAsyncWorldState) {
        worldStateDebug.processingStatus = 'scheduled';
        worldStateDebug.skippedReason = '已异步调度抽象层 LLM 处理 world state 更新。';
        storeLatestWorldStateDebug(worldStateDebug);
        const job = enqueueWorldStateJob(input.storyline.id, async () => {
          try {
            markWorldStateDebugEvent(worldStateDebug, 'gate_started', '后台 world-state gate 已开始执行。');
            await runWorldStatePipeline({
              storyline: input.storyline,
              worldStateInput,
              worldStateDebug,
              gate,
              extractor,
              createdWorldStateMemories: created.worldStateMemories,
              scheduleFallbackExtractor: false,
              awaitBackgroundWorldState: input.awaitBackgroundWorldState,
            });
          } catch (error) {
            worldStateDebug.processingPath = 'skip';
            worldStateDebug.error = error instanceof Error
              ? `world state side-channel gating failed: ${error.message}`
              : 'world state side-channel gating failed';
            markWorldStateDebugEvent(worldStateDebug, 'failed', worldStateDebug.error);
          } finally {
            worldStateDebug.processingStatus = 'completed';
            worldStateDebug.sceneProjectionAfter = buildSceneProjection(input.storyline.id, getStorylineSceneId(input.storyline));
            markWorldStateDebugEvent(worldStateDebug, 'completed', '抽象层 LLM world-state 后台任务已结束。');
          }
        });
        if (input.awaitBackgroundWorldState) {
          await job;
        }
      } else {
        try {
          markWorldStateDebugEvent(worldStateDebug, 'gate_started', 'world-state gate 已开始执行。');
          await runWorldStatePipeline({
            storyline: input.storyline,
            worldStateInput,
            worldStateDebug,
            gate,
            extractor,
            createdWorldStateMemories: created.worldStateMemories,
            scheduleFallbackExtractor: true,
            awaitBackgroundWorldState: input.awaitBackgroundWorldState,
          });
        } catch (error) {
          worldStateDebug.processingPath = 'skip';
          worldStateDebug.error = error instanceof Error
            ? `world state side-channel gating failed: ${error.message}`
            : 'world state side-channel gating failed';
          markWorldStateDebugEvent(worldStateDebug, 'failed', worldStateDebug.error);
        }
      }
    }

    for (const candidate of extractLegacyRuleBasedMemoryCandidates({
      storyline: input.storyline,
      userInput: input.userInput,
      assistantOutput: input.assistantOutput,
      sourceMessageIds: input.sourceMessageIds,
    })) {
      const result = persistMemoryCandidate({
        storylineId: input.storyline.id,
        candidate,
      });
      created.productMemoryWriteResults.push(result);
      const memory = collectCreatedMemory(input.storyline.id, result.memoryId);
      if (memory) {
        created.memories.push(memory);
      }
      if (result.outcome === 'pending_confirmation' && result.pendingFrameId) {
        const frame = listPendingSemanticFrames(input.storyline.id)
          .find((pending) => pending.id === result.pendingFrameId);
        if (frame) {
          created.pendingSemanticFrames.push(frame);
        }
      }
    }

    const storyFactCandidate = createStoryFactCandidateForCurrentState(input.storyline.id);
    if (storyFactCandidate) {
      const result = persistMemoryCandidate({
        storylineId: input.storyline.id,
        candidate: storyFactCandidate,
        allowPendingConfirmation: false,
      });
      created.productMemoryWriteResults.push(result);
      const memory = collectCreatedMemory(input.storyline.id, result.memoryId);
      if (memory) {
        created.memories.push(memory);
        for (const activityId of storyFactCandidate.sourceActivityIds ?? []) {
          updateActivityLog(activityId, {
            tags: Array.from(new Set([...(listAllActivityLogs(input.storyline.id)
              .find((entry) => entry.id === activityId)?.tags ?? []), CONSOLIDATED_TAG])),
          });
        }
      }
    }
  }

  if (suppression && !hasDuplicateSuppression(input.storyline.id, suppression.pattern)) {
    created.suppressedMemory = createSuppressedMemory(input.storyline.id, suppression);
    worldStateDebug.processingPath = 'skip';
    worldStateDebug.skippedReason = '当前输入命中了 suppression 规则，跳过 world state 更新。';
  }

  if (worldStateDebug.processingStatus === 'completed') {
    worldStateDebug.sceneProjectionAfter = buildSceneProjection(input.storyline.id, getStorylineSceneId(input.storyline));
    markWorldStateDebugEvent(worldStateDebug, 'completed', '当前 turn 的 world-state 处理已完成。');
  }

  created.pendingSemanticFrames = listPendingSemanticFrames(input.storyline.id);
  const productMemorySnapshot: ProductMemoryDiagnosticsSnapshot = {
    storylineId: input.storyline.id,
    userInput: input.userInput,
    assistantOutput: input.assistantOutput,
    writeResults: created.productMemoryWriteResults.map(mapWriteResultEntry),
    pendingSemanticFrames: created.pendingSemanticFrames,
    resolvedPendingSemanticFrame: created.resolvedPendingSemanticFrame,
    lastUpdatedAt: new Date().toISOString(),
  };
  storeLatestProductMemoryDiagnostics(productMemorySnapshot);
  latestRetryContextByStoryline.set(input.storyline.id, {
    userInput: input.userInput,
    assistantOutput: input.assistantOutput,
    sourceMessageIds: input.sourceMessageIds,
  });

  return created;
}

export async function retryLatestRuntimeDiagnosticsForStoryline(input: {
  storyline: Storyline;
}): Promise<RuntimeDiagnosticsSnapshotResponse> {
  const latest = getLatestRuntimeDiagnosticsForStoryline(input.storyline.id);
  if (!latest || (latest.status !== 'failed' && latest.status !== 'uncertain')) {
    throw new Error('最近一次后台派生不支持重试。');
  }
  const retryContext = latestRetryContextByStoryline.get(input.storyline.id);
  if (!retryContext) {
    throw new Error('未找到可重试的最近一次派生输入。');
  }
  await recordStorylineTurnContinuity({
    storyline: input.storyline,
    userInput: retryContext.userInput,
    assistantOutput: retryContext.assistantOutput,
    sourceMessageIds: retryContext.sourceMessageIds,
    awaitBackgroundWorldState: true,
    skipActivityLogCreation: true,
  });
  const refreshed = getLatestRuntimeDiagnosticsForStoryline(input.storyline.id);
  if (!refreshed) {
    throw new Error('重试后未生成新的 diagnostics 结果。');
  }
  return refreshed;
}
