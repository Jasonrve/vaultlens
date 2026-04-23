import { create } from 'zustand';
import axios from 'axios';

export interface BrandingConfig {
  logo: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  appName: string;
}

const DEFAULT_BRANDING: BrandingConfig = {
  logo: '',
  primaryColor: '#1563ff',
  secondaryColor: '#19191a',
  backgroundColor: '#f6f6f6',
  appName: 'VaultLens',
};

function applyBrandingToDOM(branding: BrandingConfig): void {
  const root = document.documentElement;
  root.style.setProperty('--brand-primary', branding.primaryColor);
  root.style.setProperty('--brand-secondary', branding.secondaryColor);
  root.style.setProperty('--brand-background', branding.backgroundColor);
  root.style.setProperty('--brand-logo', branding.logo ? `url(${branding.logo})` : 'none');
}

interface BrandingState {
  branding: BrandingConfig;
  loading: boolean;
  error: string | null;
  loadBranding: () => Promise<void>;
  updateBranding: (config: Partial<BrandingConfig>) => Promise<void>;
  uploadLogo: (file: File) => Promise<void>;
  removeLogo: () => Promise<void>;
}

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// Read CSRF token from cookie and attach to state-changing requests
api.interceptors.request.use((reqConfig) => {
  const method = (reqConfig.method || '').toUpperCase();
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
    if (match?.[1]) {
      reqConfig.headers['X-CSRF-Token'] = decodeURIComponent(match[1]);
    }
  }
  return reqConfig;
});

export const useBrandingStore = create<BrandingState>((set, get) => ({
  branding: { ...DEFAULT_BRANDING },
  loading: false,
  error: null,

  loadBranding: async () => {
    try {
      const { data } = await api.get<BrandingConfig>('/branding');
      const branding = { ...DEFAULT_BRANDING, ...data };
      applyBrandingToDOM(branding);
      set({ branding, error: null });
    } catch {
      // Use defaults silently
      applyBrandingToDOM(DEFAULT_BRANDING);
      set({ branding: { ...DEFAULT_BRANDING } });
    }
  },

  updateBranding: async (config: Partial<BrandingConfig>) => {
    set({ loading: true, error: null });
    try {
      const { data } = await api.put<BrandingConfig>('/branding', config);
      const branding = { ...DEFAULT_BRANDING, ...data };
      applyBrandingToDOM(branding);
      set({ branding, loading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update branding';
      set({ error: message, loading: false });
      throw err;
    }
  },

  uploadLogo: async (file: File) => {
    set({ loading: true, error: null });
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const { data } = await api.post<{ logo: string }>('/branding/logo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const current = get().branding;
      const branding = { ...current, logo: data.logo };
      applyBrandingToDOM(branding);
      set({ branding, loading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to upload logo';
      set({ error: message, loading: false });
      throw err;
    }
  },

  removeLogo: async () => {
    set({ loading: true, error: null });
    try {
      await api.delete('/branding/logo');
      const current = get().branding;
      const branding = { ...current, logo: '' };
      applyBrandingToDOM(branding);
      set({ branding, loading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to remove logo';
      set({ error: message, loading: false });
      throw err;
    }
  },
}));
