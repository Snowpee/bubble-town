import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sendChat, streamChat } from './hermes-api.js';
import { resetManagedHermesGatewayStateForTests, setManagedHermesGatewayProfileForTests } from './hermes-gateway.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-hermes-api-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  return hermesHome;
}

function writeProfileConfig(
  hermesHome: string,
  profileId: string,
  config: {
    modelDefault?: string;
    systemPrompt?: string;
  },
) {
  const profileHome = getProfileHome(hermesHome, profileId);
  fs.mkdirSync(profileHome, { recursive: true });
  const lines = [
    'model:',
    `  default: ${JSON.stringify(config.modelDefault ?? 'hermes-agent')}`,
    'agent:',
    `  system_prompt: ${JSON.stringify(config.systemPrompt ?? '')}`,
  ];
  fs.writeFileSync(path.join(profileHome, 'config.yaml'), `${lines.join('\n')}\n`, 'utf8');
}

function cleanupHermesHome(hermesHome: string) {
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
  delete process.env.HERMES_API_BASE_URL;
}

function getProfileHome(hermesHome: string, profileId = 'default') {
  return profileId === 'default' ? hermesHome : path.join(hermesHome, 'profiles', profileId);
}

function ensureProfileSessionsDir(hermesHome: string, profileId = 'default') {
  fs.mkdirSync(path.join(getProfileHome(hermesHome, profileId), 'sessions'), { recursive: true });
}

function readTranscriptFile(hermesHome: string, cacheKey: string, profileId = 'default') {
  const filePath = path.join(getProfileHome(hermesHome, profileId), 'sessions', `session_${cacheKey}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
    session_id?: string;
    response_id?: string;
    system_prompt?: string;
    messages?: Array<{ role?: string; content?: string }>;
  };
}

function transcriptFileExists(hermesHome: string, cacheKey: string, profileId = 'default') {
  return fs.existsSync(path.join(getProfileHome(hermesHome, profileId), 'sessions', `session_${cacheKey}.json`));
}

function writeResponseStoreEntry(
  hermesHome: string,
  profileId: string,
  input: {
    responseId: string;
    sessionId: string;
    createdAt?: number;
  },
) {
  const profileHome = getProfileHome(hermesHome, profileId);
  fs.mkdirSync(profileHome, { recursive: true });
  const db = new DatabaseSync(path.join(profileHome, 'response_store.db'));
  const createdAt = input.createdAt ?? 1_748_000_000;

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS responses (
        response_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        accessed_at INTEGER NOT NULL
      )
    `);
    db.prepare('INSERT OR REPLACE INTO responses (response_id, data, accessed_at) VALUES (?, ?, ?)')
      .run(
        input.responseId,
        JSON.stringify({
          session_id: input.sessionId,
          response: {
            id: input.responseId,
            created: createdAt,
          },
        }),
        createdAt,
      );
  } finally {
    db.close();
  }
}

function createSseResponse(events: string[], headers?: Record<string, string>) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(event));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        ...(headers ?? { 'X-Hermes-Session-Id': 'native-stream-1' }),
      },
    },
  );
}

