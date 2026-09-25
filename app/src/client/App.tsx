import { retryQuery } from './lib/requestBackoff';
import AuditWorkspace from './components/AuditWorkspace';
import AuditReportsPage from './pages/AuditReportsPage';
import AuditRunsPage from './pages/AuditRunsPage';
import AuditSourcesPage from './pages/AuditSourcesPage';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuthStore } from './stores/authStore';
import { useBrandingStore } from './stores/brandingStore';
import * as api from './lib/api';
import Layout from './components/layout/Layout';
import LoginPage from './components/auth/LoginPage';
import OidcCallbackPage from './pages/OidcCallbackPage';
import AuditObjectExceptions from './components/AuditObjectExceptions';
import AuditRulesPage from './pages/AuditRulesPage';
import SecurityAuditPage from './pages/SecurityAuditPage';
import DashboardPage from './pages/DashboardPage';
import SecretsPage from './pages/SecretsPage';
import PoliciesPage from './pages/PoliciesPage';
import AuthMethodsPage from './pages/AuthMethodsPage';
import IdentityPage from './pages/IdentityPage';
import VisualizationsPage from './pages/VisualizationsPage';
import MyIdentityPage from './pages/MyIdentityPage';
import AdminBrandingPage from './pages/AdminBrandingPage';
import PermissionTesterPage from './pages/PermissionTesterPage';
import ShareSecretPage from './pages/ShareSecretPage';
import SecretGeneratorPage from './pages/SecretGeneratorPage';
import ViewSharedSecretPage from './pages/ViewSharedSecretPage';
import AuditLogPage from './pages/AuditLogPage';
import AnalyticsPage from './pages/AnalyticsPage';
import SecretRotationPage from './pages/SecretRotationPage';
import BackupRestorePage from './pages/BackupRestorePage';
import HooksPage from './pages/HooksPage';
import SystemTokenSetupPage from './pages/SystemTokenSetupPage';
import VaultLensAuditPage from './pages/VaultLensAuditPage';
import FeaturesSettingsPage from './pages/FeaturesSettingsPage';
import ChangelogPage from './pages/ChangelogPage';
import LoadingSpinner from './components/common/LoadingSpinner';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: retryQuery,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to={location.pathname.startsWith('/security-audit') ? '/login?returnTo=security-audit' : '/login'} replace />;
  }
  return <>{children}</>;
}

/**
 * Enforces system token setup before allowing access to protected routes.
 * If system token hasn't been configured, forces redirect to wizard.
 * If system token is configured but policies/AppRole are drifted, redirects
 * to the repair wizard (passing the detected issues via router state).
 */
function SystemTokenRequiredRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  const [systemTokenStatus, setSystemTokenStatus] = useState<{ hasSystemToken: boolean } | null>(null);
  const [repairIssues, setRepairIssues] = useState<api.SetupHealthIssue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    // Skip the health check if the user explicitly dismissed the repair prompt
    // during this browser session (avoids an infinite redirect loop on cancel).
    const skipRepair = sessionStorage.getItem('vaultlens_skip_repair_check') === '1';

    api.getSysTokenStatus()
      .then(async (status) => {
        setSystemTokenStatus(status);
        if (status.hasSystemToken && !skipRepair) {
          try {
            const health = await api.getSetupHealthCheck();
            if (!health.healthy) {
              setRepairIssues(health.issues);
            }
          } catch {
            // Health check API itself failed (network error, server error).
            // Treat both VaultLens policies as missing so the user is directed
            // to repair rather than silently passing through to the dashboard.
            setRepairIssues([
              {
                type: 'missing' as const,
                item: 'system-policy' as const,
                name: 'vaultlens-system-policy',
                description: 'Could not verify policy status. Click Approve to re-apply VaultLens policies.',
              },
              {
                type: 'missing' as const,
                item: 'admin-policy' as const,
                name: 'vaultlens-admin',
                description: 'Could not verify policy status. Click Approve to re-apply VaultLens policies.',
              },
            ]);
          }
        }
      })
      .catch(() => {
        setSystemTokenStatus({ hasSystemToken: false });
      })
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (loading) return <LoadingSpinner />;

  // Force setup if system token not configured
  if (!systemTokenStatus?.hasSystemToken) {
    return <Navigate to="/setup" replace />;
  }

  // Redirect to repair wizard if health check found issues
  if (repairIssues.length > 0) {
    return <Navigate to="/setup" state={{ repairIssues }} replace />;
  }

  return <>{children}</>;
}

/**
 * Guards the setup page to prevent access if system token is already configured.
 * Allows access when navigated with repairIssues in router state (repair mode).
 */
function SetupRouteGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  const location = useLocation();
  const [systemTokenStatus, setSystemTokenStatus] = useState<{ hasSystemToken: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    api.getSysTokenStatus()
      .then((status) => setSystemTokenStatus(status))
      .catch(() => {
        setSystemTokenStatus({ hasSystemToken: false });
      })
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (loading) return <LoadingSpinner />;

  // Allow access when repair mode is active (issues passed via router state)
  const isRepairMode = !!(location.state as { repairIssues?: unknown } | null)?.repairIssues;

  // If system token is already configured AND this is not a repair, redirect to dashboard
  if (systemTokenStatus?.hasSystemToken && !isRepairMode) {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const location = useLocation();
  const { checkAuth, isAuthenticated, authCheckError, authRetryAt } = useAuthStore();
  const { loadBranding } = useBrandingStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Load branding on startup (before auth check, available on login screen too)
    loadBranding();
    checkAuth().finally(() => setChecking(false));
  }, [checkAuth, loadBranding]);

  useEffect(() => {
    if (!authCheckError) return;
    const timer = window.setTimeout(() => void checkAuth(), Math.max(1000, authRetryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [authCheckError, authRetryAt, checkAuth]);

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (authCheckError && !isAuthenticated) {
    return <main className="flex min-h-screen items-center justify-center bg-white p-6">
      <div className="max-w-md space-y-4" role="alert">
        <h1 className="text-lg font-semibold">Session check temporarily unavailable</h1>
        <p className="text-sm text-slate-600">{authCheckError}</p>
        <button className="rounded bg-blue-600 px-4 py-2 text-white" onClick={() => void checkAuth()}>Retry session check</button>
      </div>
    </main>;
  }

  return (
    <Routes>
      <Route path="/login" element={
        isAuthenticated ? <Navigate to={new URLSearchParams(location.search).get('returnTo') === 'security-audit' ? '/security-audit' : '/app'} replace /> : <LoginPage />
      } />
      {/* OIDC popup callback — public, no Layout, no auth guard */}
      <Route path="/oidc-callback/:mountPath" element={<OidcCallbackPage />} />
      {/* Shared secret viewing — public, uses URL fragment for decryption */}
      <Route path="/shared/:id" element={<ViewSharedSecretPage />} />
      {/* System token setup — only show if not already configured */}
      <Route path="/setup" element={
        <SetupRouteGuard>
          <SystemTokenSetupPage />
        </SetupRouteGuard>
      } />

      {/* Root: redirect to dashboard if logged in, otherwise to login */}
      <Route path="/" element={
        isAuthenticated ? <Navigate to="/app" replace /> : <Navigate to="/login" replace />
      } />


      {/* Authenticated VaultLens app */}
      <Route
        element={
          <ProtectedRoute>
            <SystemTokenRequiredRoute>
              <Layout />
            </SystemTokenRequiredRoute>
          </ProtectedRoute>
        }
      >
        <Route path="/app" element={<DashboardPage />} />
        <Route path="/secrets/*" element={<SecretsPage />} />
        <Route path="/policies/*" element={<PoliciesPage />} />
        <Route path="/access/auth-methods/*" element={<AuthMethodsPage />} />
        <Route path="/access/entities/*" element={<IdentityPage type="entities" />} />
        <Route path="/access/groups/*" element={<IdentityPage type="groups" />} />
        <Route path="/visualizations" element={<VisualizationsPage />} />
        <Route path="/identity" element={<MyIdentityPage />} />
        <Route path="/admin/branding" element={<AdminBrandingPage />} />
        <Route path="/admin/permission-tester" element={<PermissionTesterPage />} />
        <Route path="/admin/audit-log" element={<AuditLogPage />} />
        <Route path="/admin/analytics" element={<AnalyticsPage />} />
        <Route path="/admin/rotation" element={<SecretRotationPage />} />
        <Route path="/admin/backup" element={<BackupRestorePage />} />
        <Route path="/admin/hooks" element={<HooksPage />} />
        <Route path="/admin/sharing-settings" element={<Navigate to="/admin/features" replace />} />
        <Route path="/admin/policies-settings" element={<Navigate to="/admin/features" replace />} />
        <Route path="/admin/auth-methods-settings" element={<Navigate to="/admin/features" replace />} />
        <Route path="/admin/features" element={<FeaturesSettingsPage />} />
        <Route path="/admin/changelog" element={<ChangelogPage />} />
        <Route path="/admin/sharing-audit" element={<VaultLensAuditPage />} />
        <Route path="/tools/share" element={<ShareSecretPage />} />
        <Route path="/tools/generator" element={<SecretGeneratorPage />} />
      </Route>
      {/* Read-only audit does not need background-service provisioning. */}
      <Route path="/security-audit" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route element={<AuditWorkspace />}>
          <Route index element={<Navigate to="findings" replace />} />
          <Route path="findings" element={<SecurityAuditPage />} />
          <Route path="runs" element={<AuditRunsPage />} />
          <Route path="reports" element={<AuditReportsPage />} />
          <Route path="checks" element={<AuditRulesPage />} />
          <Route path="exceptions" element={<AuditObjectExceptions />} />
          <Route path="sources" element={<AuditSourcesPage />} />
          <Route path="rules" element={<Navigate to="../checks" replace />} />
        </Route>
      </Route>
        <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
