import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { ChatImageAttachment, ChatMessage, SessionDetail, SessionSummary } from '@bubble-town/shared';
import { DEFAULT_PROFILE_ID, getProfilesRoot, getResponseStoreDbPath, getSessionFilePath, getSessionsDir, getStateDbPath } from './hermes-paths.js';

interface TranscriptMessage {
  id?: string;
  role?: string;
  content?: unknown;
  timestamp?: number | string;
  created_at?: string;
  attachments?: ChatImageAttachment[];
  tool_events?: ChatMessage['toolEvents'];
}

interface SessionTranscript {
  session_id: string;
  conversation?: string;
  response_id?: string;
  responseId?: string;
  model?: string;
  base_url?: string;
  platform?: string;
  session_start?: string;
  last_updated?: string;
  system_prompt?: string;
  tools?: unknown[];
  message_count?: number;
  messages?: TranscriptMessage[];
}

interface SessionRow {
  id: string;
  source: string;
  started_at: number;
  ended_at: number | null;
  message_count: number;
  title: string | null;
}

interface MessageRow {
  id: number;
  role: string;
  content: string | null;
  timestamp: number;
}

interface StoredSessionRecord {
  sessionId: string;
  profileId: string;
  aliases: Set<string>;
  dbRow?: SessionRow;
  transcript?: SessionTranscript;
  transcriptFileId?: string;
}

interface StoredResponseRow {
  response_id: string;
  data: string;
  accessed_at: number;
}

interface MessageParts {
  text: string;
  attachments: ChatImageAttachment[];
}

function toIso(value?: number | string | null): string {
  if (value === null || value === undefined || value === '') {
    return new Date(0).toISOString();
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return toIso(parsed);
    }
    return new Date(value).toISOString();
  }

  const millis = value > 10_000_000_000 ? value : value * 1000;
  return new Date(millis).toISOString();
}

function normalizeRole(role?: string): ChatMessage['role'] {
  if (role === 'system' || role === 'user' || role === 'assistant' || role === 'tool') {
    return role;
  }

  return 'assistant';
}

function normalizeImageAttachments(value: unknown): ChatImageAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const attachment = item as Partial<ChatImageAttachment>;
    if (attachment.type !== 'image' || typeof attachment.url !== 'string' || !attachment.url.trim()) {
      return [];
    }

    return [
      {
        type: 'image' as const,
        url: attachment.url,
        mimeType: typeof attachment.mimeType === 'string' ? attachment.mimeType : undefined,
        name: typeof attachment.name === 'string' ? attachment.name : undefined,
      },
    ];
  });
}

function dedupeAttachments(attachments: ChatImageAttachment[]): ChatImageAttachment[] {
  const seen = new Set<string>();
  return attachments.filter((attachment) => {
    const identity = `${attachment.url}|${attachment.name ?? ''}`;
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  });
}

function extractMessageParts(content: unknown, fallbackAttachments?: unknown): MessageParts {
  const attachments = [...normalizeImageAttachments(fallbackAttachments)];

  if (typeof content === 'string') {
    return { text: content, attachments: dedupeAttachments(attachments) };
  }

  if (Array.isArray(content)) {
    const textSegments: string[] = [];

    for (const item of content) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const record = item as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : undefined;

      if ((type === 'text' || type === 'input_text' || type === 'output_text') && typeof record.text === 'string') {
        textSegments.push(record.text);
        continue;
      }

      if (type === 'image_url') {
        const imagePayload =
          record.image_url && typeof record.image_url === 'object' ? (record.image_url as Record<string, unknown>) : undefined;
        const url = typeof imagePayload?.url === 'string' ? imagePayload.url : undefined;
        if (url) {
          attachments.push({ type: 'image', url });
        }
        continue;
      }

      if (type === 'input_image' && typeof record.image_url === 'string') {
        attachments.push({ type: 'image', url: record.image_url });
        continue;
      }

      if ('content' in record) {
        const nested = extractMessageParts(record.content, record.attachments);
        if (nested.text) {
          textSegments.push(nested.text);
        }
        attachments.push(...nested.attachments);
        continue;
      }
    }

    return {
      text: textSegments.filter(Boolean).join('\n'),
      attachments: dedupeAttachments(attachments),
    };
  }

  return { text: '', attachments: dedupeAttachments(attachments) };
}

