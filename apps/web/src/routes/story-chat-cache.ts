import type { ActiveStorylineResponse, ChatMessage, ContextPreviewResponse } from '@bubble-town/shared';

export function appendMessagesToContextPreview(
  preview: ContextPreviewResponse | undefined,
  messages: ChatMessage[],
): ContextPreviewResponse | undefined {
  if (!preview) {
    return preview;
  }

  const existingMessageIds = new Set(preview.contextPack.recentMessages.map((message) => message.id));
  let didChangeMessages = false;
  const nextMessages = preview.contextPack.recentMessages.map((message) => {
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

  if (!didChangeMessages) {
    return preview;
  }

  return {
    ...preview,
    contextPack: {
      ...preview.contextPack,
      recentMessages: nextMessages,
    },
  };
}

export function updateActiveStorylineLastInteraction(
  payload: ActiveStorylineResponse | undefined,
  updatedAt: string,
): ActiveStorylineResponse | undefined {
  if (!payload?.activeStoryline) {
    return payload;
  }

  return {
    ...payload,
    activeStoryline: {
      ...payload.activeStoryline,
      lastInteractionAt: updatedAt,
      updatedAt,
    },
  };
}

export function mergeStoryChatCurrentMessages(
  persistedMessages: ChatMessage[],
  streamingMessages: ChatMessage[],
): ChatMessage[] {
  if (streamingMessages.length === 0) {
    return persistedMessages;
  }

  const streamingIds = new Set(streamingMessages.map((message) => message.id));
  return [
    ...persistedMessages.filter((message) => !streamingIds.has(message.id)),
    ...streamingMessages,
  ];
}
