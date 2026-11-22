export type DiditServerConfig = {
  apiKey: string;
  workflowId: string;
  sessionUrl: string;
  callbackUrl: string;
};

function getAllowedAppBaseUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    const isLocalHttp = parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
    if (parsed.protocol !== 'https:' && !isLocalHttp) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Read Didit credentials/workflow only from the active deployment environment. */
export function getDiditServerConfig(): DiditServerConfig | null {
  const apiKey = process.env.DIDIT_API_KEY?.trim();
  const workflowId = process.env.DIDIT_WORKFLOW_ID?.trim();
  const rawApiUrl = process.env.DIDIT_API_URL?.trim() || 'https://verification.didit.me/v3';
  const appBaseUrl = getAllowedAppBaseUrl();

  if (!apiKey || !workflowId || !appBaseUrl) return null;

  try {
    const api = new URL(rawApiUrl);
    if (
      api.protocol !== 'https:' ||
      api.hostname !== 'verification.didit.me' ||
      api.port ||
      api.username ||
      api.password ||
      api.search ||
      api.hash ||
      api.pathname !== '/v3' &&
      api.pathname !== '/v3/'
    ) return null;

    return {
      apiKey,
      workflowId,
      sessionUrl: new URL('/v3/session/', api.origin).toString(),
      callbackUrl: new URL('/dashboard/kyc/callback', appBaseUrl).toString(),
    };
  } catch {
    return null;
  }
}