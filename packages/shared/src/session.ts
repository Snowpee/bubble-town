export interface SessionSummary {
  /**
   * Hermes native session identity shared by list/detail APIs and route params.
   */
  sessionId: string;
  /**
   * @deprecated Compatibility alias of `sessionId`.
   */
  conversation: string;
  /**
   * @deprecated Compatibility alias of `sessionId`.
   */
  id: string;
  /**
   * Latest completed Responses `id`, used only for turn chaining.
   */
  responseId?: string;
  profileId: string;
  title: string;
  source: string;
  startedAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview?: string;
}

export interface ToolProgressEvent {
  id: string;
  toolName: string;
  phase: 'start' | 'progress' | 'finish' | 'error';
  message?: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: string;
  toolEvents?: ToolProgressEvent[];
}

export interface SessionDetail {
  /**
   * `summary.sessionId` is the canonical identity. `summary.conversation` and `summary.id`
   * remain as compatibility aliases.
   */
  summary: SessionSummary;
  messages: ChatMessage[];
}
