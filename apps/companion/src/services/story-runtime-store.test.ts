import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createCharacter,
  createStoryline,
  clearRuntimeSessionContinuation,
  getActiveStoryline,
  getActiveStorylineForProfile,
  getRuntimeSessionForStoryline,
  resetStoryRuntimeForTests,
  setActiveStoryline,
  setActiveStorylineForProfile,
  upsertRuntimeSession,
} from '../store/story-runtime-store.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-story-runtime-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  resetStoryRuntimeForTests();
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('创建 Storyline 时设置 active，并拒绝重复绑定同一个 Hermes profile', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });

    assert.equal(getActiveStoryline()?.id, storyline.id);
    assert.throws(
      () => createStoryline({ characterId: character.id, hermesProfileId: 'sami-story-001', title: '重复剧情' }),
      /已绑定/,
    );
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('可以清空 RuntimeSession 续链并保留同一运行记录用于 context rollover', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });
    const created = upsertRuntimeSession({
      storylineId: storyline.id,
      hermesProfileId: storyline.hermesProfileId,
      hermesSessionId: 'session-1',
      previousResponseId: 'resp-1',
      reason: 'continue',
    });

    const cleared = clearRuntimeSessionContinuation({
      storylineId: storyline.id,
      hermesProfileId: storyline.hermesProfileId,
      reason: 'context_rollover',
    });

    assert.equal(cleared.id, created.id);
    assert.equal(cleared.hermesSessionId, undefined);
    assert.equal(cleared.previousResponseId, undefined);
    assert.equal(cleared.reason, 'context_rollover');
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('RuntimeSession 按 Storyline 保存并更新 Hermes 续聊状态', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });

    const created = upsertRuntimeSession({
      storylineId: storyline.id,
      hermesProfileId: storyline.hermesProfileId,
      hermesSessionId: 'session-1',
      previousResponseId: 'resp-1',
      reason: 'storyline_start',
    });
    const updated = upsertRuntimeSession({
      storylineId: storyline.id,
      hermesProfileId: storyline.hermesProfileId,
      hermesSessionId: 'session-1',
      previousResponseId: 'resp-2',
      reason: 'continue',
    });

    assert.equal(updated.id, created.id);
    assert.equal(getRuntimeSessionForStoryline(storyline.id)?.previousResponseId, 'resp-2');
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('可以显式切换 active Storyline', () => {
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
      title: '重启',
    });

    assert.equal(getActiveStoryline()?.id, second.id);
    assert.equal(setActiveStoryline(first.id)?.id, first.id);
    assert.equal(getActiveStoryline()?.id, first.id);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('可以按 Hermes profile 切换 active Storyline，未找到时清空 active', () => {
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
      title: '重启',
    });

    assert.equal(getActiveStoryline()?.id, second.id);
    assert.equal(getActiveStorylineForProfile(first.hermesProfileId)?.id, first.id);
    assert.equal(setActiveStorylineForProfile(first.hermesProfileId)?.id, first.id);
    assert.equal(getActiveStoryline()?.id, first.id);
    assert.equal(setActiveStorylineForProfile('missing-profile'), undefined);
    assert.equal(getActiveStoryline(), undefined);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});