function describeMessagePreview(parts: MessageParts): string {
  if (parts.text.trim()) {
    return parts.text;
  }

  if (parts.attachments.length > 0) {
    return parts.attachments.length === 1 ? '[图片]' : `[${parts.attachments.length} 张图片]`;
  }

  return '';
}

function extractUserMessageFromInjectedInput(content: string): string {
  const startTag = '<UserMessage>';
  const endTag = '</UserMessage>';
  const startIndex = content.lastIndexOf(startTag);
  const endIndex = content.lastIndexOf(endTag);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return content;
  }

  return content.slice(startIndex + startTag.length, endIndex).trim();
}

function sanitizeTranscriptText(role: ChatMessage['role'], content: string): string {
  if (role !== 'user') {
    return content;
  }

  if (!content.includes('<BubbleTownContextPack>') && !content.includes('<UserMessage>')) {
    return content;
  }

  return extractUserMessageFromInjectedInput(content);
}

function summarizeText(value: string, maxLength = 96): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1)}...`;
}

function normalizeIdentity(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isParallelSessionAlias(value: string): boolean {
  return value.startsWith('conv_') || value.startsWith('resp_');
}

function safeOpenDatabase(profileId: string): DatabaseSync | undefined {
  const stateDbPath = getStateDbPath(profileId);
  if (!fs.existsSync(stateDbPath)) {
    return undefined;
  }

  return new DatabaseSync(stateDbPath, { readOnly: true });
}

function safeOpenWritableDatabase(profileId: string): DatabaseSync | undefined {
  const stateDbPath = getStateDbPath(profileId);
  if (!fs.existsSync(stateDbPath)) {
    return undefined;
  }

  return new DatabaseSync(stateDbPath);
}

function safeOpenResponseStore(profileId: string): DatabaseSync | undefined {
  const responseStoreDbPath = getResponseStoreDbPath(profileId);
  if (!fs.existsSync(responseStoreDbPath)) {
    return undefined;
  }

  return new DatabaseSync(responseStoreDbPath, { readOnly: true });
}

function safeOpenWritableResponseStore(profileId: string): DatabaseSync | undefined {
  const responseStoreDbPath = getResponseStoreDbPath(profileId);
  if (!fs.existsSync(responseStoreDbPath)) {
    return undefined;
  }

  return new DatabaseSync(responseStoreDbPath);
}

function querySessionRows(profileId: string): SessionRow[] {
  const db = safeOpenDatabase(profileId);
  if (!db) {
    return [];
  }

  try {
    return db
      .prepare(
        `SELECT id, source, started_at, ended_at, message_count, title
         FROM sessions
         ORDER BY COALESCE(ended_at, started_at) DESC`,
      )
      .all() as unknown as SessionRow[];
  } finally {
    db.close();
  }
}

function queryMessageRows(profileId: string, sessionId: string): MessageRow[] {
  const db = safeOpenDatabase(profileId);
  if (!db) {
    return [];
  }

  try {
    return db
      .prepare(
        `SELECT id, role, content, timestamp
         FROM messages
         WHERE session_id = ?
         ORDER BY timestamp ASC, id ASC`,
      )
      .all(sessionId) as unknown as MessageRow[];
  } finally {
    db.close();
  }
}

function queryStoredResponses(profileId: string): StoredResponseRow[] {
  const db = safeOpenResponseStore(profileId);
  if (!db) {
    return [];
  }

  try {
    return db
      .prepare(
        `SELECT response_id, data, accessed_at
         FROM responses`,
      )
      .all() as unknown as StoredResponseRow[];
  } finally {
    db.close();
  }
}

function parseStoredResponseRow(row: StoredResponseRow) {
  try {
    const parsed = JSON.parse(row.data) as {
      session_id?: string;
      response?: { id?: string; created?: number };
    };

    return {
      responseId: normalizeIdentity(parsed.response?.id) ?? normalizeIdentity(row.response_id),
      sessionId: normalizeIdentity(parsed.session_id),
      createdAt: typeof parsed.response?.created === 'number' ? parsed.response.created : row.accessed_at,
    };
  } catch {
    return undefined;
  }
}

export function getLatestResponseIdForSession(sessionId: string, profileId = DEFAULT_PROFILE_ID): string | undefined {
  const target = normalizeIdentity(sessionId);
  if (!target) {
    return undefined;
  }

  return queryStoredResponses(profileId)
    .map((row) => parseStoredResponseRow(row))
    .filter((row): row is NonNullable<typeof row> => Boolean(row?.sessionId) && Boolean(row?.responseId))
    .filter((row) => row.sessionId === target)
    .sort((left, right) => right.createdAt - left.createdAt)[0]?.responseId;
}

export function getSessionIdForResponse(responseId: string, profileId = DEFAULT_PROFILE_ID): string | undefined {
  const target = normalizeIdentity(responseId);
  if (!target) {
    return undefined;
  }

  return queryStoredResponses(profileId)
    .map((row) => parseStoredResponseRow(row))
    .find((row) => row?.responseId === target)?.sessionId;
}

function getDbSessionPreview(profileId: string, sessionId: string): string | undefined {
  const messages = queryMessageRows(profileId, sessionId);
  const preview = [...messages].reverse().find((message) => (message.role === 'user' || message.role === 'assistant') && message.content?.trim());
  return preview?.content ? summarizeText(preview.content) : undefined;
}

function listTranscriptIds(profileId: string): string[] {
  const sessionsDir = getSessionsDir(profileId);
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  return fs
    .readdirSync(sessionsDir)
    .filter((entry) => entry.startsWith('session_') && entry.endsWith('.json'))
    .map((entry) => entry.slice('session_'.length, -'.json'.length));
}

function readSessionTranscript(profileId: string, sessionId: string): SessionTranscript | undefined {
  const sessionFilePath = getSessionFilePath(sessionId, profileId);
  if (!fs.existsSync(sessionFilePath)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(sessionFilePath, 'utf8')) as SessionTranscript;
  } catch {
    return undefined;
  }
}

function shouldIgnoreParallelTranscriptFile(transcriptFileId: string, transcript?: SessionTranscript): boolean {
  if (!isParallelSessionAlias(transcriptFileId)) {
    return false;
  }

  const nativeSessionId = normalizeIdentity(transcript?.session_id);
  return !nativeSessionId || nativeSessionId !== transcriptFileId;
}

function getCanonicalSessionId(transcriptFileId: string, transcript?: SessionTranscript): string | undefined {
  if (shouldIgnoreParallelTranscriptFile(transcriptFileId, transcript)) {
    return undefined;
  }

  return normalizeIdentity(transcript?.session_id) ?? (!isParallelSessionAlias(transcriptFileId) ? normalizeIdentity(transcriptFileId) : undefined);
}

function getTranscriptResponseId(transcript?: SessionTranscript): string | undefined {
  return normalizeIdentity(transcript?.responseId) ?? normalizeIdentity(transcript?.response_id);
}

function getDbSessionKey(record: StoredSessionRecord): string | undefined {
  return normalizeIdentity(record.dbRow?.id);
}

function getTranscriptMessageSeed(record: StoredSessionRecord): string {
  return record.sessionId;
}

function getTranscriptUpdatedAt(transcript?: SessionTranscript): string {
  return transcript?.last_updated ?? transcript?.session_start ?? new Date(0).toISOString();
}

function preferTranscript(current: SessionTranscript | undefined, candidate: SessionTranscript | undefined): SessionTranscript | undefined {
  if (!current) {
    return candidate;
  }

  if (!candidate) {
    return current;
  }

  return getTranscriptUpdatedAt(candidate).localeCompare(getTranscriptUpdatedAt(current)) > 0 ? candidate : current;
}

function deriveSessionTitle(record: StoredSessionRecord): string {
  const sessionId = record.sessionId;
  const transcript = record.transcript;
  const dbTitle = record.dbRow?.title;
  if (dbTitle?.trim()) {
    return dbTitle.trim();
  }

  const fallback = transcript?.messages?.find((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') {
      return false;
    }

    return describeMessagePreview(extractMessageParts(message.content, message.attachments)).trim().length > 0;
  });
  const preview = fallback ? summarizeText(describeMessagePreview(extractMessageParts(fallback.content, fallback.attachments)), 40) : '';
  return preview || sessionId;
}

function mapTranscriptMessages(record: StoredSessionRecord): ChatMessage[] {
  const transcript = record.transcript;
  const messages = transcript?.messages ?? [];
  const defaultTimestamp = transcript?.session_start ?? transcript?.last_updated ?? new Date().toISOString();
  const messageSeed = getTranscriptMessageSeed(record);

  return messages
    .map((message, index) => {
      const role = normalizeRole(message.role);
      const parts = extractMessageParts(message.content, message.attachments);
      return {
        id: message.id ?? `${messageSeed}-${index + 1}`,
        role,
        content: sanitizeTranscriptText(role, parts.text),
        attachments: parts.attachments.length ? parts.attachments : undefined,
        createdAt: typeof message.created_at === 'string' ? message.created_at : toIso(message.timestamp ?? defaultTimestamp),
        toolEvents: Array.isArray(message.tool_events) ? message.tool_events : undefined,
      };
    })
    .filter((message) => message.content.trim().length > 0 || (message.attachments?.length ?? 0) > 0 || (message.toolEvents?.length ?? 0) > 0);
}

function mapDbMessages(sessionId: string, rows: MessageRow[]): ChatMessage[] {
  return rows
    .map((row) => ({
      id: `${sessionId}-${row.id}`,
      role: normalizeRole(row.role),
      content: row.content ?? '',
      createdAt: toIso(row.timestamp),
    }))
    .filter((message) => message.content.trim().length > 0);
}

function getVisibleMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => message.role !== 'tool');
}

function buildSessionSummary(record: StoredSessionRecord): SessionSummary {
  const transcriptMessages = mapTranscriptMessages(record);
  const visibleTranscriptMessages = getVisibleMessages(transcriptMessages);
  const dbSessionKey = getDbSessionKey(record);
  const lastPreview =
    (dbSessionKey ? getDbSessionPreview(record.profileId, dbSessionKey) : undefined) ??
    (() => {
      const lastVisible = [...visibleTranscriptMessages].reverse().find((message) => message.role === 'user' || message.role === 'assistant');
      if (!lastVisible) {
        return undefined;
      }
      return describeMessagePreview({
        text: lastVisible.content,
        attachments: lastVisible.attachments ?? [],
      });
    })() ??
    '';

  return {
    sessionId: record.sessionId,
    conversation: record.sessionId,
    id: record.sessionId,
    responseId: getTranscriptResponseId(record.transcript) ?? getLatestResponseIdForSession(record.sessionId, record.profileId),
    profileId: record.profileId,
    title: deriveSessionTitle(record),
    source: record.dbRow?.source ?? record.transcript?.platform ?? 'unknown',
    startedAt: record.dbRow ? toIso(record.dbRow.started_at) : record.transcript?.session_start ?? new Date().toISOString(),
    updatedAt:
      (record.dbRow ? toIso(record.dbRow.ended_at ?? record.dbRow.started_at) : undefined) ??
      record.transcript?.last_updated ??
      record.transcript?.session_start ??
      new Date().toISOString(),
    messageCount: record.dbRow?.message_count ?? (record.transcript ? visibleTranscriptMessages.length : 0),
    lastMessagePreview: lastPreview ? summarizeText(lastPreview) : undefined,
  };
}

function buildSessionRecords(profileId: string): StoredSessionRecord[] {
  const recordsBySessionId = new Map<string, StoredSessionRecord>();
  const recordsByAlias = new Map<string, StoredSessionRecord>();

  const claimRecord = (sessionId: string): StoredSessionRecord => {
    const normalizedSessionId = normalizeIdentity(sessionId);
    if (!normalizedSessionId) {
      throw new Error('session identity is required');
    }

    const existing = recordsBySessionId.get(normalizedSessionId) ?? recordsByAlias.get(normalizedSessionId);
    if (existing) {
      if (!recordsBySessionId.has(normalizedSessionId)) {
        recordsBySessionId.set(normalizedSessionId, existing);
      }
      return existing;
    }

    const created: StoredSessionRecord = {
      sessionId: normalizedSessionId,
      profileId,
      aliases: new Set([normalizedSessionId]),
    };
    recordsBySessionId.set(normalizedSessionId, created);
    recordsByAlias.set(normalizedSessionId, created);
    return created;
  };

  const attachAlias = (record: StoredSessionRecord, alias: unknown) => {
    const normalizedAlias = normalizeIdentity(alias);
    if (!normalizedAlias) {
      return;
    }

    record.aliases.add(normalizedAlias);
    recordsByAlias.set(normalizedAlias, record);
  };

  for (const transcriptFileId of listTranscriptIds(profileId)) {
    const transcript = readSessionTranscript(profileId, transcriptFileId);
    const sessionId = getCanonicalSessionId(transcriptFileId, transcript);
    if (!sessionId) {
      continue;
    }
    const record = claimRecord(sessionId);

    record.transcript = preferTranscript(record.transcript, transcript);
    if (record.transcript === transcript) {
      record.transcriptFileId = transcriptFileId;
    }

    attachAlias(record, transcriptFileId);
    attachAlias(record, transcript?.session_id);
    attachAlias(record, transcript?.conversation);
  }

  for (const dbRow of querySessionRows(profileId)) {
    const record = recordsByAlias.get(dbRow.id) ?? claimRecord(dbRow.id);
    record.dbRow = dbRow;
    attachAlias(record, dbRow.id);
  }

  return [...recordsBySessionId.values()];
}

function findSessionRecord(profileId: string, sessionIdOrAlias: string): StoredSessionRecord | undefined {
  const target = normalizeIdentity(sessionIdOrAlias);
  if (!target) {
    return undefined;
  }

  return buildSessionRecords(profileId).find((record) => record.aliases.has(target));
}

function findNativeSessionRecord(profileId: string, sessionId: string): StoredSessionRecord | undefined {
  const target = normalizeIdentity(sessionId);
  if (!target) {
    return undefined;
  }

  return buildSessionRecords(profileId).find((record) => record.sessionId === target);
}

export function listSessions(profileId = DEFAULT_PROFILE_ID): SessionSummary[] {
  return buildSessionRecords(profileId)
    .map((record) => buildSessionSummary(record))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function findSessionProfiles(sessionIdOrAlias: string): string[] {
  const target = normalizeIdentity(sessionIdOrAlias);
  if (!target) {
    return [];
  }

  const profilesRoot = getProfilesRoot();
  const namedProfiles = fs.existsSync(profilesRoot)
    ? fs
        .readdirSync(profilesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];

  return [DEFAULT_PROFILE_ID, ...namedProfiles].filter((profileId) => Boolean(findSessionRecord(profileId, target)));
}

export function getSessionSummary(sessionId: string, profileId?: string): SessionSummary | undefined {
  const profiles = [profileId || DEFAULT_PROFILE_ID];

  for (const currentProfileId of profiles) {
    const record = findNativeSessionRecord(currentProfileId, sessionId);
    if (!record) {
      continue;
    }

    return buildSessionSummary(record);
  }

  return undefined;
}

export function getSessionDetail(sessionIdOrAlias: string, profileId?: string): SessionDetail | undefined {
  const profiles = [profileId || DEFAULT_PROFILE_ID];

  for (const currentProfileId of profiles) {
    const record = findSessionRecord(currentProfileId, sessionIdOrAlias);
    if (!record) {
      continue;
    }

    const summary = buildSessionSummary(record);
    const dbSessionKey = getDbSessionKey(record);
    const messages = dbSessionKey
      ? mapDbMessages(record.sessionId, queryMessageRows(currentProfileId, dbSessionKey))
      : mapTranscriptMessages(record);

    return {
      summary,
      messages,
    };
  }

  return undefined;
}

export function deleteSession(sessionIdOrAlias: string, profileId?: string): boolean {
  const profiles = [profileId || DEFAULT_PROFILE_ID];

  for (const currentProfileId of profiles) {
    const record = findSessionRecord(currentProfileId, sessionIdOrAlias);
    if (!record) {
      continue;
    }

    const transcriptAliases = [...record.aliases].filter((alias) => fs.existsSync(getSessionFilePath(alias, currentProfileId)));
    for (const transcriptAlias of transcriptAliases) {
      fs.unlinkSync(getSessionFilePath(transcriptAlias, currentProfileId));
    }

    const dbSessionKey = getDbSessionKey(record);
    if (dbSessionKey) {
      const db = safeOpenWritableDatabase(currentProfileId);
      if (db) {
        try {
          db.prepare('DELETE FROM messages WHERE session_id = ?').run(dbSessionKey);
          db.prepare('DELETE FROM sessions WHERE id = ?').run(dbSessionKey);
        } finally {
          db.close();
        }
      }
    }

    const responseIds = queryStoredResponses(currentProfileId)
      .map((row) => parseStoredResponseRow(row))
      .filter((row): row is { sessionId: string; responseId: string; createdAt: number } => Boolean(row?.sessionId) && Boolean(row?.responseId))
      .filter((row) => row.sessionId === record.sessionId)
      .map((row) => row.responseId);

    if (responseIds.length > 0) {
      const responseStore = safeOpenWritableResponseStore(currentProfileId);
      if (responseStore) {
        try {
          const deleteResponse = responseStore.prepare('DELETE FROM responses WHERE response_id = ?');
          for (const responseId of responseIds) {
            deleteResponse.run(responseId);
          }
        } finally {
          responseStore.close();
        }
      }
    }

    return true;
  }

  return false;
}
