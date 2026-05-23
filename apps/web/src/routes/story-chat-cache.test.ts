import { describe, expect, it } from 'vitest';
import type { ActiveStorylineResponse, ChatMessage, ContextPreviewResponse } from '@bubble-town/shared';
import { appendMessagesToContextPreview, mergeStoryChatCurrentMessages, updateActiveStorylineLastInteraction } from './story-chat-cache';

function createMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: overrides.id ?? 'msg-1',
    role: overrides.role ?? 'assistant',
    content: overrides.content ?? 'hello',
    createdAt: overrides.createdAt ?? '2026-05-23T10:00:00.000Z',
    toolEvents: overrides.toolEvents,
    attachments: overrides.attachments,
  };
}

describe('story chat cache', () => {
  it('在 context preview 中追加刚完成的消息，避免流式完成后瞬间消失', () => {
    const preview: ContextPreviewResponse = {
      contextPack: {
        storylineId: 'story_1',
        characterId: 'char_1',
        hermesProfileId: 'default',
        time: {
          now: '2026-05-23T10:00:00.000Z',
          timezone: 'Asia/Shanghai',
          localNow: '2026-05-23 18:00:00',
          localDate: '2026-05-23',
          localTime: '18:00:00',
          today: ['a', 'b'],
          yesterday: ['a', 'b'],
          dayBeforeYesterday: ['a', 'b'],
          lastNight: ['a', 'b'],
          tonight: ['a', 'b'],
        },
        continuityMode: 'live',
        conversationPacing: {
          topicShiftCommentAllowed: true,
          topicShiftCommentWindowMinutes: 20,
        },
        sessionAnchors: {
          messageCount: 1,
        },
        recentMessages: [createMessage({ id: 'old-user', role: 'user', content: '你好' })],
        memories: [],
        suppressedMemories: [],
        activityLogs: [],
        continuityHints: [],
        relativeTimeResults: [],
        systemInstructions: [],
      },
      renderedInstructions: 'test',
    };

    const next = appendMessagesToContextPreview(preview, [
      createMessage({ id: 'pending-user', role: 'user', content: '我回来了' }),
      createMessage({ id: 'pending-assistant', role: 'assistant', content: '欢迎回来' }),
    ]);

    expect(next?.contextPack.recentMessages.map((message) => message.id)).toEqual([
      'old-user',
      'pending-user',
      'pending-assistant',
    ]);
  });

  it('更新 active storyline 的最近互动时间，避免顶部时间分割线回退', () => {
    const payload: ActiveStorylineResponse = {
      activeStoryline: {
        id: 'story_1',
        characterId: 'char_1',
        hermesProfileId: 'default',
        title: '测试',
        createdAt: '2026-05-23T09:00:00.000Z',
        updatedAt: '2026-05-23T09:00:00.000Z',
        status: 'active',
      },
    };

    const next = updateActiveStorylineLastInteraction(payload, '2026-05-23T10:00:00.000Z');
    expect(next?.activeStoryline?.lastInteractionAt).toBe('2026-05-23T10:00:00.000Z');
    expect(next?.activeStoryline?.updatedAt).toBe('2026-05-23T10:00:00.000Z');
  });

  it('在 seed 完成态缓存后，渲染层优先使用 streaming 消息，避免重复 key', () => {
    const merged = mergeStoryChatCurrentMessages(
      [
        createMessage({ id: 'pending-user', role: 'user', content: '旧内容' }),
        createMessage({ id: 'pending-assistant', role: 'assistant', content: '旧回复' }),
      ],
      [
        createMessage({ id: 'pending-user', role: 'user', content: '新内容' }),
        createMessage({ id: 'pending-assistant', role: 'assistant', content: '新回复' }),
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged.map((message) => message.id)).toEqual(['pending-user', 'pending-assistant']);
    expect(merged.map((message) => message.content)).toEqual(['新内容', '新回复']);
  });
});
