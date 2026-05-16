import { describe, expect, it } from 'vitest';
import type { SessionDetail, SessionSummary } from '@bubble-town/shared';
import { updateSessionDetail, updateSessionsPayload } from './chat-cache';

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
});
