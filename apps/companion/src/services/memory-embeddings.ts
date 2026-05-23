import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MemoryEmbedding, MemoryEmbeddingTargetType, MemoryRecord } from '@bubble-town/shared';
import { getHermesRoot } from './hermes-paths.js';

const LOCAL_HASH_EMBEDDING_MODEL = 'bubble-town-local-hash-v1';
const LOCAL_HASH_EMBEDDING_DIMENSION = 128;

interface EmbeddingStoreData {
  version: 1;
  embeddings: MemoryEmbedding[];
}

export interface EmbeddingProvider {
  model: string;
  dimension: number;
  embedText(text: string): number[];
}

const EMPTY_DATA: EmbeddingStoreData = {
  version: 1,
  embeddings: [],
};

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function getEmbeddingStorePath(): string {
  return path.join(getHermesRoot(), 'bubble-town-embeddings.json');
}

function readData(): EmbeddingStoreData {
  const storePath = getEmbeddingStorePath();
  if (!fs.existsSync(storePath)) {
    return { ...EMPTY_DATA };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8')) as Partial<EmbeddingStoreData>;
    return {
      version: 1,
      embeddings: Array.isArray(parsed.embeddings) ? parsed.embeddings : [],
    };
  } catch {
    return { ...EMPTY_DATA };
  }
}

function writeData(data: EmbeddingStoreData): void {
  const storePath = getEmbeddingStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function expandSynonyms(tokens: string[]): string[] {
  const expanded = new Set(tokens);
  const groups = [
    ['散步', '走走', '出去走', '遛弯', '饭后走'],
    ['咖啡', '手冲', '拿铁', '美式'],
    ['直接', '说重点', '简洁', '别绕弯'],
    ['晚饭', '饭后', '晚餐'],
  ];

  for (const group of groups) {
    if (group.some((token) => expanded.has(token) || tokens.some((item) => item.includes(token)))) {
      for (const token of group) {
        expanded.add(token);
      }
    }
  }

  return Array.from(expanded);
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
  return expandSynonyms(Array.from(new Set([...ascii, ...cjk, ...cjkPairs])).filter((token) => token.length >= 2));
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) {
    return vector;
  }
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

export const localHashEmbeddingProvider: EmbeddingProvider = {
  model: LOCAL_HASH_EMBEDDING_MODEL,
  dimension: LOCAL_HASH_EMBEDDING_DIMENSION,
  embedText(text: string): number[] {
    const vector = Array.from({ length: LOCAL_HASH_EMBEDDING_DIMENSION }, () => 0);
    for (const token of tokenize(text)) {
      const hash = hashToken(token);
      const index = hash % LOCAL_HASH_EMBEDDING_DIMENSION;
      const sign = hash & 1 ? 1 : -1;
      vector[index] += sign;
    }
    return normalizeVector(vector);
  },
};

export function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (!length) {
    return 0;
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  const magnitude = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return magnitude ? Math.max(0, dot / magnitude) : 0;
}

function buildEmbeddingText(record: MemoryRecord): string {
  return [
    record.kind ? `kind:${record.kind}` : undefined,
    record.scope ? `scope:${record.scope}` : undefined,
    record.content,
    record.reason,
  ].filter(Boolean).join('\n');
}

export function getEmbeddingForTarget(targetType: MemoryEmbeddingTargetType, targetId: string): MemoryEmbedding | undefined {
  return readData().embeddings.find((embedding) => embedding.targetType === targetType && embedding.targetId === targetId);
}

export function upsertEmbedding(input: {
  storylineId: string;
  targetType: MemoryEmbeddingTargetType;
  targetId: string;
  text: string;
  provider?: EmbeddingProvider;
}): MemoryEmbedding {
  const provider = input.provider ?? localHashEmbeddingProvider;
  const data = readData();
  const now = nowIso();
  const existingIndex = data.embeddings.findIndex(
    (embedding) => embedding.targetType === input.targetType && embedding.targetId === input.targetId,
  );
  const current = existingIndex === -1 ? undefined : data.embeddings[existingIndex];
  const embedding: MemoryEmbedding = {
    id: current?.id ?? createId('emb'),
    storylineId: input.storylineId,
    targetType: input.targetType,
    targetId: input.targetId,
    embeddingModel: provider.model,
    embeddingText: input.text,
    vector: provider.embedText(input.text),
    dimension: provider.dimension,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };

  if (existingIndex === -1) {
    data.embeddings.push(embedding);
  } else {
    data.embeddings[existingIndex] = embedding;
  }
  writeData(data);
  return embedding;
}

export function ensureMemoryEmbedding(record: MemoryRecord, provider: EmbeddingProvider = localHashEmbeddingProvider): MemoryEmbedding | undefined {
  if (!record.storylineId) {
    return undefined;
  }
  const text = buildEmbeddingText(record);
  const existing = getEmbeddingForTarget('memory', record.id);
  if (existing && existing.embeddingModel === provider.model && existing.embeddingText === text) {
    return existing;
  }
  return upsertEmbedding({
    storylineId: record.storylineId,
    targetType: 'memory',
    targetId: record.id,
    text,
    provider,
  });
}

export function ensureMemoryEmbeddings(records: MemoryRecord[], provider: EmbeddingProvider = localHashEmbeddingProvider): MemoryEmbedding[] {
  return records.flatMap((record) => {
    const embedding = ensureMemoryEmbedding(record, provider);
    return embedding ? [embedding] : [];
  });
}

export function getSemanticScores(input: {
  storylineId: string;
  query: string;
  targetIds: string[];
  provider?: EmbeddingProvider;
}): Map<string, number> {
  const provider = input.provider ?? localHashEmbeddingProvider;
  const queryVector = provider.embedText(input.query);
  const targetIds = new Set(input.targetIds);
  const scores = new Map<string, number>();

  for (const embedding of readData().embeddings) {
    if (embedding.storylineId !== input.storylineId || embedding.targetType !== 'memory' || !targetIds.has(embedding.targetId)) {
      continue;
    }
    scores.set(embedding.targetId, cosineSimilarity(queryVector, embedding.vector));
  }

  return scores;
}

export function removeEmbeddingsForStorylines(storylineIds: string[]): number {
  const targets = new Set(storylineIds.map((storylineId) => storylineId.trim()).filter(Boolean));
  if (targets.size === 0) {
    return 0;
  }

  const data = readData();
  const nextEmbeddings = data.embeddings.filter((embedding) => !targets.has(embedding.storylineId));
  const removedCount = data.embeddings.length - nextEmbeddings.length;
  if (removedCount > 0) {
    writeData({
      ...data,
      embeddings: nextEmbeddings,
    });
  }
  return removedCount;
}

export function resetMemoryEmbeddingsForTests(): void {
  const storePath = getEmbeddingStorePath();
  if (fs.existsSync(storePath)) {
    fs.unlinkSync(storePath);
  }
}
