import type {
  ActivityLog,
  CreateMemoryRequest,
  MemoryCandidate,
  MemoryRecord,
  PendingSemanticFrame,
  PendingSemanticFrameKind,
  ProductMemoryWriteResult,
  SemanticEvent,
} from '@bubble-town/shared';
import {
  createMemoryRecord,
  createPendingSemanticFrame,
  listAllMemoryRecords,
  listPendingSemanticFrames,
  listAllSuppressedMemories,
  updateMemoryRecord,
  updatePendingSemanticFrame,
} from '../../store/story-runtime-store.js';
import { matchesSuppressionText } from './suppression-filter.js';

function compact(value: string, maxLength = 360): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}...`;
}

export function canonicalMemoryContent(value: string): string {
  return value
    .replace(/^(用户偏好|用户边界或负向偏好|用户身份或稳定事实|用户明确提出需要记住或延续的约定|阶段摘要|关系状态)：/, '')
    .replace(/^(用户|我|我们|角色)/, '')
    .replace(/^(现在|目前|如今|已经)/, '')
    .replace(/[，。！？、；：“”"'`~!@#$%^&*()[\]{}<>|\\/_+=,.?:;-]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function resolvePendingFrameKind(candidate: MemoryCandidate): PendingSemanticFrameKind | undefined {
  if (candidate.kind === 'preference') {
    return 'preference_confirm';
  }
  if (candidate.kind === 'commitment') {
    return 'commitment_confirm';
  }
  if (candidate.kind === 'relationship') {
    return 'relationship_confirm';
  }
  return undefined;
}

function getExistingActiveMemory(storylineId: string, candidate: MemoryCandidate): MemoryRecord | undefined {
  const canonical = canonicalMemoryContent(candidate.content);
  const memories = listAllMemoryRecords(storylineId);
  const active = memories.find((memory) => (
    memory.status === 'active'
    && !memory.supersededBy
    && (memory.kind ?? 'identity') === candidate.kind
    && canonicalMemoryContent(memory.content) === canonical
  ));
  if (active) {
    return active;
  }
  const superseded = memories.find((memory) => (
    memory.supersededBy
    && (memory.kind ?? 'identity') === candidate.kind
    && canonicalMemoryContent(memory.content) === canonical
  ));
  if (!superseded?.supersededBy) {
    return undefined;
  }
  return memories.find((memory) => memory.id === superseded.supersededBy && memory.status === 'active');
}

function getExistingPendingFrame(storylineId: string, candidate: MemoryCandidate): PendingSemanticFrame | undefined {
  const canonical = canonicalMemoryContent(candidate.content);
  return listPendingSemanticFrames(storylineId).find((frame) => (
    frame.kind === resolvePendingFrameKind(candidate)
    && canonicalMemoryContent(frame.candidate.content) === canonical
  ));
}

