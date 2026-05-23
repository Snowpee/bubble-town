import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deleteSession, getSessionDetail, getSessionIdForResponse, getSessionSummary, listSessions } from './session-store.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-session-store-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
}

test('会话列表使用 Hermes 原生 sessionId 去重，并保留兼容别名', () => {
  const hermesHome = createHermesHome();

  try {
    fs.writeFileSync(
      path.join(hermesHome, 'sessions', 'session_local-session.json'),
      `${JSON.stringify(
        {
          conversation: 'conv-session',
          session_id: 'native-session',
          platform: 'api-server',
          session_start: '2026-05-16T10:00:00.000Z',
          last_updated: '2026-05-16T10:05:00.000Z',
          message_count: 2,
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: '你好',
              created_at: '2026-05-16T10:00:00.000Z',
            },
            {
              id: 'm2',
              role: 'assistant',
              content: '世界',
              created_at: '2026-05-16T10:05:00.000Z',
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const db = new DatabaseSync(path.join(hermesHome, 'state.db'));
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        message_count INTEGER NOT NULL,
        title TEXT
      );
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        timestamp INTEGER NOT NULL
      );
    `);
    db.prepare('INSERT INTO sessions (id, source, started_at, ended_at, message_count, title) VALUES (?, ?, ?, ?, ?, ?)')
      .run('local-session', 'state-db', 1_715_853_600, 1_715_853_900, 2, '数据库标题');
    db.prepare('INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)')
      .run(1, 'local-session', 'assistant', '来自数据库的预览', 1_715_853_900);
    db.close();

    const responseStoreDb = new DatabaseSync(path.join(hermesHome, 'response_store.db'));
    responseStoreDb.exec(`
      CREATE TABLE responses (
        response_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        accessed_at REAL NOT NULL
      );
    `);
    responseStoreDb.prepare('INSERT INTO responses (response_id, data, accessed_at) VALUES (?, ?, ?)')
      .run(
        'resp_native_latest',
        JSON.stringify({
          session_id: 'native-session',
          response: {
            id: 'resp_native_latest',
            created: 1_715_853_901,
          },
        }),
        1_715_853_901,
      );
    responseStoreDb.close();

    const sessions = listSessions();
    const compatibilitySummary = sessions[0] as { conversation?: string; id?: string } | undefined;

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.sessionId, 'native-session');
    assert.equal(sessions[0]?.responseId, 'resp_native_latest');
    assert.equal(compatibilitySummary?.conversation, 'native-session');
    assert.equal(compatibilitySummary?.id, 'native-session');
    assert.equal(sessions[0]?.title, '数据库标题');
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('详情接口支持 sessionId 与旧别名读取同一会话', () => {
  const hermesHome = createHermesHome();

  try {
    fs.writeFileSync(
      path.join(hermesHome, 'sessions', 'session_local-session.json'),
      `${JSON.stringify(
        {
          conversation: 'conv-session',
          session_id: 'native-session',
          platform: 'api-server',
          session_start: '2026-05-16T10:00:00.000Z',
          last_updated: '2026-05-16T10:05:00.000Z',
          message_count: 2,
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: '第一条',
              created_at: '2026-05-16T10:00:00.000Z',
            },
            {
              id: 'm2',
              role: 'assistant',
              content: '第二条',
              created_at: '2026-05-16T10:05:00.000Z',
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const canonicalDetail = getSessionDetail('native-session');
    const legacyDetail = getSessionDetail('conv-session');
    const fileAliasDetail = getSessionDetail('local-session');

    assert.ok(canonicalDetail);
    assert.ok(legacyDetail);
    assert.ok(fileAliasDetail);
    assert.equal(canonicalDetail?.summary.sessionId, 'native-session');
    assert.equal(legacyDetail?.summary.sessionId, 'native-session');
    assert.equal(fileAliasDetail?.summary.sessionId, 'native-session');
    assert.deepEqual(
      canonicalDetail?.messages.map((message) => message.content),
      ['第一条', '第二条'],
    );
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('详情接口读取 legacy Hermes transcript 时清洗 BubbleTownContextPack', () => {
  const hermesHome = createHermesHome();

  try {
    fs.writeFileSync(
      path.join(hermesHome, 'sessions', 'session_legacy-contextpack.json'),
      `${JSON.stringify(
        {
          session_id: 'legacy-contextpack',
          platform: 'api-server',
          session_start: '2026-05-16T10:00:00.000Z',
          last_updated: '2026-05-16T10:05:00.000Z',
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: '<BubbleTownContextPack>\\nactivityLogs:\\n- 旧上下文\\n</BubbleTownContextPack>\\n\\n<UserMessage>真实用户消息</UserMessage>',
              created_at: '2026-05-16T10:00:00.000Z',
            },
            {
              id: 'm2',
              role: 'assistant',
              content: '角色回复',
              created_at: '2026-05-16T10:05:00.000Z',
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const detail = getSessionDetail('legacy-contextpack');

    assert.deepEqual(
      detail?.messages.map((message) => message.content),
      ['真实用户消息', '角色回复'],
    );
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('未指定 profile 时只读取 default 会话，不跨 profile 匹配', () => {
  const hermesHome = createHermesHome();

  try {
    const samiSessionsDir = path.join(hermesHome, 'profiles', 'sami', 'sessions');
    fs.mkdirSync(samiSessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(samiSessionsDir, 'session_sami-only.json'),
      `${JSON.stringify(
        {
          session_id: 'sami-only',
          platform: 'api-server',
          session_start: '2026-05-16T10:00:00.000Z',
          last_updated: '2026-05-16T10:05:00.000Z',
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: '来自 sami profile',
              created_at: '2026-05-16T10:00:00.000Z',
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    assert.equal(getSessionSummary('sami-only'), undefined);
    assert.equal(getSessionDetail('sami-only'), undefined);
    assert.equal(deleteSession('sami-only'), false);
    assert.equal(getSessionSummary('sami-only', 'sami')?.profileId, 'sami');
    assert.equal(getSessionDetail('sami-only', 'sami')?.messages[0]?.content, '来自 sami profile');
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('会话摘要消息数仅统计用户可见消息', () => {
  const hermesHome = createHermesHome();

  try {
    fs.writeFileSync(
      path.join(hermesHome, 'sessions', 'session_visible-count.json'),
      `${JSON.stringify(
        {
          session_id: 'visible-count',
          platform: 'api-server',
          session_start: '2026-05-16T10:00:00.000Z',
          last_updated: '2026-05-16T10:05:00.000Z',
          message_count: 4,
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: '用户消息',
              created_at: '2026-05-16T10:00:00.000Z',
            },
            {
              id: 'm2',
              role: 'tool',
              content: '{"title":"搜索中"}',
              created_at: '2026-05-16T10:01:00.000Z',
            },
            {
              id: 'm3',
              role: 'assistant',
              content: '助手回复',
              created_at: '2026-05-16T10:02:00.000Z',
            },
            {
              id: 'm4',
              role: 'tool',
              content: '{"status":"done"}',
              created_at: '2026-05-16T10:03:00.000Z',
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const summary = getSessionSummary('visible-count');

    assert.equal(summary?.messageCount, 2);
    assert.equal(summary?.lastMessagePreview, '助手回复');
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('删除会话会清理 Hermes transcript、state.db 与 response_store 记录', () => {
  const hermesHome = createHermesHome();

  try {
    fs.writeFileSync(
      path.join(hermesHome, 'sessions', 'session_native-delete.json'),
      `${JSON.stringify(
        {
          session_id: 'native-delete',
          conversation: 'conv-delete',
          platform: 'api-server',
          session_start: '2026-05-16T10:00:00.000Z',
          last_updated: '2026-05-16T10:05:00.000Z',
          message_count: 2,
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: '请删除这个会话',
              created_at: '2026-05-16T10:00:00.000Z',
            },
            {
              id: 'm2',
              role: 'assistant',
              content: '收到',
              created_at: '2026-05-16T10:05:00.000Z',
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(hermesHome, 'sessions', 'session_conv-delete.json'),
      `${JSON.stringify(
        {
          session_id: 'native-delete',
          conversation: 'conv-delete',
          platform: 'api-server-responses',
          session_start: '2026-05-16T10:06:00.000Z',
          last_updated: '2026-05-16T10:07:00.000Z',
          message_count: 1,
          messages: [
            {
              id: 'm3',
              role: 'assistant',
              content: '我是平行 transcript',
              created_at: '2026-05-16T10:07:00.000Z',
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const db = new DatabaseSync(path.join(hermesHome, 'state.db'));
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        message_count INTEGER NOT NULL,
        title TEXT
      );
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        timestamp INTEGER NOT NULL
      );
    `);
    db.prepare('INSERT INTO sessions (id, source, started_at, ended_at, message_count, title) VALUES (?, ?, ?, ?, ?, ?)')
      .run('native-delete', 'state-db', 1_715_853_600, 1_715_853_900, 2, '待删除会话');
    db.prepare('INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)')
      .run(1, 'native-delete', 'assistant', '数据库消息', 1_715_853_900);
    db.close();

    const responseStoreDb = new DatabaseSync(path.join(hermesHome, 'response_store.db'));
    responseStoreDb.exec(`
      CREATE TABLE responses (
        response_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        accessed_at REAL NOT NULL
      );
    `);
    responseStoreDb.prepare('INSERT INTO responses (response_id, data, accessed_at) VALUES (?, ?, ?)')
      .run(
        'resp-delete',
        JSON.stringify({
          session_id: 'native-delete',
          response: {
            id: 'resp-delete',
            created: 1_715_853_901,
          },
        }),
        1_715_853_901,
      );
    responseStoreDb.close();

    assert.equal(deleteSession('native-delete'), true);
    assert.equal(fs.existsSync(path.join(hermesHome, 'sessions', 'session_native-delete.json')), false);
    assert.equal(fs.existsSync(path.join(hermesHome, 'sessions', 'session_conv-delete.json')), false);
    assert.deepEqual(listSessions(), []);
    assert.equal(getSessionSummary('native-delete'), undefined);
    assert.equal(getSessionDetail('native-delete'), undefined);
    assert.equal(getSessionIdForResponse('resp-delete'), undefined);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('标题更新只改变 summary.title，不改变原生 sessionId 身份', () => {
  const hermesHome = createHermesHome();

  try {
    fs.writeFileSync(
      path.join(hermesHome, 'sessions', 'session_conv-title.json'),
      `${JSON.stringify(
        {
          conversation: 'conv-title',
          session_id: 'native-title',
          platform: 'api-server',
          session_start: '2026-05-16T10:00:00.000Z',
          last_updated: '2026-05-16T10:01:00.000Z',
          message_count: 2,
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: '请帮我规划东京三日游',
              created_at: '2026-05-16T10:00:00.000Z',
            },
            {
              id: 'm2',
              role: 'assistant',
              content: '可以，我们先看行程结构。',
              created_at: '2026-05-16T10:01:00.000Z',
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const beforeTitle = getSessionSummary('native-title');
    assert.equal(beforeTitle?.sessionId, 'native-title');
    assert.equal(beforeTitle?.title, '请帮我规划东京三日游');
    assert.equal(getSessionSummary('conv-title'), undefined);

    const db = new DatabaseSync(path.join(hermesHome, 'state.db'));
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        message_count INTEGER NOT NULL,
        title TEXT
      );
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        timestamp INTEGER NOT NULL
      );
    `);
    db.prepare('INSERT INTO sessions (id, source, started_at, ended_at, message_count, title) VALUES (?, ?, ?, ?, ?, ?)')
      .run('native-title', 'state-db', 1_715_853_600, 1_715_853_660, 2, '东京三日游规划');
    db.close();

    const afterTitle = getSessionSummary('native-title');
    const compatibilitySummary = afterTitle as { conversation?: string; id?: string } | undefined;
    assert.equal(afterTitle?.sessionId, 'native-title');
    assert.equal(compatibilitySummary?.conversation, 'native-title');
    assert.equal(compatibilitySummary?.id, 'native-title');
    assert.equal(afterTitle?.title, '东京三日游规划');
    assert.equal(getSessionSummary('conv-title'), undefined);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('会话列表以 state.db 记录作为 Hermes 权威会话来源', () => {
  const hermesHome = createHermesHome();

  try {
    fs.writeFileSync(
      path.join(hermesHome, 'sessions', 'session_conv-stable.json'),
      `${JSON.stringify(
        {
          conversation: 'conv-stable',
          session_id: 'native-stable',
          platform: 'api-server-responses',
          session_start: '2026-05-16T10:00:00.000Z',
          last_updated: '2026-05-16T10:05:00.000Z',
          message_count: 2,
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: '你好',
              created_at: '2026-05-16T10:00:00.000Z',
            },
            {
              id: 'm2',
              role: 'assistant',
              content: '你好，有什么可以帮你？',
              created_at: '2026-05-16T10:05:00.000Z',
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const db = new DatabaseSync(path.join(hermesHome, 'state.db'));
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        message_count INTEGER NOT NULL,
        title TEXT
      );
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        timestamp INTEGER NOT NULL
      );
    `);
    db.prepare('INSERT INTO sessions (id, source, started_at, ended_at, message_count, title) VALUES (?, ?, ?, ?, ?, ?)')
      .run('9ab680c9-eb04-4199-a81c-390da9ccfb71', 'api_server', 1_715_853_600, 1_715_853_900, 2, '数据库标题');
    db.close();

    const sessions = listSessions();

    assert.deepEqual(
      sessions.map((session) => session.sessionId).sort(),
      ['9ab680c9-eb04-4199-a81c-390da9ccfb71', 'native-stable'],
    );
    const dbOnlySession = sessions.find((session) => session.sessionId === '9ab680c9-eb04-4199-a81c-390da9ccfb71');
    assert.equal(dbOnlySession?.title, '数据库标题');
    assert.equal(dbOnlySession?.source, 'api_server');
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('会话列表与详情忽略没有 Hermes 原生 sessionId 的 resp_* transcript 文件', () => {
  const hermesHome = createHermesHome();

  try {
    fs.writeFileSync(
      path.join(hermesHome, 'sessions', 'session_resp_orphan.json'),
      `${JSON.stringify(
        {
          response_id: 'resp_orphan',
          platform: 'api-server-responses',
          session_start: '2026-05-16T10:00:00.000Z',
          last_updated: '2026-05-16T10:01:00.000Z',
          message_count: 2,
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: '这是一条孤立响应',
              created_at: '2026-05-16T10:00:00.000Z',
            },
            {
              id: 'm2',
              role: 'assistant',
              content: '不应作为正式会话暴露',
              created_at: '2026-05-16T10:01:00.000Z',
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    fs.writeFileSync(
      path.join(hermesHome, 'sessions', 'session_native-visible.json'),
      `${JSON.stringify(
        {
          session_id: 'native-visible',
          platform: 'api-server',
          session_start: '2026-05-16T11:00:00.000Z',
          last_updated: '2026-05-16T11:02:00.000Z',
          message_count: 2,
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: '保留这条原生会话',
              created_at: '2026-05-16T11:00:00.000Z',
            },
            {
              id: 'm2',
              role: 'assistant',
              content: '列表里只应看到我',
              created_at: '2026-05-16T11:02:00.000Z',
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    assert.deepEqual(
      listSessions().map((session) => session.sessionId),
      ['native-visible'],
    );
    assert.equal(getSessionSummary('resp_orphan'), undefined);
    assert.equal(getSessionDetail('resp_orphan'), undefined);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});

test('会话发现忽略 conv_/resp_ 平行文件，但保留 session_id 一致的 Hermes 原生 session', () => {
  const hermesHome = createHermesHome();

  try {
    fs.writeFileSync(
      path.join(hermesHome, 'sessions', 'session_conv_native.json'),
      `${JSON.stringify(
        {
          session_id: 'conv_native',
          platform: 'api-server',
          session_start: '2026-05-16T12:00:00.000Z',
          last_updated: '2026-05-16T12:05:00.000Z',
          message_count: 2,
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: '这是原生会话',
              created_at: '2026-05-16T12:00:00.000Z',
            },
            {
              id: 'm2',
              role: 'assistant',
              content: '请继续在这里续聊',
              created_at: '2026-05-16T12:05:00.000Z',
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    fs.writeFileSync(
      path.join(hermesHome, 'sessions', 'session_conv_shadow.json'),
      `${JSON.stringify(
        {
          session_id: 'conv_native',
          conversation: 'conv_shadow',
          platform: 'api-server-responses',
          session_start: '2026-05-16T12:06:00.000Z',
          last_updated: '2026-05-16T12:10:00.000Z',
          message_count: 2,
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: '这是一份旧平行文件',
              created_at: '2026-05-16T12:06:00.000Z',
            },
            {
              id: 'm2',
              role: 'assistant',
              content: '不应覆盖原生会话内容',
              created_at: '2026-05-16T12:10:00.000Z',
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    fs.writeFileSync(
      path.join(hermesHome, 'sessions', 'session_resp_shadow.json'),
      `${JSON.stringify(
        {
          response_id: 'resp_shadow',
          platform: 'api-server-responses',
          session_start: '2026-05-16T12:11:00.000Z',
          last_updated: '2026-05-16T12:12:00.000Z',
          message_count: 1,
          messages: [
            {
              id: 'm1',
              role: 'assistant',
              content: '我也不应进入列表',
              created_at: '2026-05-16T12:12:00.000Z',
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    assert.deepEqual(
      listSessions().map((session) => session.sessionId),
      ['conv_native'],
    );

    const nativeDetail = getSessionDetail('conv_native');
    assert.ok(nativeDetail);
    assert.deepEqual(
      nativeDetail?.messages.map((message) => message.content),
      ['这是原生会话', '请继续在这里续聊'],
    );
    assert.equal(getSessionSummary('conv_shadow'), undefined);
    assert.equal(getSessionDetail('resp_shadow'), undefined);
  } finally {
    cleanupHermesHome(hermesHome);
  }
});
