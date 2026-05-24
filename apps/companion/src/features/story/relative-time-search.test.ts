import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createActivityLog, createCharacter, createStoryline, resetStoryRuntimeForTests } from '../../store/story-runtime-store.js';
import { getStorylineRuntimeContext } from '../../services/runtime-service.js';
import { buildTimeContext } from './context-pack.js';
import { searchRelativeTimeInRuntimeContext } from './relative-time-search.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-relative-time-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  resetStoryRuntimeForTests();
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('searchRelativeTimeInRuntimeContext 复用预加载 runtimeContext 执行相对时间检索', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '相对时间检索',
    });
    const time = buildTimeContext();
    createActivityLog(storyline.id, {
      happenedAt: new Date(new Date(time.yesterday[0]).getTime() + 60 * 60 * 1000).toISOString(),
      timezone: time.timezone,
      summary: '昨天用户和 Sami 约好晚饭后去散步。',
      tags: ['test'],
    });

    const runtimeContext = getStorylineRuntimeContext(storyline.id);
    assert.ok(runtimeContext);

    const results = searchRelativeTimeInRuntimeContext(runtimeContext, '昨天我们约了什么？', time);

    assert.equal(results.length, 1);
    assert.equal(results[0]?.reference, 'yesterday');
    assert.equal(results[0]?.hit, true);
    assert.deepEqual(
      results[0]?.activityLogs.map((entry) => entry.summary),
      ['昨天用户和 Sami 约好晚饭后去散步。'],
    );
  } finally {
    cleanupHermesHome(hermesHome);
  }
});