export function persistMemoryCandidate(input: {
  storylineId: string;
  candidate: MemoryCandidate;
  allowPendingConfirmation?: boolean;
}): ProductMemoryWriteResult {
  const allowPendingConfirmation = input.allowPendingConfirmation ?? true;
  const candidate = input.candidate;

  if (!candidate.shouldPersist || candidate.confidence < 0.45) {
    return {
      outcome: 'skipped',
      candidate,
      reason: 'candidate 当前不满足持久化阈值。',
    };
  }

  const suppressions = listAllSuppressedMemories(input.storylineId);
  if (suppressions.length > 0 && matchesSuppressionText(candidate.content, suppressions)) {
    return {
      outcome: 'rejected',
      candidate,
      reason: 'candidate 命中了 active suppression，已跳过自动写入。',
    };
  }

  const existing = getExistingActiveMemory(input.storylineId, candidate);
  if (existing) {
    return {
      outcome: 'existing',
      candidate,
      existingMemoryId: existing.id,
      reason: '已存在语义等价的 active memory。',
    };
  }

  if (allowPendingConfirmation && candidate.confirmationRequired) {
    const existingFrame = getExistingPendingFrame(input.storylineId, candidate);
    if (existingFrame) {
      return {
        outcome: 'pending_confirmation',
        candidate,
        pendingFrameId: existingFrame.id,
        reason: '已存在待确认的同类 pending semantic frame。',
      };
    }
    const kind = resolvePendingFrameKind(candidate);
    if (!kind) {
      return {
        outcome: 'rejected',
        candidate,
        reason: '当前 candidate 标记为需确认，但 kind 不支持 pending frame。',
      };
    }
    const frame = createPendingSemanticFrame({
      storylineId: input.storylineId,
      kind,
      candidate,
      prompt: candidate.confirmationPrompt ?? `请确认这条${candidate.kind}记忆是否应被正式记录。`,
      sourceMessageIds: candidate.sourceMessageIds,
    });
    return {
      outcome: 'pending_confirmation',
      candidate,
      pendingFrameId: frame.id,
      reason: 'candidate 已进入待确认状态。',
    };
  }

  const memory = createMemoryRecord(input.storylineId, {
    content: candidate.content,
    scope: candidate.scope,
    source: candidate.source,
    kind: candidate.kind,
    lifespan: candidate.lifespan,
    reason: candidate.reason,
    importance: candidate.importance,
    confidence: candidate.confidence,
    sourceMessageIds: candidate.sourceMessageIds,
    supersedes: candidate.supersedes,
    sourceActivityIds: candidate.sourceActivityIds,
    sourceHappenedAtStart: candidate.sourceHappenedAtStart,
    sourceHappenedAtEnd: candidate.sourceHappenedAtEnd,
    semanticEvents: candidate.semanticEvents,
    worldState: candidate.worldState,
  });
  for (const supersededId of candidate.supersedes ?? []) {
    updateMemoryRecord(supersededId, {
      status: 'hidden',
      supersededBy: memory.id,
    });
  }
  return {
    outcome: 'created',
    candidate,
    memoryId: memory.id,
  };
}

export function createManualMemory(storylineId: string, input: CreateMemoryRequest): MemoryRecord {
  return createMemoryRecord(storylineId, input);
}

