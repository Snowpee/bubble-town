import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createCharacter,
  createStoryline,
  getRuntimeSessionForStoryline,
  listAllActivityLogs,
  resetStoryRuntimeForTests,
  upsertRuntimeSession,
} from '../../store/story-runtime-store.js';
import { evaluateStorySessionRollover, rolloverStoryRuntimeSessionIfNeeded } from './story-session-rollover.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-rollover-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'profiles', 'sami-story-001', 'sessions'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  resetStoryRuntimeForTests();
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

function writeTranscript(hermesHome: string, messageCount: number) {
  fs.writeFileSync(
    path.join(hermesHome, 'profiles', 'sami-story-001', 'sessions', 'session_old-session.json'),
    `${JSON.stringify({
      session_id: 'old-session',
      session_start: new Date(Date.now() - 8 * 86_400_000).toISOString(),
      last_updated: new Date().toISOString(),
      message_count: messageCount,
      messages: Array.from({ length: messageCount }, (_, index) => ({
        id: `m-${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `消息 ${index}`,
        created_at: new Date().toISOString(),
      })),
    })}\n`,
    'utf8',
  );
}

test('evaluateStorySessionRollover 在消息数超过阈值时要求滚动', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });
    const runtimeSession = upsertRuntimeSession({
      storylineId: storyline.id,
      hermesProfileId: storyline.hermesProfileId,
      hermesSessionId: 'old-session',
      previousResponseId: 'resp-old',
      reason: 'continue',
    });
    writeTranscript(hermesHome, 5);

    const decision = evaluateStorySessionRollover(storyline, runtimeSession, { maxMessages: 5, maxAgeDays: 30 });

    assert.equal(decision.shouldRollover, true);
    assert.equal(decision.reason, 'message_count');
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('rolloverStoryRuntimeSessionIfNeeded 写入归档 ActivityLog 并清空续链', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });
    const runtimeSession = upsertRuntimeSession({
      storylineId: storyline.id,
      hermesProfileId: storyline.hermesProfileId,
      hermesSessionId: 'old-session',
      previousResponseId: 'resp-old',
      reason: 'continue',
    });
    writeTranscript(hermesHome, 6);

    const next = rolloverStoryRuntimeSessionIfNeeded(storyline, runtimeSession, { maxMessages: 5, maxAgeDays: 30 });

    assert.equal(next?.reason, 'context_rollover');
    assert.equal(next?.hermesSessionId, undefined);
    assert.equal(getRuntimeSessionForStoryline(storyline.id)?.previousResponseId, undefined);
    assert.match(listAllActivityLogs(storyline.id)[0]?.summary ?? '', /old-session/);
    assert.equal(fs.existsSync(path.join(hermesHome, 'profiles', 'sami-story-001', 'sessions', 'session_old-session.json')), true);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});
