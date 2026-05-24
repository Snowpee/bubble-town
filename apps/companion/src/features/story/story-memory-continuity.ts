import type { MemoryCandidate, Storyline, WorldStateDebugTrace, WorldStateUpdateCandidate } from '@bubble-town/shared';
import { createActivityLog, createMemoryRecord, createSuppressedMemory, listAllMemoryRecords, listAllSuppressedMemories } from '../../store/story-runtime-store.js';
import { resolveAuxiliaryLlmRuntime } from '../../store/auxiliary-llm-store.js';
import { extractRuleBasedMemoryCandidates } from '../memory/memory-candidates.js';
import type { WorldStateCandidateExtractor, WorldStateExtractorExecutionOptions } from '../world-state/world-state-extractor.js';
import { createStructuredWorldStateExtractor } from '../world-state/world-state-extractor.js';
import type { WorldStateSideChannelGate } from '../world-state/world-state-side-channel.js';
import { createStructuredWorldStateSideChannelGate } from '../world-state/world-state-side-channel.js';
import { applyWorldStateUpdateCandidate, buildSceneProjection, getStorylineSceneId } from '../world-state/world-state.js';

const pendingWorldStateJobs = new Map<string, Promise<void>>();
const latestWorldStateDebugByStoryline = new Map<string, WorldStateDebugTrace>();

function cloneWorldStateDebugTrace(trace: WorldStateDebugTrace): WorldStateDebugTrace {
  return JSON.parse(JSON.stringify(trace)) as WorldStateDebugTrace;
}

function storeLatestWorldStateDebug(trace: WorldStateDebugTrace) {
  latestWorldStateDebugByStoryline.set(trace.storylineId, cloneWorldStateDebugTrace(trace));
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

function createMemoryIfNew(storyline: Storyline, candidate: MemoryCandidate) {
  if (!candidate.shouldPersist || candidate.confidence < 0.45) {
    return undefined;
  }
  if (hasDuplicateMemory(storyline.id, candidate.content)) {
    return undefined;
  }
  return createMemoryRecord(storyline.id, {
    content: candidate.content,
    scope: candidate.scope,
    source: candidate.source,
    kind: candidate.kind,
    lifespan: candidate.lifespan,
    reason: candidate.reason,
    importance: candidate.importance,
    confidence: candidate.confidence,
    sourceMessageIds: candidate.sourceMessageIds,
  });
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

export async function recordStorylineTurnContinuity(input: {
  storyline: Storyline;
  userInput: string;
  assistantOutput: string;
  sourceMessageIds?: string[];
  worldStateGate?: WorldStateSideChannelGate;
  worldStateExtractor?: WorldStateCandidateExtractor;
  extractorExecutionOptions?: WorldStateExtractorExecutionOptions;
  awaitBackgroundWorldState?: boolean;
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
    worldStateDebug,
  };

  if (!isLowInformation(input.userInput, input.assistantOutput)) {
    created.activityLog = createActivityLog(input.storyline.id, {
      summary: createActivitySummary(input.userInput, input.assistantOutput),
      tags: ['conversation', 'auto'],
      sourceMessageIds: input.sourceMessageIds,
    });
  }

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

    for (const candidate of extractRuleBasedMemoryCandidates({
      storyline: input.storyline,
      userInput: input.userInput,
      assistantOutput: input.assistantOutput,
      sourceMessageIds: input.sourceMessageIds,
    })) {
      const memory = createMemoryIfNew(input.storyline, candidate);
      if (memory) {
        created.memories.push(memory);
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

  return created;
}