test('sendChat 使用响应头里的 Hermes 原生 sessionId，并把 transcript 写到当前 profile', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; payload: Record<string, unknown> }> = [];

  globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    fetchCalls.push({
      url: String(input),
      payload,
    });
    fs.writeFileSync(
      path.join(hermesHome, 'sessions', 'session_d61b8780-5241-4f40-b583-07b05dc5dc29.json'),
      `${JSON.stringify(
        {
          session_id: 'd61b8780-5241-4f40-b583-07b05dc5dc29',
          platform: 'api-server-responses',
          messages: [],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    return new Response(
      JSON.stringify({
        id: 'resp_turn_2',
        model: 'hermes-agent',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: '第二轮回复',
              },
            ],
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Id': 'native-session-123',
        },
      },
    );
  };

  try {
    const response = await sendChat({
      input: '继续说',
      responseId: 'resp_turn_1',
    });

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]?.url, 'http://127.0.0.1:8642/v1/responses');
    assert.deepEqual(fetchCalls[0]?.payload, {
      model: 'hermes-agent',
      input: '继续说',
      stream: false,
      store: true,
      previous_response_id: 'resp_turn_1',
    });

    assert.equal(response.sessionId, 'native-session-123');
    assert.equal(response.conversation, 'native-session-123');
    assert.equal(response.responseId, 'resp_turn_2');
    assert.equal(transcriptFileExists(hermesHome, 'native-session-123'), true);
    assert.deepEqual(readTranscriptFile(hermesHome, 'native-session-123').messages?.map((message) => message.content), ['继续说', '第二轮回复']);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('sendChat 支持把运行时上下文放入 instructions 且 transcript 只保存用户原文', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; payload: Record<string, unknown> }> = [];

  globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    fetchCalls.push({ url: String(input), payload });

    return new Response(
      JSON.stringify({
        id: 'resp-original-input',
        model: 'hermes-agent',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '收到。' }],
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Id': 'native-original-input',
        },
      },
    );
  };

  try {
    const response = await sendChat({
      input: '你好',
      runtimeInstructions: '<BubbleTownContextPack>\nrecentMessages:\n- 无\n</BubbleTownContextPack>',
      transcriptInput: '你好',
    });

    assert.equal(response.sessionId, 'native-original-input');
    assert.equal(fetchCalls[0]?.payload.input, '你好');
    assert.match(String(fetchCalls[0]?.payload.instructions), /BubbleTownContextPack/);
    const transcript = readTranscriptFile(hermesHome, 'native-original-input');
    assert.equal(transcript.messages?.[0]?.role, 'user');
    assert.equal(transcript.messages?.[0]?.content, '你好');
    assert.doesNotMatch(transcript.messages?.[0]?.content ?? '', /BubbleTownContextPack/);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('sendChat 在 Responses responseId 过期时回退到 chat-completions 续同一个 session', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; headers: Record<string, string>; payload: Record<string, unknown> }> = [];

  fs.writeFileSync(
    path.join(hermesHome, 'sessions', 'session_native-session-123.json'),
    `${JSON.stringify(
      {
        session_id: 'native-session-123',
        platform: 'api-server-responses',
        session_start: '2026-05-17T10:13:53.000Z',
        last_updated: '2026-05-17T10:14:25.000Z',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: '第一轮用户消息',
            created_at: '2026-05-17T10:13:53.000Z',
          },
          {
            id: 'm2',
            role: 'assistant',
            content: '第一轮助手回复',
            created_at: '2026-05-17T10:14:25.000Z',
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const headers = init?.headers as Record<string, string>;
    fetchCalls.push({
      url: String(input),
      headers,
      payload,
    });

    if (String(input).endsWith('/responses')) {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Previous response not found: resp_stale',
            type: 'invalid_request_error',
          },
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }

    return new Response(
      JSON.stringify({
        id: 'chatcmpl_turn_2',
        model: 'hermes-agent',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '第二轮回复',
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Id': 'native-session-123',
        },
      },
    );
  };

  try {
    const response = await sendChat({
      input: '继续说',
      sessionId: 'native-session-123',
      responseId: 'resp_stale',
    });

    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[0]?.url, 'http://127.0.0.1:8642/v1/responses');
    assert.deepEqual(fetchCalls[0]?.payload, {
      model: 'hermes-agent',
      input: '继续说',
      stream: false,
      store: true,
      previous_response_id: 'resp_stale',
    });
    assert.equal(fetchCalls[1]?.url, 'http://127.0.0.1:8642/v1/chat/completions');
    assert.equal(fetchCalls[1]?.headers['X-Hermes-Session-Id'], 'native-session-123');
    assert.deepEqual(fetchCalls[1]?.payload.messages, [
      {
        role: 'user',
        content: '第一轮用户消息',
      },
      {
        role: 'assistant',
        content: '第一轮助手回复',
      },
      {
        role: 'user',
        content: '继续说',
      },
    ]);
    assert.equal(response.sessionId, 'native-session-123');
    assert.equal(response.responseId, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('sendChat 在只有 responseId 的续链请求中只写 Hermes 原生 session transcript', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'resp_turn_2',
        model: 'hermes-agent',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: '继续成功',
              },
            ],
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Id': 'native-session-456',
        },
      },
    );

  try {
    const response = await sendChat({
      input: '只给 responseId',
      responseId: 'resp_turn_1',
    });

    assert.equal(response.sessionId, 'native-session-456');
    assert.equal(response.responseId, 'resp_turn_2');
    assert.equal(transcriptFileExists(hermesHome, 'resp_turn_1'), false);
    assert.equal(transcriptFileExists(hermesHome, 'resp_turn_2'), false);
    assert.equal(transcriptFileExists(hermesHome, 'native-session-456'), true);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('sendChat 在 Responses 模式下不把 bare sessionId 当作续链 primitive', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; payload: Record<string, unknown> }> = [];

  globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    fetchCalls.push({
      url: String(input),
      payload,
    });

    return new Response(
      JSON.stringify({
        id: 'resp_turn_2',
        model: 'hermes-agent',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: '新 Responses 会话',
              },
            ],
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Id': 'native-responses-session',
        },
      },
    );
  };

  try {
    const response = await sendChat({
      input: '只有 sessionId',
      sessionId: 'local-session-id',
    });

    assert.equal(fetchCalls.length, 1);
    assert.deepEqual(fetchCalls[0]?.payload, {
      model: 'hermes-agent',
      input: '只有 sessionId',
      stream: false,
      store: true,
    });
    assert.equal(response.sessionId, 'native-responses-session');
    assert.equal(response.responseId, 'resp_turn_2');
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('sendChat 续聊 CLI session 时切到 chat-completions 并使用 X-Hermes-Session-Id', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; headers: Record<string, string>; payload: Record<string, unknown> }> = [];
  setManagedHermesGatewayProfileForTests('default', 'http://127.0.0.1:8642/v1');

  fs.writeFileSync(
    path.join(hermesHome, 'sessions', 'session_20260517_101353_97c367.json'),
    `${JSON.stringify(
      {
        session_id: '20260517_101353_97c367',
        platform: 'cli',
        session_start: '2026-05-17T10:13:53.000Z',
        last_updated: '2026-05-17T10:14:25.000Z',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: '上一轮用户消息',
            created_at: '2026-05-17T10:13:53.000Z',
          },
          {
            id: 'm2',
            role: 'assistant',
            content: '上一轮助手回复',
            created_at: '2026-05-17T10:14:25.000Z',
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const headers = init?.headers as Record<string, string>;
    fetchCalls.push({
      url: String(input),
      headers,
      payload,
    });

    return new Response(
      JSON.stringify({
        id: 'chatcmpl_cli_turn_2',
        model: 'hermes-agent',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '归回 CLI 会话',
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Id': '20260517_101353_97c367',
        },
      },
    );
  };

  try {
    const response = await sendChat({
      input: '继续这条 CLI 会话',
      sessionId: '20260517_101353_97c367',
    });

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]?.url, 'http://127.0.0.1:8642/v1/chat/completions');
    assert.equal(fetchCalls[0]?.headers['X-Hermes-Session-Id'], '20260517_101353_97c367');
    assert.equal(fetchCalls[0]?.headers.Authorization, `Bearer ${process.env.BUBBLE_TOWN_HERMES_API_KEY}`);
    assert.deepEqual(fetchCalls[0]?.payload.messages, [
      {
        role: 'user',
        content: '上一轮用户消息',
      },
      {
        role: 'assistant',
        content: '上一轮助手回复',
      },
      {
        role: 'user',
        content: '继续这条 CLI 会话',
      },
    ]);
    assert.equal(fetchCalls[0]?.payload.previous_response_id, undefined);
    assert.equal(response.sessionId, '20260517_101353_97c367');
  } finally {
    globalThis.fetch = originalFetch;
    resetManagedHermesGatewayStateForTests();
    cleanupHermesHome(hermesHome);
  }
});

test('streamChat 在 Responses 模式下把图片附件编码为 Hermes 支持的 input_image data URL', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; payload: Record<string, unknown> }> = [];

  globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    fetchCalls.push({
      url: String(input),
      payload,
    });

    return createSseResponse([
      `event: response.created
data: ${JSON.stringify({
        type: 'response.created',
        response: {
          id: 'resp_image_1',
          model: 'hermes-agent',
        },
      })}

`,
      `event: response.completed
data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          id: 'resp_image_1',
          model: 'hermes-agent',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: '我看到了图片',
                },
              ],
            },
          ],
        },
      })}

