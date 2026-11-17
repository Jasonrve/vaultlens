import { useAuthStore } from '../stores/authStore';

// Mirrors the server's requireAdmin: root or vaultlens-admin, including identity-granted policies.
export function useIsAdmin(): boolean {
  const tokenInfo = useAuthStore((s) => s.tokenInfo);
  const policies = [...(tokenInfo?.policies ?? []), ...(tokenInfo?.identity_policies ?? [])];
  return policies.includes('root') || policies.includes('vaultlens-admin');
}
