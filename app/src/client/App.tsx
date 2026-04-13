import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuthStore } from './stores/authStore';
import { useBrandingStore } from './stores/brandingStore';
import Layout from './components/layout/Layout';
import LoginPage from './components/auth/LoginPage';
import OidcCallbackPage from './pages/OidcCallbackPage';
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
import ViewSharedSecretPage from './pages/ViewSharedSecretPage';
import AuditLogPage from './pages/AuditLogPage';
import AnalyticsPage from './pages/AnalyticsPage';
import SecretRotationPage from './pages/SecretRotationPage';
import BackupRestorePage from './pages/BackupRestorePage';
import HooksPage from './pages/HooksPage';
import LoadingSpinner from './components/common/LoadingSpinner';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { checkAuth, isAuthenticated } = useAuthStore();
  const { loadBranding } = useBrandingStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Load branding on startup (before auth check, available on login screen too)
    loadBranding();
    checkAuth().finally(() => setChecking(false));
  }, [checkAuth, loadBranding]);

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={
        isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />
      } />
      {/* OIDC popup callback — public, no Layout, no auth guard */}
      <Route path="/oidc-callback/:mountPath" element={<OidcCallbackPage />} />
      {/* Shared secret viewing — public, uses URL fragment for decryption */}
      <Route path="/shared/:id" element={<ViewSharedSecretPage />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
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
        <Route path="/tools/share" element={<ShareSecretPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
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