`,
      'data: [DONE]\n\n',
    ]);
  };

  try {
    const result = await streamChat({
      input: '这张图里有什么？',
      attachments: [
        {
          type: 'image',
          url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
          name: 'demo.png',
          mimeType: 'image/png',
        },
      ],
    });

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]?.url, 'http://127.0.0.1:8642/v1/responses');
    assert.deepEqual(fetchCalls[0]?.payload, {
      model: 'hermes-agent',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: '这张图里有什么？',
            },
            {
              type: 'input_image',
              image_url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
            },
          ],
        },
      ],
      stream: true,
      store: true,
    });

    assert.equal(result.output, '我看到了图片');
    assert.equal(result.sessionId, 'native-stream-1');
    assert.equal(transcriptFileExists(hermesHome, 'native-stream-1'), true);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('streamChat 优先使用响应头里的 Hermes 原生 sessionId，并返回当前 turn 的 responseId', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; payload: Record<string, unknown> }> = [];
  const started: Array<{ sessionId: string; responseId?: string }> = [];
  const deltas: string[] = [];

  globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    fetchCalls.push({
      url: String(input),
      payload,
    });

    return createSseResponse([
      `event: response.created
data: ${JSON.stringify({
        type: 'response.created',
        response: {
          id: 'resp_stream_1',
          model: 'hermes-agent',
        },
      })}

