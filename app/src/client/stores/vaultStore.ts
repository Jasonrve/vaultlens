import { create } from 'zustand';
import * as api from '../lib/api';
import type { SecretEngine, AuthMethod } from '../types';

interface VaultState {
  engines: SecretEngine[];
  currentPath: string;
  secrets: { keys: string[]; mount: string; version: number } | null;
  policies: string[];
  authMethods: AuthMethod[];
  fetchEngines: () => Promise<void>;
  fetchSecrets: (path: string) => Promise<void>;
  fetchPolicies: () => Promise<void>;
  fetchAuthMethods: () => Promise<void>;
}

export const useVaultStore = create<VaultState>((set) => ({
  engines: [],
  currentPath: '',
  secrets: null,
  policies: [],
  authMethods: [],

  fetchEngines: async () => {
    const engines = await api.getEngines();
    set({ engines });
  },

  fetchSecrets: async (path: string) => {
    set({ currentPath: path });
    const secrets = await api.listSecrets(path);
    set({ secrets });
  },

  fetchPolicies: async () => {
    const policies = await api.getPolicies();
    set({ policies });
  },

  fetchAuthMethods: async () => {
    const authMethods = await api.getAuthMethods();
    set({ authMethods });
  },
}));
