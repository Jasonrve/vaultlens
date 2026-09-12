import { authenticationFailure } from '../lib/requestBackoff';
import { create } from 'zustand';
import * as api from '../lib/api';
import type { VaultTokenInfo } from '../types';

interface AuthState {
  authCheckError: string | null;
  authRetryAt: number;
  tokenInfo: Partial<VaultTokenInfo> | null;
  isAuthenticated: boolean;
  error: string | null;
  loading: boolean;
  login: (token: string) => Promise<void>;
  loginWithToken: (token: string, tokenInfo: Partial<VaultTokenInfo>) => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  refreshTokenInfo: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  authCheckError: null,
  authRetryAt: 0,
  tokenInfo: null,
  isAuthenticated: false,
  error: null,
  loading: false,

  login: async (token: string) => {
    set({ loading: true, error: null });
    try {
      const result = await api.login(token);
      set({
        tokenInfo: result.tokenInfo,
        isAuthenticated: true,
        authCheckError: null,
        authRetryAt: 0,
        loading: false,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Login failed';
      set({ error: message, loading: false });
      throw err;
    }
  },

  loginWithToken: (_token: string, tokenInfo: Partial<VaultTokenInfo>) => {
    set({ tokenInfo, isAuthenticated: true, error: null, loading: false, authCheckError: null, authRetryAt: 0 });
  },

  logout: async () => {
    try {
      await api.logout();
    } finally {
      // Clear the repair skip flag so the health check runs again on next login
      sessionStorage.removeItem('vaultlens_skip_repair_check');
      set({
        tokenInfo: null,
        isAuthenticated: false,
        authCheckError: null,
        authRetryAt: 0,
      });
    }
  },

  checkAuth: async () => {
    // vault_token is an httpOnly cookie — not visible to document.cookie.
    // We always call getMe() so a page reload after login (e.g. returning from
    // the shared-secret auth-login flow) correctly restores the session.
    try {
      const result = await api.getMe();
      set({
        tokenInfo: result.tokenInfo,
        isAuthenticated: true,
        authCheckError: null,
        authRetryAt: 0,
      });
    } catch (error) {
      const failure = authenticationFailure(error);
      if (failure.invalid) set({ tokenInfo: null, isAuthenticated: false, authCheckError: null, authRetryAt: 0 });
      else set({ authCheckError: failure.message, authRetryAt: failure.retryAt });
    }
  },

  refreshTokenInfo: async () => {
    try {
      const result = await api.getMe();
      set({
        tokenInfo: result.tokenInfo,
        isAuthenticated: true,
        authCheckError: null,
        authRetryAt: 0,
      });
    } catch (error) {
      const failure = authenticationFailure(error);
      if (failure.invalid) set({ tokenInfo: null, isAuthenticated: false, authCheckError: null, authRetryAt: 0 });
      else set({ authCheckError: failure.message, authRetryAt: failure.retryAt });
    }
  },
}));
