const browserCompanionUrl =
  typeof window !== 'undefined' ? window.bubbleTownDesktop?.companionUrl : undefined;

function getBrowserDefaultCompanionUrl() {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const { hostname, protocol } = window.location;
  if (!hostname) {
    return undefined;
  }

  const normalizedHost = hostname.includes(':') ? `[${hostname}]` : hostname;
  return `${protocol}//${normalizedHost}:3030`;
}

export const COMPANION_URL =
  browserCompanionUrl ?? import.meta.env.VITE_COMPANION_URL ?? getBrowserDefaultCompanionUrl() ?? 'http://127.0.0.1:3030';

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${COMPANION_URL}${path}`);
  return parseResponse<T>(response);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${COMPANION_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(response);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${COMPANION_URL}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(response);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(`${COMPANION_URL}${path}`, {
    method: 'DELETE',
  });
  return parseResponse<T>(response);
}
