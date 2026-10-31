import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { useAuth } from '@/stores/auth';

export const api = axios.create({ baseURL: '/api/v1', withCredentials: true, timeout: 30_000 });

export interface ApiMeta {
  page?: number;
  limit?: number;
  total?: number;
  pages?: number;
  unread?: number;
  [k: string]: unknown;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

api.interceptors.request.use((cfg) => {
  const t = useAuth.getState().accessToken;
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

let refreshing: Promise<string | null> | null = null;
export async function refreshSession(): Promise<string | null> {
  refreshing ??= axios
    .post('/api/v1/auth/refresh', null, { withCredentials: true, headers: { 'X-Requested-With': 'pos-web' } })
    .then((r) => {
      useAuth.getState().setSession(r.data.data.accessToken, r.data.data.user);
      return r.data.data.accessToken as string;
    })
    .catch(() => {
      useAuth.getState().clear();
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError<{ error?: { message: string; code: string; details?: unknown } }>) => {
    const cfg = err.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const isAuthCall = cfg?.url?.startsWith('/auth/login') || cfg?.url?.startsWith('/auth/refresh');
    if (err.response?.status === 401 && cfg && !cfg._retried && !isAuthCall) {
      cfg._retried = true;
      const t = await refreshSession();
      if (t) {
        cfg.headers = { ...cfg.headers, Authorization: `Bearer ${t}` } as never;
        return api.request(cfg);
      }
    }
    const e = err.response?.data?.error;
    throw new ApiError(
      e?.message ?? (err.code === 'ERR_NETWORK' ? 'Cannot reach the server' : err.message),
      err.response?.status ?? 0,
      e?.code ?? 'NETWORK',
      e?.details,
    );
  },
);

export const get = async <T>(url: string, params?: object) => {
  const r = await api.get(url, { params });
  return r.data as { data: T; meta?: ApiMeta };
};
export const send = async <T>(
  method: 'post' | 'put' | 'patch' | 'delete',
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
) => {
  const r = await api.request({ method, url, data: body, headers });
  return r.data as { data: T; meta?: ApiMeta };
};
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

/** Download a CSV (or any file) through the authenticated client. */
export async function download(url: string, params: object, filename: string) {
  const r = await api.get(url, { params, responseType: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(r.data);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
