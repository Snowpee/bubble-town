import type { MemoryCandidate, Storyline, WorldStateDebugTrace, WorldStateUpdateCandidate } from '@bubble-town/shared';
import { createActivityLog, createMemoryRecord, createSuppressedMemory, listAllMemoryRecords, listAllSuppressedMemories } from './story-runtime-store.js';
import { extractRuleBasedMemoryCandidates } from './memory-candidates.js';
import type { WorldStateCandidateExtractor, WorldStateExtractorExecutionOptions } from './world-state-extractor.js';
import { createStructuredWorldStateExtractor } from './world-state-extractor.js';
import type { WorldStateSideChannelGate } from './world-state-side-channel.js';
import { createStructuredWorldStateSideChannelGate } from './world-state-side-channel.js';
import { applyWorldStateUpdateCandidate, buildSceneProjection, getStorylineSceneId } from './world-state.js';

const pendingWorldStateJobs = new Map<string, Promise<void>>();

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
    .then(task)
    .finally(() => {
      if (pendingWorldStateJobs.get(storylineId) === next) {
        pendingWorldStateJobs.delete(storylineId);
      }
    });
  pendingWorldStateJobs.set(storylineId, next);
  return next;
}

export async function waitForPendingWorldStateJobsForTests(): Promise<void> {
  await Promise.all(
    [...pendingWorldStateJobs.values()].map((job) => job.catch(() => undefined)),
  );
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
    applyResults: [],
    updated: false,
    sceneProjectionBefore: buildSceneProjection(input.storyline.id, getStorylineSceneId(input.storyline)),
  };
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
      const worldStateInput = {
        storyline: input.storyline,
        userInput: input.userInput,
        assistantOutput: input.assistantOutput,
        sourceMessageIds: input.sourceMessageIds,
        sourceActivityIds: created.activityLog ? [created.activityLog.id] : undefined,
        executionOptions: input.extractorExecutionOptions,
        debugTrace: worldStateDebug,
      };

      try {
        const gateResult = await gate.decide(worldStateInput);
        if (gateResult.decision === 'skip') {
          worldStateDebug.processingPath = 'skip';
          worldStateDebug.skippedReason = gateResult.reason ?? 'world state side-channel 判定当前 turn 不需要更新。';
        } else if (gateResult.decision === 'direct_apply') {
          worldStateDebug.processingPath = 'direct_apply';
          if (gateResult.candidates.length === 0) {
            worldStateDebug.skippedReason = 'world state side-channel 判定可直接应用，但未产出可写入 candidate。';
          } else {
            created.worldStateMemories.push(...applyWorldStateCandidates({
              storylineId: input.storyline.id,
              candidates: gateResult.candidates,
              worldStateDebug,
            }));
          }
        } else {
          worldStateDebug.processingStatus = 'scheduled';
          worldStateDebug.processingPath = 'uncertain_fallback_extractor';
          worldStateDebug.skippedReason = 'world state side-channel 判定为 uncertain，已异步调度 fallback extractor。';
          const extractor = input.worldStateExtractor ?? createStructuredWorldStateExtractor();
          const job = enqueueWorldStateJob(input.storyline.id, async () => {
            try {
              const candidates = await extractor.extract(worldStateInput);
              if (candidates.length === 0 && !worldStateDebug.rejectDecision?.rejected) {
                worldStateDebug.skippedReason = 'fallback extractor 未产出可写入的 world state candidate。';
              } else {
                created.worldStateMemories.push(...applyWorldStateCandidates({
                  storylineId: input.storyline.id,
                  candidates,
                  worldStateDebug,
                }));
              }
            } catch {
              worldStateDebug.error = 'world state fallback extractor failed before apply stage';
            } finally {
              worldStateDebug.processingStatus = 'completed';
              worldStateDebug.sceneProjectionAfter = buildSceneProjection(input.storyline.id, getStorylineSceneId(input.storyline));
            }
          });
          if (input.awaitBackgroundWorldState) {
            await job;
          }
        }
      } catch {
        worldStateDebug.processingPath = 'skip';
        worldStateDebug.error = 'world state side-channel gating failed';
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
  }

  return created;
}
