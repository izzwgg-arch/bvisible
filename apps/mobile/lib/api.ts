import Constants from 'expo-constants';
import {
  getAccessToken,
  getRefreshToken,
  saveTokens,
  clearTokens,
} from './session';

function baseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (fromEnv && typeof fromEnv === 'string' && fromEnv.length > 0) {
    return fromEnv.replace(/\/+$/, '');
  }
  const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
  const u = extra?.apiBaseUrl;
  if (u && u.length > 0) return u.replace(/\/+$/, '');
  return '';
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: { code: string; message: string };
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

async function authHeaders(
  init: RequestInit | undefined,
  access: string | null
): Promise<Headers> {
  const h = new Headers(init?.headers ?? undefined);
  if (access) h.set('Authorization', `Bearer ${access}`);
  return h;
}

async function refreshPair(): Promise<boolean> {
  const refresh = await getRefreshToken();
  const root = baseUrl();
  if (!refresh || !root) return false;

  const res = await fetch(`${root}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refreshToken: refresh }),
  });

  const json = (await res.json()) as ApiEnvelope<{
    accessToken: string;
    refreshToken: string;
  }>;

  if (!json.ok || res.status >= 400) return false;
  await saveTokens(json.data.accessToken, json.data.refreshToken);
  return true;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { skipAuth?: boolean }
): Promise<{ res: Response; json: ApiEnvelope<T> }> {
  const root = baseUrl();
  if (!root) {
    return {
      res: new Response(null, { status: 500 }),
      json: {
        ok: false,
        error: {
          code: 'no_api_base',
          message:
            'Set EXPO_PUBLIC_API_BASE_URL to your HTTPS origin (same host as the web app).',
        },
      },
    };
  }

  const url = `${root}${path.startsWith('/') ? '' : '/'}${path}`;

  const doFetch = async () => {
    const access = init?.skipAuth ? null : await getAccessToken();
    const headers = await authHeaders(init, access);
    const res = await fetch(url, { ...init, headers });
    const json = (await res.json()) as ApiEnvelope<T>;
    return { res, json };
  };

  let out = await doFetch();

  if (
    !init?.skipAuth &&
    out.res.status === 401 &&
    out.json.ok === false
  ) {
    const ok = await refreshPair();
    if (ok) out = await doFetch();
  }

  return out;
}

export async function apiJson<T>(
  path: string,
  init?: RequestInit & { skipAuth?: boolean }
): Promise<T> {
  const headers = new Headers(init?.headers ?? undefined);
  headers.set('Accept', 'application/json');
  const { res, json } = await apiFetch<T>(path, { ...init, headers });
  if (!json.ok) {
    throw new Error(json.error.message || `HTTP ${res.status}`);
  }
  return json.data;
}

export { baseUrl, clearTokens, saveTokens };
