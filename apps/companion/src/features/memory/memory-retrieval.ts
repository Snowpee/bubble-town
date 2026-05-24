import type { MemoryRecord, MemoryRetrievalMetadata, SuppressedMemory } from '@bubble-town/shared';
import { matchesSuppressionText } from './suppression-filter.js';
import { isPastRecallInput, isSuppressionDirectInquiry } from '../story/recall-language.js';

export interface MemoryRetrievalResult {
  memories: MemoryRecord[];
  metadata: MemoryRetrievalMetadata[];
}

const DEFAULT_MEMORY_BUDGET = 6;

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function tokenize(value: string): string[] {
  const normalized = normalize(value)
    .replace(/[，。！？、；：“”"'`~!@#$%^&*()[\]{}<>|\\/_+=,.?:;-]/g, ' ');
  const ascii = normalized.split(/\s+/).filter((token) => token.length >= 2);
  const cjk = Array.from(new Set(normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? []));
  const cjkPairs = cjk.flatMap((segment) => {
    const pairs: string[] = [];
    for (let index = 0; index < segment.length - 1; index += 1) {
      pairs.push(segment.slice(index, index + 2));
    }
    return pairs;
  });
  return Array.from(new Set([...ascii, ...cjk, ...cjkPairs])).filter((token) => token.length >= 2);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function recencyScore(memory: MemoryRecord, now = Date.now()): number {
  const updated = new Date(memory.updatedAt || memory.createdAt).getTime();
  if (Number.isNaN(updated)) {
    return 0.2;
  }
  const ageDays = Math.max(0, (now - updated) / 86_400_000);
  if (ageDays <= 1) {
    return 1;
  }
  if (ageDays >= 60) {
    return 0.1;
  }
  return clamp(1 - ageDays / 60);
}

function isCoreMemory(memory: MemoryRecord): boolean {
  return memory.kind === 'identity' || memory.kind === 'boundary' || memory.scope === 'character';
}

function relevanceScore(memory: MemoryRecord, input?: string): { score: number; reasons: string[] } {
  if (!input?.trim()) {
    return isCoreMemory(memory)
      ? { score: 0.35, reasons: ['core_memory'] }
      : { score: 0.08, reasons: ['no_input_low_relevance'] };
  }

  const memoryTokens = tokenize(memory.content);
  const inputTokens = tokenize(input);
  const matched = inputTokens.filter((token) => memoryTokens.some((memoryToken) => memoryToken.includes(token) || token.includes(memoryToken)));
  const direct = normalize(memory.content).includes(normalize(input));
  const score = direct ? 1 : matched.length > 0 ? clamp(matched.length / Math.max(3, inputTokens.length)) : 0;
  const reasons = matched.length > 0 ? [`matched:${matched.slice(0, 4).join(',')}`] : [];

  if (isPastRecallInput(input) && memory.kind !== 'unclassified') {
    return { score: clamp(score + 0.15), reasons: [...reasons, 'past_recall_input'] };
  }

  return { score, reasons };
}

function matchesSuppression(memory: MemoryRecord, suppressions: SuppressedMemory[]): boolean {
  return matchesSuppressionText(memory.content, suppressions);
}

export function retrieveMemoriesForContext(input: {
  memories: MemoryRecord[];
  suppressedMemories: SuppressedMemory[];
  query?: string;
  budget?: number;
  semanticScores?: Map<string, number>;
}): MemoryRetrievalResult {
  const budget = input.budget ?? DEFAULT_MEMORY_BUDGET;
  const query = input.query?.trim();
  const allowSuppressed = Boolean(query && isSuppressionDirectInquiry(query));

  const scored = input.memories.map((memory) => {
    const matchedSuppression = matchesSuppression(memory, input.suppressedMemories);
    const relevance = relevanceScore(memory, query);
    const importance = clamp(memory.importance ?? (isCoreMemory(memory) ? 0.7 : 0.45));
    const confidence = clamp(memory.confidence ?? 0.55);
    const recency = recencyScore(memory);
    const semantic = clamp(input.semanticScores?.get(memory.id) ?? 0);
    const lifespanPenalty = memory.lifespan === 'temporary' ? 0.35 : memory.lifespan === 'short_term' ? 0.15 : 0;
    const score = input.semanticScores
      ? clamp((semantic * 0.38) + (relevance.score * 0.25) + (importance * 0.18) + (confidence * 0.12) + (recency * 0.07) - lifespanPenalty)
      : clamp((relevance.score * 0.46) + (importance * 0.24) + (confidence * 0.18) + (recency * 0.12) - lifespanPenalty);

    return {
      memory,
      metadata: {
        memoryId: memory.id,
        score,
        relevance: relevance.score,
        importance,
        confidence,
        semantic,
        recency,
        matchedSuppression,
        reasons: [
          ...relevance.reasons,
          semantic > 0 ? `semantic:${semantic.toFixed(3)}` : undefined,
          isCoreMemory(memory) ? 'core_memory' : undefined,
          memory.lifespan ? `lifespan:${memory.lifespan}` : undefined,
        ].filter((reason): reason is string => Boolean(reason)),
      },
    };
  });

  const filtered = scored
    .filter((entry) => allowSuppressed || !entry.metadata.matchedSuppression)
    .filter((entry) => entry.metadata.relevance > 0 || (entry.metadata.semantic ?? 0) > 0.12 || isCoreMemory(entry.memory) || isPastRecallInput(query ?? ''))
    .sort((left, right) => right.metadata.score - left.metadata.score)
    .slice(0, budget);

  return {
    memories: filtered.map((entry) => entry.memory),
    metadata: filtered.map((entry) => entry.metadata),
  };
}
