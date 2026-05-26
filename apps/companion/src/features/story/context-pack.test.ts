import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildContextPack, buildTimeContext, renderContextPackInstructions } from './context-pack.js';
import { recordStorylineTurnContinuity } from './story-memory-continuity.js';
import {
  createActivityLog,
  createCharacter,
  createMemoryRecord,
  createStoryline,
  createSuppressedMemory,
  listAllMemoryRecords,
  resetStoryRuntimeForTests,
  updateActivityLog,
  updateMemoryRecord,
  touchStorylineInteraction,
  upsertRuntimeSession,
} from '../../store/story-runtime-store.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-context-pack-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  resetStoryRuntimeForTests();
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('TimeContext 生成相对时间范围和 elapsedSinceLastInteraction', () => {
  const time = buildTimeContext(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), 'UTC');

  assert.equal(time.timezone, 'UTC');
  assert.match(time.localNow, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.match(time.localDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(time.localTime, /^\d{2}:\d{2}$/);
  assert.match(time.today[0], /T00:00:00\.000Z$/);
  assert.match(time.yesterday[0], /T00:00:00\.000Z$/);
  assert.equal(time.today.length, 2);
  assert.equal(time.yesterday.length, 2);
  assert.equal(time.dayBeforeYesterday.length, 2);
  assert.match(time.elapsedSinceLastInteraction ?? '', /小时|分钟/);
});

test('ContextPack 只包含当前 Storyline 基础信息并可渲染 instructions', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });
    const contextPack = buildContextPack(storyline.id);
    const rendered = renderContextPackInstructions(contextPack);

    assert.equal(contextPack.storylineId, storyline.id);
    assert.equal(contextPack.characterId, character.id);
    assert.equal(contextPack.hermesProfileId, storyline.hermesProfileId);
    assert.equal(contextPack.memories.length, 0);
    assert.match(rendered, /BubbleTownContextPack/);
    assert.match(rendered, new RegExp(storyline.id));
    assert.match(rendered, /localNow: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    assert.match(rendered, /localTime: \d{2}:\d{2}/);
    assert.match(rendered, /authoritative_time/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('ContextPack 根据输入注入相对时间检索命中结果', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });
    const yesterday = buildTimeContext().yesterday[0];
    createActivityLog(storyline.id, {
      happenedAt: new Date(new Date(yesterday).getTime() + 60 * 60 * 1000).toISOString(),
      timezone: buildTimeContext().timezone,
      summary: '昨天用户和 Sami 约定晚饭后散步。',
      tags: ['test'],
    });

    const contextPack = buildContextPack(storyline.id, { input: '昨天我们约定了什么？' });
    const rendered = renderContextPackInstructions(contextPack);

    assert.equal(contextPack.relativeTimeResults.length, 1);
    assert.equal(contextPack.relativeTimeResults[0]?.hit, true);
    assert.match(rendered, /昨天用户和 Sami 约定晚饭后散步/);
    assert.match(rendered, /relative_time_hit/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('ContextPack 相对时间召回会严格按时间窗口并过滤 suppressed 主题', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });
    const time = buildTimeContext();
    const insideLastNight = new Date(new Date(time.lastNight[0]).getTime() + 60 * 60 * 1000).toISOString();
    const alsoInsideLastNight = new Date(new Date(time.lastNight[0]).getTime() + 2 * 60 * 60 * 1000).toISOString();
    const outsideLastNight = new Date(new Date(time.lastNight[1]).getTime() + 8 * 60 * 60 * 1000).toISOString();

    createSuppressedMemory(storyline.id, { pattern: '不要主动再提起上次整理 Skill 的事情' });
    createActivityLog(storyline.id, {
      happenedAt: insideLastNight,
      timezone: time.timezone,
      summary: '检查了飞书技能，确认 24 个 lark 技能都装好了。',
      tags: ['test'],
    });
    createActivityLog(storyline.id, {
      happenedAt: alsoInsideLastNight,
      timezone: time.timezone,
      summary: '看了几张凌晨截图，确认 Seedance 页面和比价内容。',
      tags: ['test'],
    });
    createActivityLog(storyline.id, {
      happenedAt: outsideLastNight,
      timezone: time.timezone,
      summary: '用户提到「不要主动再提起上次整理 Skill 的事情」。',
      tags: ['test'],
    });

    const contextPack = buildContextPack(storyline.id, { input: '昨天晚上我们做了哪些工作？' });
    const rendered = renderContextPackInstructions(contextPack);

    assert.equal(contextPack.relativeTimeResults.length, 1);
    assert.equal(contextPack.relativeTimeResults[0]?.hit, true);
    assert.deepEqual(
      contextPack.relativeTimeResults[0]?.activityLogs.map((entry) => entry.summary),
      ['看了几张凌晨截图，确认 Seedance 页面和比价内容。'],
    );
    assert.match(rendered, /Seedance 页面/);
    assert.doesNotMatch(rendered, /飞书技能/);
    assert.doesNotMatch(rendered, /整理 Skill/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('ContextPack 只在用户明确询问 suppression 时披露原始边界', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });
    createSuppressedMemory(storyline.id, { pattern: '不要主动再提起上次整理 Skill 的事情' });

    const passivePreview = buildContextPack(storyline.id, { input: '昨天晚上我们做了哪些工作？' });
    const passiveRendered = renderContextPackInstructions(passivePreview);
    const directPreview = buildContextPack(storyline.id, { input: '我刚才说不要主动提什么事情？' });
    const directRendered = renderContextPackInstructions(directPreview);

    assert.equal(passivePreview.suppressionDisclosureAllowed, false);
    assert.doesNotMatch(passiveRendered, /整理 Skill/);
    assert.equal(directPreview.suppressionDisclosureAllowed, true);
    assert.match(directRendered, /整理 Skill/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('ContextPack 始终注入当前 session 边界锚点', () => {
  const hermesHome = createHermesHome();

  try {
    const profileId = 'sami-story-001';
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: profileId,
      title: '初遇',
    });
    upsertRuntimeSession({
      storylineId: storyline.id,
      hermesProfileId: profileId,
      hermesSessionId: 'opening-session',
      previousResponseId: 'resp-opening',
      reason: 'continue',
    });

    const sessionsDir = path.join(hermesHome, 'profiles', profileId, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, 'session_opening-session.json'),
      `${JSON.stringify({
        session_id: 'opening-session',
        session_start: '2026-05-21T00:00:00.000Z',
        messages: [
          {
            role: 'user',
            content: 'hi',
          },
          {
            role: 'assistant',
            content: '这么晚还不睡呀~',
          },
          ...Array.from({ length: 14 }, (_, index) => ({
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `后续消息 ${index + 1}`,
          })),
        ],
      })}\n`,
      'utf8',
    );

    const contextPack = buildContextPack(storyline.id);
    const rendered = renderContextPackInstructions(contextPack);

    assert.notEqual(contextPack.recentMessages[0]?.content, 'hi');
    assert.equal(contextPack.sessionAnchors.messageCount, 16);
    assert.equal(contextPack.sessionAnchors.firstUserMessage?.content, 'hi');
    assert.equal(contextPack.sessionAnchors.firstAssistantMessage?.content, '这么晚还不睡呀~');
    assert.equal(contextPack.sessionAnchors.latestAssistantMessage?.content, '后续消息 14');
    assert.match(rendered, /sessionAnchors:/);
    assert.match(rendered, /firstUserMessage: \[local .*; utc .*] \[user\] hi/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('ContextPack 在跨天时显式提示短时现场事实不能默认延续，并为 recentMessages 标注时间', () => {
  const hermesHome = createHermesHome();

  try {
    const profileId = 'sami-story-001';
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: profileId,
      title: '跨天时间感知',
    });
    touchStorylineInteraction(storyline.id, new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString());
    upsertRuntimeSession({
      storylineId: storyline.id,
      hermesProfileId: profileId,
      hermesSessionId: 'cross-day-session',
      previousResponseId: 'resp-cross-day',
      reason: 'continue',
    });

    const sessionsDir = path.join(hermesHome, 'profiles', profileId, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, 'session_cross-day-session.json'),
      `${JSON.stringify({
        session_id: 'cross-day-session',
        session_start: '2026-05-24T06:20:00.000Z',
        messages: [
          {
            role: 'user',
            content: '下雨了',
            created_at: '2026-05-24T06:26:55.765Z',
          },
          {
            role: 'assistant',
            content: '听雨声很适合在家休息。',
            created_at: '2026-05-24T06:27:10.000Z',
          },
          {
            role: 'user',
            content: '我回来了，包还在，手机丢了。',
            created_at: '2026-05-25T07:00:00.000Z',
          },
        ],
      })}\n`,
      'utf8',
    );

    const contextPack = buildContextPack(storyline.id, { input: '我回来了，包还在，手机丢了。' });
    const rendered = renderContextPackInstructions(contextPack);

    assert.equal(contextPack.continuityMode, 'new_day');
    assert.match(rendered, /跨天后，历史消息里提到的天气、昼夜、位置、正在做的事、手上物品或设备状态，只能视为当时成立/);
    assert.match(rendered, /如果历史消息与当前权威时间存在跨天或明显时间间隔，天气、昼夜、位置、正在进行中的动作、随身物品和设备状态等短时现场事实不能默认延续到现在/);
    assert.match(rendered, /sceneProjection 只表示当前场景里最后确认且仍稳定成立的重要物品状态；它不能替代 activity timeline，也不能直接回答“事情是什么时候发生的”/);
    assert.match(rendered, /recentMessages:\n(?:- .*\n)*- \[local .*; utc 2026-05-24T06:26:55.765Z] \[user\] 下雨了/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('ContextPack 在时间追问时显式要求优先依据带时间戳上下文回答', () => {
  const hermesHome = createHermesHome();

  try {
    const profileId = 'sami-story-001';
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: profileId,
      title: '时间追问',
    });
    upsertRuntimeSession({
      storylineId: storyline.id,
      hermesProfileId: profileId,
      hermesSessionId: 'temporal-follow-up',
      previousResponseId: 'resp-temporal-follow-up',
      reason: 'continue',
    });

    const sessionsDir = path.join(hermesHome, 'profiles', profileId, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, 'session_temporal-follow-up.json'),
      `${JSON.stringify({
        session_id: 'temporal-follow-up',
        session_start: '2026-05-24T06:20:00.000Z',
        messages: [
          {
            role: 'user',
            content: '我手机放门卫那里了',
            created_at: '2026-05-24T06:26:55.765Z',
          },
          {
            role: 'user',
            content: '我回来了，包还在，手机丢了。',
            created_at: '2026-05-25T07:00:00.000Z',
          },
        ],
      })}\n`,
      'utf8',
    );

    const contextPack = buildContextPack(storyline.id, { input: '你再想想是什么时候我说手机丢的' });
    const rendered = renderContextPackInstructions(contextPack);

    assert.match(rendered, /当用户追问“什么时候”“昨天还是今天”“刚才哪一轮说的”时，优先根据 activityLogs、recentMessages、sessionAnchors 的时间戳还原事件顺序/);
    assert.match(rendered, /如果用户追问某件事是什么时候发生的、昨天还是今天，优先依据 activityLogs、recentMessages 和 sessionAnchors 里的时间戳还原事件顺序/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('ContextPack 在长间隔后禁止评论用户突然切换话题', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });
    touchStorylineInteraction(storyline.id, new Date(Date.now() - 20 * 60_000).toISOString());

    const contextPack = buildContextPack(storyline.id, { input: '如何区分天牛和蟑螂？' });
    const rendered = renderContextPackInstructions(contextPack);

    assert.equal(contextPack.conversationPacing.topicShiftCommentAllowed, false);
    assert.match(rendered, /视为自然开启的新话题/);
    assert.match(rendered, /不要评论/);
    assert.match(rendered, /话题突然/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('自动连续性记录不会把问句写成长期记忆', async () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });

    await recordStorylineTurnContinuity({
      storyline,
      userInput: '还记得我第一次和你打招呼说了什么吗',
      assistantOutput: '我再看看当前会话。',
      sourceMessageIds: ['session-1', 'resp-1'],
    });

    assert.deepEqual(listAllMemoryRecords(storyline.id), []);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('ContextPack 注入当前 Storyline active 记忆、活动日志和抑制规则，并过滤隐藏项', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
    });
    createMemoryRecord(storyline.id, { content: '用户喜欢晚饭后散步。' });
    const hiddenMemory = createMemoryRecord(storyline.id, { content: '不应该注入的隐藏记忆。' });
    updateMemoryRecord(hiddenMemory.id, { status: 'hidden' });
    createSuppressedMemory(storyline.id, { pattern: '不要主动提昨晚争吵。' });
    createActivityLog(storyline.id, { summary: '用户和 Sami 晚饭后短暂聊天。', tags: ['daily'] });
    const hiddenActivity = createActivityLog(storyline.id, { summary: '不应该注入的隐藏活动。' });
    updateActivityLog(hiddenActivity.id, { status: 'hidden' });

    const contextPack = buildContextPack(storyline.id);
    const rendered = renderContextPackInstructions(contextPack);

    assert.deepEqual(contextPack.memories.map((memory) => memory.content), ['用户喜欢晚饭后散步。']);
    assert.deepEqual(contextPack.suppressedMemories.map((memory) => memory.pattern), ['不要主动提昨晚争吵。']);
    assert.deepEqual(contextPack.activityLogs.map((activity) => activity.summary), ['用户和 Sami 晚饭后短暂聊天。']);
    assert.match(rendered, /用户喜欢晚饭后散步/);
    assert.match(rendered, /suppressed_topic_1/);
    assert.match(rendered, /activityLogs:\n- \[local \d{4}-\d{2}-\d{2} \d{2}:\d{2} .*; utc /);
    assert.doesNotMatch(rendered, /不要主动提昨晚争吵/);
    assert.doesNotMatch(rendered, /隐藏记忆/);
    assert.doesNotMatch(rendered, /隐藏活动/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('ContextPack 额外注入当前场景的 Scene Projection，且不依赖普通记忆检索', () => {
  const hermesHome = createHermesHome();

  try {
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: 'sami-story-001',
      title: '初遇',
      currentSceneId: 'north_window_room',
    });
    createMemoryRecord(storyline.id, {
      content: '旧台灯已经损坏。',
      kind: 'world_object_state',
      worldState: {
        sceneId: 'north_window_room',
        objectId: 'lamp_001',
        objectLabel: '旧台灯',
        stateKind: 'status',
        state: 'broken',
        version: 1,
      },
    });
    createMemoryRecord(storyline.id, {
      content: '南门已经锁好。',
      kind: 'world_object_state',
      worldState: {
        sceneId: 'south_gate',
        objectId: 'gate_001',
        objectLabel: '南门',
        stateKind: 'status',
        state: 'closed',
        version: 1,
      },
    });

    const contextPack = buildContextPack(storyline.id, { input: '我们继续聊刚才的事。' });
    const rendered = renderContextPackInstructions(contextPack);

    assert.equal(contextPack.sceneProjection?.sceneId, 'north_window_room');
    assert.match(contextPack.sceneProjection?.summary ?? '', /旧台灯已经损坏/);
    assert.equal(contextPack.sceneProjection?.items.length, 1);
    assert.equal(contextPack.memories.some((memory) => memory.kind === 'world_object_state'), false);
    assert.match(rendered, /sceneProjection:/);
    assert.match(rendered, /旧台灯已经损坏/);
    assert.doesNotMatch(rendered, /南门已经锁好/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('ContextPack 读取 legacy transcript 时会清洗已注入的 BubbleTownContextPack', () => {
  const hermesHome = createHermesHome();

  try {
    const profileId = 'sami-story-001';
    const character = createCharacter({ name: 'Sami', templateProfileId: 'sami-template' });
    const storyline = createStoryline({
      characterId: character.id,
      hermesProfileId: profileId,
      title: '初遇',
    });
    upsertRuntimeSession({
      storylineId: storyline.id,
      hermesProfileId: profileId,
      hermesSessionId: 'legacy-session',
      previousResponseId: 'resp-legacy',
      reason: 'continue',
    });

    const sessionsDir = path.join(hermesHome, 'profiles', profileId, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, 'session_legacy-session.json'),
      `${JSON.stringify({
        session_id: 'legacy-session',
        session_start: '2026-05-21T00:00:00.000Z',
        messages: [
          {
            role: 'user',
            content: '<BubbleTownContextPack>\\nrecentMessages:\\n- 旧上下文\\n</BubbleTownContextPack>\\n\\n<UserMessage>你好</UserMessage>',
          },
          {
            role: 'assistant',
            content: '我在。',
          },
        ],
      })}\n`,
      'utf8',
    );

    const contextPack = buildContextPack(storyline.id);
    const rendered = renderContextPackInstructions(contextPack);

    assert.deepEqual(contextPack.recentMessages.map((message) => message.content), ['你好', '我在。']);
    assert.doesNotMatch(rendered, /旧上下文/);
    assert.doesNotMatch(rendered, /<UserMessage>/);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});
