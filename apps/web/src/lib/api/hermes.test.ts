import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteSession, fetchSessionDetail, fetchSessionSummary, fetchSessions } from './hermes';

function mockJsonFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('hermes api helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends explicit default profile when profileId is omitted', async () => {
    const fetchMock = mockJsonFetch();

    await fetchSessions();
    await fetchSessionDetail('session-1');
    await fetchSessionSummary('session-1');
    await deleteSession('session-1');

    expect(fetchMock.mock.calls.map(([url]) => String(url).replace(/^.*\/api/, '/api'))).toEqual([
      '/api/sessions?profileId=default',
      '/api/sessions/session-1?profileId=default',
      '/api/sessions/session-1/summary?profileId=default',
      '/api/sessions/session-1?profileId=default',
    ]);
  });
});
