import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cosineSimilarity,
  ensureMemoryEmbedding,
  getEmbeddingForTarget,
  getSemanticScores,
  localHashEmbeddingProvider,
  resetMemoryEmbeddingsForTests,
} from './memory-embeddings.js';
import {
  createCharacter,
  createMemoryRecord,
  createStoryline,
  resetStoryRuntimeForTests,
} from '../../store/story-runtime-store.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-memory-embeddings-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  resetMemoryEmbeddingsForTests();
  resetStoryRuntimeForTests();
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('local hash embedding provider 生成稳定归一化向量', () => {
  const left = localHashEmbeddingProvider.embedText('用户喜欢晚饭后散步');
  const right = localHashEmbeddingProvider.embedText('用户喜欢晚饭后散步');

  assert.equal(left.length, localHashEmbeddingProvider.dimension);
  assert.deepEqual(left, right);
  assert.ok(cosineSimilarity(left, right) > 0.99);
});

test('MemoryRecord 首次参与索引时写入 Bubble Town embedding store', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });
    const memory = createMemoryRecord(storyline.id, {
      content: '用户喜欢晚饭后散步。',
      kind: 'preference',
    });

    const embedding = ensureMemoryEmbedding(memory);

    assert.equal(embedding?.targetType, 'memory');
    assert.equal(embedding?.targetId, memory.id);
    assert.equal(embedding?.storylineId, storyline.id);
    assert.equal(getEmbeddingForTarget('memory', memory.id)?.id, embedding?.id);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('semantic scores 只读取当前 Storyline 的 embedding', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const first = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });
    const second = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-002',
      title: '平行剧情',
    });
    const firstMemory = createMemoryRecord(first.id, { content: '用户喜欢晚饭后散步。', kind: 'preference' });
    const secondMemory = createMemoryRecord(second.id, { content: '用户喜欢晚饭后散步。', kind: 'preference' });
    ensureMemoryEmbedding(firstMemory);
    ensureMemoryEmbedding(secondMemory);

    const scores = getSemanticScores({
      storylineId: first.id,
      query: '出去走走',
      targetIds: [firstMemory.id, secondMemory.id],
    });

    assert.equal(scores.has(firstMemory.id), true);
    assert.equal(scores.has(secondMemory.id), false);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

