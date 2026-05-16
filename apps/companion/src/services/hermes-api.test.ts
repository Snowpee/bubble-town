import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sendChat, streamChat } from './hermes-api.js';

function createHermesHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-town-hermes-api-'));
  process.env.HERMES_HOME = hermesHome;
  fs.mkdirSync(path.join(hermesHome, 'sessions'), { recursive: true });
  return hermesHome;
}

function cleanupHermesHome(hermesHome: string) {
  fs.rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
  delete process.env.HERMES_API_BASE_URL;
}

function readTranscriptFile(hermesHome: string, cacheKey: string) {
  const filePath = path.join(hermesHome, 'sessions', `session_${cacheKey}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
    session_id?: string;
    response_id?: string;
    messages?: Array<{ role?: string; content?: string }>;
  };
}

function transcriptFileExists(hermesHome: string, cacheKey: string) {
  return fs.existsSync(path.join(hermesHome, 'sessions', `session_${cacheKey}.json`));
}

function createSseResponse(events: string[]) {
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
        'X-Hermes-Session-Id': 'native-stream-1',
      },
    },
  );
}

test('sendChat 使用响应头里的 Hermes 原生 sessionId，并且不再把 sessionId 当 conversation 发给 responses', async () => {
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
    assert.equal(transcriptFileExists(hermesHome, 'native-session-123'), false);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});

test('sendChat 在只有 responseId 的续链请求中不会写入任何平行 session 文件', async () => {
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
    assert.equal(transcriptFileExists(hermesHome, 'native-session-456'), false);
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
    assert.equal(transcriptFileExists(hermesHome, 'native-stream-1'), false);
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
    assert.equal(transcriptFileExists(hermesHome, 'native-stream-1'), false);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupHermesHome(hermesHome);
  }
});