function normalizeEvidenceSpan(value: string): string {
  return value
    .replace(/\.{3}|…/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function listStructuredEvents(activityLogs: ActivityLog[]): SemanticEvent[] {
  return activityLogs
    .flatMap((entry) => entry.semanticEvents ?? [])
    .filter((event) => event.evidenceSpan.trim());
}

function buildStoryFactSummary(activityLogs: ActivityLog[]): string {
  const structuredEvents = listStructuredEvents(activityLogs);
  if (structuredEvents.length > 0) {
    return compact(Array.from(new Set(
      structuredEvents.map((event) => normalizeEvidenceSpan(event.evidenceSpan)).filter(Boolean),
    )).join('；'));
  }

  return compact(activityLogs
    .map((entry) => normalizeEvidenceSpan(entry.summary))
    .filter(Boolean)
    .join('；'));
}

export function createStoryFactCandidateFromActivityLogs(activityLogs: ActivityLog[], input?: {
  supersedes?: string[];
}): MemoryCandidate | undefined {
  if (activityLogs.length < 3) {
    return undefined;
  }
  const happenedAtValues = activityLogs.map((entry) => entry.happenedAt).sort();
  const uniqueActivityIds = Array.from(new Set(activityLogs.map((entry) => entry.id)));
  const summary = buildStoryFactSummary(activityLogs);
  const semanticEvents = listStructuredEvents(activityLogs);
  return {
    kind: 'story_fact',
    content: `阶段摘要：${summary}`,
    scope: 'activity',
    source: 'summary',
    lifespan: 'episodic',
    importance: 0.56,
    confidence: 0.68,
    reason: input?.supersedes?.length
      ? `由 ${activityLogs.length} 条 ActivityLog 重新巩固 story_fact，并替代旧阶段摘要。`
      : `由 ${activityLogs.length} 条 ActivityLog 派生 story_fact，并保留来源 ActivityLog 引用。`,
    shouldPersist: true,
    supersedes: input?.supersedes,
    sourceActivityIds: uniqueActivityIds,
    sourceHappenedAtStart: happenedAtValues[0],
    sourceHappenedAtEnd: happenedAtValues[happenedAtValues.length - 1],
    semanticEvents: semanticEvents.length > 0 ? semanticEvents : undefined,
  };
}

function classifyShortReply(input: string): 'affirm' | 'deny' | undefined {
  const normalized = input.replace(/\s+/g, '').toLowerCase();
  if (!normalized || normalized.length > 12) {
    return undefined;
  }
  if (/^(嗯|是|对|没错|好|好的|可以|行|行的|对啊|是的|没问题|嗯嗯)$/.test(normalized)) {
    return 'affirm';
  }
  if (/^(不|不是|没有|不用|别|不对|并没有|不是这样)$/.test(normalized)) {
    return 'deny';
  }
  return undefined;
}

export function resolvePendingSemanticFrameReply(input: {
  storylineId: string;
  userInput: string;
  sourceMessageIds?: string[];
}): { frame?: PendingSemanticFrame; writeResult?: ProductMemoryWriteResult } {
  const latest = listPendingSemanticFrames(input.storylineId)[0];
  const replyKind = classifyShortReply(input.userInput);
  if (!latest || !replyKind) {
    return {};
  }

  if (replyKind === 'deny') {
    const frame = updatePendingSemanticFrame(latest.id, {
      status: 'cancelled',
      resolvedByMessageIds: input.sourceMessageIds,
      lastUserReply: input.userInput,
    });
    return { frame };
  }

  const resolvedCandidate: MemoryCandidate = {
    ...latest.candidate,
    confirmationRequired: false,
    sourceMessageIds: input.sourceMessageIds ?? latest.candidate.sourceMessageIds,
  };
  const writeResult = persistMemoryCandidate({
    storylineId: input.storylineId,
    candidate: resolvedCandidate,
    allowPendingConfirmation: false,
  });
  const frame = updatePendingSemanticFrame(latest.id, {
    status: 'resolved',
    resolvedByMessageIds: input.sourceMessageIds,
    lastUserReply: input.userInput,
  });
  return { frame, writeResult };
}

export function confirmPendingSemanticFrame(input: {
  storylineId: string;
  frameId: string;
  sourceMessageIds?: string[];
  userReply?: string;
}): { frame: PendingSemanticFrame; writeResult: ProductMemoryWriteResult } {
  const frame = listPendingSemanticFrames(input.storylineId).find((candidate) => candidate.id === input.frameId);
  if (!frame) {
    throw new Error('未找到待确认语义帧。');
  }

  const resolvedCandidate: MemoryCandidate = {
    ...frame.candidate,
    confirmationRequired: false,
    sourceMessageIds: input.sourceMessageIds ?? frame.candidate.sourceMessageIds,
  };
  const writeResult = persistMemoryCandidate({
    storylineId: input.storylineId,
    candidate: resolvedCandidate,
    allowPendingConfirmation: false,
  });
  const updated = updatePendingSemanticFrame(frame.id, {
    status: 'resolved',
    resolvedByMessageIds: input.sourceMessageIds,
    lastUserReply: input.userReply ?? 'manual_confirm',
  });

  if (!updated) {
    throw new Error('确认待确认语义帧失败。');
  }
  return { frame: updated, writeResult };
}

export function cancelPendingSemanticFrame(input: {
  storylineId: string;
  frameId: string;
  userReply?: string;
}): PendingSemanticFrame {
  const frame = listPendingSemanticFrames(input.storylineId).find((candidate) => candidate.id === input.frameId);
  if (!frame) {
    throw new Error('未找到待确认语义帧。');
  }

  const updated = updatePendingSemanticFrame(frame.id, {
    status: 'cancelled',
    lastUserReply: input.userReply ?? 'manual_cancel',
  });
  if (!updated) {
    throw new Error('取消待确认语义帧失败。');
  }
  return updated;
}
