/**
 * Power BI Service integration (server side only).
 *
 * Two independent, optional capabilities:
 *  1. Secure embed URL — the React page shows the published report in an iframe; each viewer signs
 *     in with their own Microsoft account and Power BI enforces their permissions. No token is
 *     generated or sent to the browser by this server.
 *  2. Service principal (Azure AD app, client-credentials) — used ONLY by this server to verify the
 *     configuration and trigger/inspect dataset refreshes. The client secret and AAD access token
 *     never leave the server.
 */
import { env } from '../config/env.js';

const SCOPE = 'https://analysis.windows.net/powerbi/api/.default';
const API = 'https://api.powerbi.com/v1.0/myorg';

let cachedToken: { token: string; expiresAt: number } | null = null;

export function powerBiConfig() {
  const servicePrincipal = Boolean(env.POWERBI_TENANT_ID && env.POWERBI_CLIENT_ID && env.POWERBI_CLIENT_SECRET && env.POWERBI_WORKSPACE_ID);
  return {
    secureEmbedConfigured: Boolean(env.POWERBI_SECURE_EMBED_URL),
    secureEmbedUrl: env.POWERBI_SECURE_EMBED_URL ?? null,
    servicePrincipalConfigured: servicePrincipal,
    datasetConfigured: servicePrincipal && Boolean(env.POWERBI_DATASET_ID),
    reportConfigured: servicePrincipal && Boolean(env.POWERBI_REPORT_ID),
    // Identifiers are not secrets, but only the last characters are shown to keep screens tidy.
    tenantId: mask(env.POWERBI_TENANT_ID),
    clientId: mask(env.POWERBI_CLIENT_ID),
    workspaceId: mask(env.POWERBI_WORKSPACE_ID),
    datasetId: mask(env.POWERBI_DATASET_ID),
    reportId: mask(env.POWERBI_REPORT_ID),
  };
}

function mask(v?: string) {
  return v ? `…${v.slice(-6)}` : null;
}

export class PowerBiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const cfg = powerBiConfig();
  if (!cfg.servicePrincipalConfigured) throw new PowerBiError('Service principal is not configured');
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env.POWERBI_TENANT_ID!)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.POWERBI_CLIENT_ID!,
      client_secret: env.POWERBI_CLIENT_SECRET!,
      scope: SCOPE,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new PowerBiError(`Azure AD token request failed: ${body.error_description?.split('\r\n')[0] ?? body.error ?? res.status}`, res.status);
  }
  cachedToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

async function pbi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 202) return {} as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new PowerBiError(body?.error?.message ?? body?.error?.code ?? `Power BI API error ${res.status}`, res.status);
  return body as T;
}

/** Live verification: only reports "connected" if Microsoft actually answered. */
export async function verifyConnection() {
  const cfg = powerBiConfig();
  if (!cfg.servicePrincipalConfigured) return { checked: false, connected: false, reason: 'Service principal not configured' };
  try {
    const ws = env.POWERBI_WORKSPACE_ID!;
    const result: Record<string, unknown> = { checked: true, connected: true };
    if (env.POWERBI_DATASET_ID) {
      const ds = await pbi<any>(`/groups/${ws}/datasets/${env.POWERBI_DATASET_ID}`);
      result.dataset = { name: ds.name, configuredBy: ds.configuredBy, isRefreshable: ds.isRefreshable };
    }
    if (env.POWERBI_REPORT_ID) {
      const rp = await pbi<any>(`/groups/${ws}/reports/${env.POWERBI_REPORT_ID}`);
      result.report = { name: rp.name, webUrl: rp.webUrl };
    }
    return result;
  } catch (err) {
    return { checked: true, connected: false, reason: (err as Error).message };
  }
}

export async function triggerRefresh() {
  const cfg = powerBiConfig();
  if (!cfg.datasetConfigured) throw new PowerBiError('Dataset refresh requires POWERBI_DATASET_ID and a service principal');
  await pbi(`/groups/${env.POWERBI_WORKSPACE_ID}/datasets/${env.POWERBI_DATASET_ID}/refreshes`, {
    method: 'POST',
    body: JSON.stringify({ notifyOption: 'NoNotification' }),
  });
  return { requested: true };
}

export async function refreshHistory() {
  const cfg = powerBiConfig();
  if (!cfg.datasetConfigured) return [];
  const body = await pbi<{ value: any[] }>(`/groups/${env.POWERBI_WORKSPACE_ID}/datasets/${env.POWERBI_DATASET_ID}/refreshes?$top=10`);
  return body.value.map((r) => ({ status: r.status, startTime: r.startTime, endTime: r.endTime, refreshType: r.refreshType, error: r.serviceExceptionJson ?? null }));
}
