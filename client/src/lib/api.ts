import axios, { AxiosError, type AxiosRequestConfig } from 'axios';

/**
 * API client. The short-lived access token lives only in memory (never localStorage).
 * The refresh token is an HttpOnly cookie scoped to /api/v1/auth that JavaScript cannot read.
 */
let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}
export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
}

export const api = axios.create({ baseURL: '/api/v1', withCredentials: true, timeout: 120_000 });

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

export async function refreshSession(): Promise<string | null> {
  // Single-flight: concurrent 401s share one refresh request (refresh tokens rotate on use).
  refreshing ??= axios
    .post('/api/v1/auth/refresh', {}, { withCredentials: true })
    .then((r) => {
      setAccessToken(r.data.accessToken);
      return r.data.accessToken as string;
    })
    .catch(() => {
      setAccessToken(null);
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const isAuthCall = original?.url?.startsWith('/auth/');
    if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      const token = await refreshSession();
      if (token) return api(original);
      onSessionExpired?.();
    }
    return Promise.reject(error);
  },
);

export interface ApiErrorShape {
  code?: string;
  message: string;
  details?: Array<{ path: string; message: string }> | unknown;
}

/** Human-readable error message from any API failure. */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    const e = (err.response?.data as { error?: ApiErrorShape } | undefined)?.error;
    if (e?.details && Array.isArray(e.details) && e.details.length) {
      return `${e.message}: ${e.details.map((d: { path: string; message: string }) => (d.path ? `${d.path} — ${d.message}` : d.message)).join('; ')}`;
    }
    if (e?.message) return e.message;
    if (err.code === 'ECONNABORTED') return 'The request timed out';
    if (!err.response) return 'Cannot reach the server. Check that the API is running.';
    return `Request failed (${err.response.status})`;
  }
  return err instanceof Error ? err.message : fallback;
}

/** Download an authorised file through the API (adds the bearer token) and save it. */
export async function downloadFile(url: string, fallbackName: string) {
  const res = await api.get(url, { responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const name = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Serialise a filter object to query params, dropping empty values. */
export function toParams(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  return out;
}