`,
      `event: response.output_text.delta
data: ${JSON.stringify({
        type: 'response.output_text.delta',
        delta: '流式',
      })}

`,
      `event: response.output_text.delta
data: ${JSON.stringify({
        type: 'response.output_text.delta',
        delta: '完成',
      })}

`,
      `event: response.completed
data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          id: 'resp_stream_1',
          model: 'hermes-agent',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: '流式完成',
                },
              ],
            },
          ],
        },
      })}

`,
      'data: [DONE]\n\n',
    ]);
  };

  try {
    const result = await streamChat(
      {
        input: '开始吧',
      },
      {
        onStart(event) {
          started.push({
            sessionId: event.sessionId,
            responseId: event.responseId,
          });
        },
        onDelta(delta) {
          deltas.push(delta);
        },
      },
    );

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]?.url, 'http://127.0.0.1:8642/v1/responses');
    assert.deepEqual(fetchCalls[0]?.payload, {
      model: 'hermes-agent',
      input: '开始吧',
      stream: true,
      store: true,
    });

    assert.deepEqual(started, [
      {
        sessionId: 'native-stream-1',
        responseId: undefined,
      },
    ]);
    assert.deepEqual(deltas, ['流式', '完成']);
    assert.equal(result.sessionId, 'native-stream-1');
    assert.equal(result.conversation, 'native-stream-1');
    assert.equal(result.responseId, 'resp_stream_1');
    assert.equal(result.output, '流式完成');
    assert.equal(transcriptFileExists(hermesHome, 'native-stream-1'), true);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('streamChat 在首轮缺少 payload sessionId 时也能依赖响应头完成会话创建', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const started: Array<{ sessionId: string; responseId?: string }> = [];

  globalThis.fetch = async () =>
    createSseResponse([
      `event: response.created
data: ${JSON.stringify({
        type: 'response.created',
        response: {
          id: 'resp_first_turn',
          model: 'hermes-agent',
        },
      })}

`,
      `event: response.output_text.delta
data: ${JSON.stringify({
        type: 'response.output_text.delta',
        delta: '你好',
      })}

`,
      `event: response.completed
data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          id: 'resp_first_turn',
          model: 'hermes-agent',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: '你好',
                },
              ],
            },
          ],
        },
      })}

`,
      'data: [DONE]\n\n',
    ]);

  try {
    const result = await streamChat(
      {
        input: '你好',
      },
      {
        onStart(event) {
          started.push({
            sessionId: event.sessionId,
            responseId: event.responseId,
          });
        },
      },
    );

    assert.deepEqual(started, [
      {
        sessionId: 'native-stream-1',
        responseId: undefined,
      },
    ]);
    assert.equal(result.sessionId, 'native-stream-1');
    assert.equal(result.conversation, 'native-stream-1');
    assert.equal(result.responseId, 'resp_first_turn');
    assert.equal(transcriptFileExists(hermesHome, 'native-stream-1'), true);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('streamChat 在切换后的 profile 下把 transcript 写入对应 profile 目录', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  ensureProfileSessionsDir(hermesHome, 'sami');

  globalThis.fetch = async () =>
    createSseResponse([
      `event: response.created
data: ${JSON.stringify({
        type: 'response.created',
        response: {
          id: 'resp_profile_1',
          model: 'hermes-agent',
        },
      })}

`,
      `event: response.completed
data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          id: 'resp_profile_1',
          model: 'hermes-agent',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: '你好，Sami',
                },
              ],
            },
          ],
        },
      })}

