import { create } from 'zustand';

export type Role = 'OWNER' | 'MANAGER' | 'CASHIER' | 'DEMO';
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone?: string;
  mustChangePassword: boolean;
  permissions: string[];
}

interface AuthState {
  accessToken: string | null;
  user: SessionUser | null;
  /** true until the first silent refresh attempt finished */
  ready: boolean;
  setSession: (token: string, user: SessionUser) => void;
  setUser: (user: SessionUser) => void;
  setReady: () => void;
  clear: () => void;
  can: (permission: string) => boolean;
}

/** The access token lives in memory only; the refresh token is an httpOnly cookie managed by the server. */
export const useAuth = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  ready: false,
  setSession: (accessToken, user) => set({ accessToken, user, ready: true }),
  setUser: (user) => set({ user }),
  setReady: () => set({ ready: true }),
  clear: () => set({ accessToken: null, user: null, ready: true }),
  can: (p) => !!get().user?.permissions.includes(p),
}));

export const useCan = (p: string) => useAuth((s) => !!s.user?.permissions.includes(p));
