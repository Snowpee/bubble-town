import type { ChatMessage, SessionDetail, SessionSummary } from '@bubble-town/shared';

export function mergeSummaryIntoSession(summary: SessionSummary, current?: SessionSummary): SessionSummary {
  return { ...current, ...summary };
}

export function updateSessionsPayload(
  payload: { sessions: SessionSummary[] } | undefined,
  summary: SessionSummary,
): { sessions: SessionSummary[] } | undefined {
  if (!payload) {
    return payload;
  }

  return {
    ...payload,
    sessions: payload.sessions.map((session) =>
      session.sessionId === summary.sessionId ? mergeSummaryIntoSession(summary, session) : session,
    ),
  };
}

export function updateSessionDetail(
  detail: SessionDetail | undefined,
  summary: SessionSummary,
): SessionDetail | undefined {
  if (!detail) {
    return detail;
  }

  return {
    ...detail,
    summary: mergeSummaryIntoSession(summary, detail.summary),
  };
}

export function appendMessagesToSessionDetail(
  detail: SessionDetail,
  messages: ChatMessage[],
  responseId?: string,
): SessionDetail {
  const existingMessageIds = new Set(detail.messages.map((message) => message.id));
  let didChangeMessages = false;
  const nextMessages = detail.messages.map((message) => {
    const replacement = messages.find((nextMessage) => nextMessage.id === message.id);
    if (!replacement) {
      return message;
    }

    didChangeMessages = true;
    return replacement;
  });

  for (const message of messages) {
    if (!existingMessageIds.has(message.id)) {
      existingMessageIds.add(message.id);
      nextMessages.push(message);
      didChangeMessages = true;
    }
  }

  return {
    ...detail,
    summary: {
      ...detail.summary,
      responseId: responseId ?? detail.summary.responseId,
      messageCount: nextMessages.filter((message) => message.role !== 'tool').length,
      lastMessagePreview: messages[messages.length - 1]?.content || detail.summary.lastMessagePreview,
      updatedAt: messages[messages.length - 1]?.createdAt ?? detail.summary.updatedAt,
    },
    messages: didChangeMessages ? nextMessages : detail.messages,
  };
}
