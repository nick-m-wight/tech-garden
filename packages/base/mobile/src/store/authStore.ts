import { create } from 'zustand';
import { jwtDecode } from 'jwt-decode';
import { getAccessToken, clearTokens } from '../auth/tokenStore';
import { apiClient } from '../api/client';

interface JwtPayload {
  userId: string;
  role: string;
  exp: number;
}

interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  role: string | null;
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  userId: null,
  role: null,

  async initialize() {
    const token = await getAccessToken();
    if (!token) {
      set({ isAuthenticated: false, userId: null, role: null });
      return;
    }
    try {
      const payload = jwtDecode<JwtPayload>(token);
      if (payload.exp * 1000 < Date.now()) {
        await clearTokens();
        set({ isAuthenticated: false, userId: null, role: null });
        return;
      }
      set({ isAuthenticated: true, userId: payload.userId, role: payload.role });
    } catch {
      await clearTokens();
      set({ isAuthenticated: false, userId: null, role: null });
    }
  },

  async login(email: string, password: string) {
    await apiClient.login(email, password);
    const token = await getAccessToken();
    if (!token) throw new Error('Login succeeded but no token was saved.');
    const payload = jwtDecode<JwtPayload>(token);
    set({ isAuthenticated: true, userId: payload.userId, role: payload.role });
  },

  async logout() {
    await apiClient.logout();
    set({ isAuthenticated: false, userId: null, role: null });
  },
}));
