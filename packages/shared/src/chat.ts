export type ChatMode = 'responses' | 'chat-completions';

export interface ChatImageAttachment {
  type: 'image';
  url: string;
  mimeType?: string;
  name?: string;
}

export interface ChatRequest {
  profileId?: string;
  /**
   * Hermes native session id for the official Responses session model.
   * Omit on the first turn to create a new session.
   */
  sessionId?: string;
  /**
   * @deprecated Compatibility alias of `sessionId`.
   */
  conversation?: string;
  /**
   * Latest completed Responses `id`, used to continue the same server-side turn chain.
   */
  responseId?: string;
  input: string;
  attachments?: ChatImageAttachment[];
  mode?: ChatMode;
}

export interface ChatResponse {
  /**
   * Hermes native session id returned to the client and used for list/detail APIs.
   */
  sessionId: string;
  /**
   * @deprecated Compatibility alias of `sessionId`.
   */
  conversation: string;
  /**
   * Latest completed Responses `id` associated with the returned assistant output.
   */
  responseId?: string;
  /**
   * @deprecated Compatibility alias of `sessionId`.
   */
  id?: string;
  output: string;
  model: string;
}

export interface ChatStreamStartEvent {
  sessionId: string;
  /**
   * @deprecated Compatibility alias of `sessionId`.
   */
  conversation: string;
  responseId?: string;
  /**
   * @deprecated Compatibility alias of `sessionId`.
   */
  id?: string;
  model: string;
}

export interface ChatStreamDeltaEvent {
  delta: string;
}

export interface ChatStreamToolProgressEvent {
  id: string;
  toolName: string;
  phase: 'start' | 'progress' | 'finish' | 'error';
  message?: string;
  createdAt: string;
}

export interface ChatStreamCompleteEvent {
  sessionId: string;
  /**
   * @deprecated Compatibility alias of `sessionId`.
   */
  conversation: string;
  responseId?: string;
  /**
   * @deprecated Compatibility alias of `sessionId`.
   */
  id?: string;
  output: string;
  model: string;
}

export interface ChatStreamErrorEvent {
  message: string;
}
