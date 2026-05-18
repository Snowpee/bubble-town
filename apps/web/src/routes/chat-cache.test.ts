import { describe, expect, it } from 'vitest';
import type { ChatMessage, SessionDetail, SessionSummary } from '@bubble-town/shared';
import { appendMessagesToSessionDetail, updateSessionDetail, updateSessionsPayload } from './chat-cache';

function createSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: 'native-session',
    conversation: 'native-session',
    id: 'native-session',
    profileId: 'default',
    title: '旧标题',
    source: 'api-server',
    startedAt: '2026-05-16T10:00:00.000Z',
    updatedAt: '2026-05-16T10:01:00.000Z',
    messageCount: 2,
    lastMessagePreview: '旧摘要',
    ...overrides,
  };
}

describe('chat cache helpers', () => {
  it('只更新相同 Hermes 原生 sessionId 的列表项', () => {
    const nextSummary = createSummary({ title: '新标题' });
    const payload = {
      sessions: [
        createSummary(),
        createSummary({
          sessionId: 'native-other',
          conversation: 'native-other',
          id: 'native-other',
          title: '其他标题',
        }),
      ],
    };

    expect(updateSessionsPayload(payload, nextSummary)).toEqual({
      sessions: [
        createSummary({ title: '新标题' }),
        createSummary({
          sessionId: 'native-other',
          conversation: 'native-other',
          id: 'native-other',
          title: '其他标题',
        }),
      ],
    });
  });

  it('只更新相同 Hermes 原生 sessionId 的详情缓存', () => {
    const detail: SessionDetail = {
      summary: createSummary(),
      messages: [],
    };

    expect(updateSessionDetail(detail, createSummary({ title: '新标题' }))).toEqual({
      summary: createSummary({ title: '新标题' }),
      messages: [],
    });
  });

  it('把完成的流式消息追加到详情缓存并更新 summary', () => {
    const detail: SessionDetail = {
      summary: createSummary({ messageCount: 1 }),
      messages: [
        {
          id: 'existing',
          role: 'user',
          content: '旧问题',
          createdAt: '2026-05-16T10:00:00.000Z',
        },
      ],
    };
    const messages: ChatMessage[] = [
      {
        id: 'pending-user',
        role: 'user',
        content: '新问题',
        createdAt: '2026-05-16T10:02:00.000Z',
      },
      {
        id: 'pending-assistant',
        role: 'assistant',
        content: '新回答',
        createdAt: '2026-05-16T10:03:00.000Z',
      },
    ];

    expect(appendMessagesToSessionDetail(detail, messages, 'response-next')).toEqual({
      summary: createSummary({
        responseId: 'response-next',
        messageCount: 3,
        lastMessagePreview: '新回答',
        updatedAt: '2026-05-16T10:03:00.000Z',
      }),
      messages: [...detail.messages, ...messages],
    });
  });

  it('已存在相同 id 的流式消息时替换内容而不是追加重复项', () => {
    const detail: SessionDetail = {
      summary: createSummary({ messageCount: 2 }),
      messages: [
        {
          id: 'pending-user',
          role: 'user',
          content: '新问题',
          createdAt: '2026-05-16T10:02:00.000Z',
        },
        {
          id: 'pending-assistant',
          role: 'assistant',
          content: '半截回答',
          createdAt: '2026-05-16T10:03:00.000Z',
        },
      ],
    };
    const messages: ChatMessage[] = [
      detail.messages[0],
      {
        id: 'pending-assistant',
        role: 'assistant',
        content: '完整回答',
        createdAt: '2026-05-16T10:04:00.000Z',
      },
    ];

    expect(appendMessagesToSessionDetail(detail, messages, 'response-next')).toEqual({
      summary: createSummary({
        responseId: 'response-next',
        messageCount: 2,
        lastMessagePreview: '完整回答',
        updatedAt: '2026-05-16T10:04:00.000Z',
      }),
      messages,
    });
  });
});