`,
      'data: [DONE]\n\n',
    ]);

  try {
    const result = await streamChat({
      input: '你好',
      profileId: 'sami',
    });

    assert.equal(result.sessionId, 'native-stream-1');
    assert.equal(transcriptFileExists(hermesHome, 'native-stream-1', 'sami'), true);
    assert.equal(transcriptFileExists(hermesHome, 'native-stream-1'), false);
    assert.deepEqual(readTranscriptFile(hermesHome, 'native-stream-1', 'sami').messages?.map((message) => message.content), ['你好', '你好，Sami']);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('sendChat 会读取 profile config 的模型和 system prompt 注入 Responses 请求', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; payload: Record<string, unknown> }> = [];
  ensureProfileSessionsDir(hermesHome, 'sami');
  writeProfileConfig(hermesHome, 'sami', {
    modelDefault: 'deepseek-v4-flash',
    systemPrompt: '你现在必须扮演 Sami，并遵守 profile 的设定。',
  });

  globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    fetchCalls.push({
      url: String(input),
      payload,
    });

    return new Response(
      JSON.stringify({
        id: 'resp_profile_cfg_1',
        model: 'deepseek-v4-flash',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: '我就是 Sami。',
              },
            ],
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Id': 'native-profile-config-1',
        },
      },
    );
  };

  try {
    const response = await sendChat({
      input: 'sami~',
      profileId: 'sami',
    });

    assert.equal(response.sessionId, 'native-profile-config-1');
    assert.deepEqual(fetchCalls[0]?.payload, {
      model: 'deepseek-v4-flash',
      input: 'sami~',
      stream: false,
      store: true,
      instructions: '你现在必须扮演 Sami，并遵守 profile 的设定。',
    });
    assert.equal(readTranscriptFile(hermesHome, 'native-profile-config-1', 'sami').system_prompt, '你现在必须扮演 Sami，并遵守 profile 的设定。');
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('chat-completions 会把 profile system prompt 放到 system message，并使用 profile 模型', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; payload: Record<string, unknown> }> = [];
  ensureProfileSessionsDir(hermesHome, 'sami');
  writeProfileConfig(hermesHome, 'sami', {
    modelDefault: 'deepseek-chat',
    systemPrompt: '你是 Sami，要按角色设定回复。',
  });

  globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    fetchCalls.push({
      url: String(input),
      payload,
    });

    return new Response(
      JSON.stringify({
        id: 'chatcmpl_profile_1',
        model: 'deepseek-chat',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '收到，我会以 Sami 的身份回复。',
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Id': 'native-chat-profile-1',
        },
      },
    );
  };

  try {
    const response = await sendChat({
      input: '你好',
      profileId: 'sami',
      mode: 'chat-completions',
    });

    assert.equal(response.sessionId, 'native-chat-profile-1');
    assert.deepEqual(fetchCalls[0]?.payload, {
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: '你是 Sami，要按角色设定回复。',
        },
        {
          role: 'user',
          content: '你好',
        },
      ],
      stream: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('Bubble Town 专用 Hermes 网关已切到目标 profile 时，不再注入重复 system prompt 或写入 shadow transcript', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; payload: Record<string, unknown> }> = [];
  ensureProfileSessionsDir(hermesHome, 'sami');
  writeProfileConfig(hermesHome, 'sami', {
    modelDefault: 'deepseek-v4-flash',
    systemPrompt: '你是 Sami。',
  });
  setManagedHermesGatewayProfileForTests('sami');

  globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    fetchCalls.push({
      url: String(input),
      payload,
    });

    return new Response(
      JSON.stringify({
        id: 'resp_managed_gateway_1',
        model: 'hermes-agent',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: '原生 runtime 已加载。',
              },
            ],
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Id': 'native-managed-profile-1',
        },
      },
    );
  };

  try {
    const response = await sendChat({
      input: '你好',
      profileId: 'sami',
    });

    assert.equal(response.sessionId, 'native-managed-profile-1');
    assert.deepEqual(fetchCalls[0]?.payload, {
      model: 'hermes-agent',
      input: '你好',
      stream: false,
      store: true,
    });
    assert.equal(transcriptFileExists(hermesHome, 'native-managed-profile-1', 'sami'), false);
  } finally {
    globalThis.fetch = originalFetch;
    resetManagedHermesGatewayStateForTests();
    cleanupHermesHome(hermesHome);
  }
});

test('managed gateway 模式下 sendChat 会优先使用 response_store 中 responseId 对应的原生 sessionId', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  ensureProfileSessionsDir(hermesHome, 'sami');
  writeResponseStoreEntry(hermesHome, 'sami', {
    responseId: 'resp_managed_rotated_1',
    sessionId: 'native-rotated-session-1',
  });
  setManagedHermesGatewayProfileForTests('sami');

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'resp_managed_rotated_1',
        model: 'hermes-agent',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: '已切到新的原生会话。',
              },
            ],
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

  try {
    const response = await sendChat({
      input: '继续聊',
      profileId: 'sami',
      sessionId: 'stale-managed-session',
      responseId: 'resp_stale_managed',
    });

    assert.equal(response.sessionId, 'native-rotated-session-1');
    assert.equal(response.responseId, 'resp_managed_rotated_1');
    assert.equal(transcriptFileExists(hermesHome, 'native-rotated-session-1', 'sami'), false);
  } finally {
    globalThis.fetch = originalFetch;
    resetManagedHermesGatewayStateForTests();
    cleanupHermesHome(hermesHome);
  }
});

test('sendChat 使用路由传入的 gateway snapshot，不受全局 gateway 后续切换影响', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; payload: Record<string, unknown> }> = [];
  ensureProfileSessionsDir(hermesHome, 'sami');
  writeProfileConfig(hermesHome, 'sami', {
    modelDefault: 'deepseek-v4-flash',
    systemPrompt: '你是 Sami。',
  });
  setManagedHermesGatewayProfileForTests('default', 'http://127.0.0.1:8643/v1');

  globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    fetchCalls.push({
      url: String(input),
      payload,
    });

    return new Response(
      JSON.stringify({
        id: 'resp_snapshot_1',
        model: 'hermes-agent',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: '使用 snapshot gateway。',
              },
            ],
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Id': 'native-snapshot-profile-1',
        },
      },
    );
  };

  try {
    const response = await sendChat(
      {
        input: '你好',
        profileId: 'sami',
      },
      {
        apiBaseUrl: 'http://127.0.0.1:9999/v1',
        managedGatewayProfileId: 'sami',
      },
    );

    assert.equal(response.sessionId, 'native-snapshot-profile-1');
    assert.equal(fetchCalls[0]?.url, 'http://127.0.0.1:9999/v1/responses');
    assert.deepEqual(fetchCalls[0]?.payload, {
      model: 'hermes-agent',
      input: '你好',
      stream: false,
      store: true,
    });
    assert.equal(transcriptFileExists(hermesHome, 'native-snapshot-profile-1', 'sami'), false);
  } finally {
    globalThis.fetch = originalFetch;
    resetManagedHermesGatewayStateForTests();
    cleanupHermesHome(hermesHome);
  }
});

test('managed gateway 模式下 streamChat 完成时会用 response_store 修正最终原生 sessionId', async () => {
  const hermesHome = createHermesHome();
  const originalFetch = globalThis.fetch;
  const completed: Array<{ sessionId: string; responseId?: string }> = [];
  ensureProfileSessionsDir(hermesHome, 'sami');
  writeResponseStoreEntry(hermesHome, 'sami', {
    responseId: 'resp_managed_stream_1',
    sessionId: 'native-rotated-stream-1',
  });
  setManagedHermesGatewayProfileForTests('sami');

  globalThis.fetch = async () =>
    createSseResponse([
      `event: response.created
