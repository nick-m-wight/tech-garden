// A07 — Identification and Authentication Failures: access tokens refreshed automatically.
// A02 — Cryptographic Failures: tokens stored in SecureStore, never in memory beyond this module.
import { z } from 'zod';
import { env } from '../config/env';
import { saveTokens, getAccessToken, getRefreshToken, clearTokens } from '../auth/tokenStore';

const tokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

const loginResponseSchema = tokenResponseSchema;

async function request<T>(
  path: string,
  options: RequestInit,
  isRetry = false,
): Promise<T> {
  const accessToken = await getAccessToken();

  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (response.status === 401 && !isRetry) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      return request<T>(path, options, true);
    }
    throw new ApiError(401, 'Session expired. Please log in again.');
  }

  if (!response.ok) {
    throw new ApiError(response.status, `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function attemptTokenRefresh(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${env.apiBaseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      await clearTokens();
      return false;
    }

    const parsed = tokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      await clearTokens();
      return false;
    }

    await saveTokens(parsed.data.accessToken, parsed.data.refreshToken);
    return true;
  } catch {
    await clearTokens();
    return false;
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const apiClient = {
  async login(email: string, password: string): Promise<void> {
    const data = await request<unknown>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const parsed = loginResponseSchema.parse(data);
    await saveTokens(parsed.accessToken, parsed.refreshToken);
  },

  async logout(): Promise<void> {
    await request('/auth/logout', { method: 'POST' }).catch(() => {});
    await clearTokens();
  },

  async get<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'GET' });
  },

  async post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  },
};
