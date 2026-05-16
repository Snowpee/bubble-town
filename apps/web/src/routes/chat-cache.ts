import type { SessionDetail, SessionSummary } from '@bubble-town/shared';

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