data: ${JSON.stringify({
        type: 'response.created',
        response: {
          id: 'resp_managed_stream_1',
          model: 'hermes-agent',
        },
      })}

`,
      `event: response.completed
data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          id: 'resp_managed_stream_1',
          model: 'hermes-agent',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: '流式已切到新的原生会话。',
                },
              ],
            },
          ],
        },
      })}

`,
      'data: [DONE]\n\n',
    ], {});

  try {
    const result = await streamChat(
      {
        input: '继续流式聊',
        profileId: 'sami',
        sessionId: 'stale-managed-session',
        responseId: 'resp_stale_managed',
      },
      {
        onComplete(event) {
          completed.push({
            sessionId: event.sessionId,
            responseId: event.responseId,
          });
        },
      },
    );

    assert.equal(result.sessionId, 'native-rotated-stream-1');
    assert.equal(result.responseId, 'resp_managed_stream_1');
    assert.deepEqual(completed, [
      {
        sessionId: 'native-rotated-stream-1',
        responseId: 'resp_managed_stream_1',
      },
    ]);
    assert.equal(transcriptFileExists(hermesHome, 'native-rotated-stream-1', 'sami'), false);
  } finally {
    globalThis.fetch = originalFetch;
    resetManagedHermesGatewayStateForTests();
    cleanupHermesHome(hermesHome);
  }
});
