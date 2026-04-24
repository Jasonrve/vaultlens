import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import * as api from '../lib/api';

type Step = 'status' | 'permissions' | 'preview' | 'repair-review' | 'create' | 'done' | 'error';

interface StepDef {
  id: Step;
  label: string;
}

const STEPS: StepDef[] = [
  { id: 'status', label: 'Check Status' },
  { id: 'permissions', label: 'Verify Permissions' },
  { id: 'preview', label: 'Review Configuration' },
  { id: 'create', label: 'Set Up AppRole' },
  { id: 'done', label: 'Complete' },
];

const REPAIR_STEPS: StepDef[] = [
  { id: 'repair-review', label: 'Review Issues' },
  { id: 'create', label: 'Apply Fix' },
  { id: 'done', label: 'Complete' },
];

function StepIndicator({ current, steps }: { current: Step; steps: StepDef[] }) {
  const currentIndex = steps.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-0">
      {steps.map((step, idx) => {
        const done = idx < currentIndex;
        const active = idx === currentIndex;
        return (
          <div key={step.id} className="flex items-center">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold
              ${done ? 'bg-green-500 text-white' : active ? 'bg-[#1563ff] text-white' : 'bg-gray-200 text-gray-500'}`}>
              {done ? '✓' : idx + 1}
            </div>
            {idx < steps.length - 1 && (
              <div className={`mx-2 h-1 w-8 ${done ? 'bg-green-400' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function IssueBadge({ type }: { type: 'missing' | 'outdated' }) {
  return type === 'missing' ? (
    <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
      Missing
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
      Outdated
    </span>
  );
}

export default function SystemTokenSetupPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // Repair mode: issues passed from SystemTokenRequiredRoute via router state.
  // useState with lazy initializer ensures the value is stable across re-renders.
  const [repairIssues] = useState<api.SetupHealthIssue[]>(
    () => (location.state as { repairIssues?: api.SetupHealthIssue[] } | null)?.repairIssues ?? []
  );
  const isRepairMode = repairIssues.length > 0;

  const [step, setStep] = useState<Step>(isRepairMode ? 'repair-review' : 'status');
  const [permissions, setPermissions] = useState<Awaited<ReturnType<typeof api.checkSysTokenPermissions>> | null>(null);
  const [repairPermissions, setRepairPermissions] = useState<Awaited<ReturnType<typeof api.checkSysTokenPermissions>> | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewSysTokenSetup>> | null>(null);
  const [loading, setLoading] = useState(!isRepairMode); // repair-review needs no initial load
  const [error, setError] = useState<string | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [expandedHcl, setExpandedHcl] = useState<string | null>(null);

  const activeSteps = isRepairMode ? REPAIR_STEPS : STEPS;

  // Repair mode: check if logged-in user has sufficient permissions to apply fixes
  useEffect(() => {
    if (step !== 'repair-review') return;
    setLoading(true);
    api.checkSysTokenPermissions()
      .then((result) => setRepairPermissions(result))
      .catch(() => setRepairPermissions(null))
      .finally(() => setLoading(false));
  }, [step]);

  // Step 1: Check status (initial setup only)
  useEffect(() => {
    if (step !== 'status') return;
    setLoading(true);
    setError(null);
    api.getSysTokenStatus()
      .then((s) => {
        if (s.hasSystemToken) {
          navigate('/', { replace: true });
          return;
        }
        if (autoAdvance) setStep('permissions');
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load status');
        setStep('error');
      })
      .finally(() => setLoading(false));
  }, [step, autoAdvance, navigate]);

  // Step 2: Check permissions
  useEffect(() => {
    if (step !== 'permissions') return;
    setLoading(true);
    setError(null);
    api.checkSysTokenPermissions()
      .then((result) => {
        setPermissions(result);
        if (!result.canCreate) {
          setAutoAdvance(false);
        } else if (autoAdvance) {
          setStep('preview');
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to check permissions');
        setAutoAdvance(false);
      })
      .finally(() => setLoading(false));
  }, [step, autoAdvance]);

  // Step 3: Preview (initial setup only)
  useEffect(() => {
    if (step !== 'preview') return;
    setLoading(true);
    setError(null);
    api.previewSysTokenSetup()
      .then((result) => {
        setPreview(result);
        setAutoAdvance(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load preview');
        setAutoAdvance(false);
      })
      .finally(() => setLoading(false));
  }, [step, autoAdvance]);

  // Step 4: Create AppRole (initial setup) OR Repair (repair mode)
  useEffect(() => {
    if (step !== 'create') return;
    setLoading(true);
    setError(null);
    const work = isRepairMode
      ? api.repairSetup(repairIssues)
      : api.createAppRole().then(() => api.testAppRole());
    work
      .then(() => setStep('done'))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : isRepairMode ? 'Repair failed' : 'Failed to configure AppRole');
        setAutoAdvance(false);
      })
      .finally(() => setLoading(false));
  // repairIssues and isRepairMode are stable (from useState with lazy initializer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Auto-return to dashboard after completion
  useEffect(() => {
    if (step === 'done') {
      // After successful repair, set the skip-flag to prevent immediate re-redirect on the next dashboard mount.
      // The flag will be cleared on next browser session, allowing fresh health checks.
      if (isRepairMode) {
        sessionStorage.setItem('vaultlens_skip_repair_check', '1');
      }
      const timer = setTimeout(() => {
        navigate('/', { replace: true });
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [step, navigate, isRepairMode]);

  function handleApprove() {
    setAutoAdvance(true);
    setStep('create');
  }

  function handleCancel() {
    if (isRepairMode) {
      // Set a session flag so SystemTokenRequiredRoute doesn't immediately re-redirect
      sessionStorage.setItem('vaultlens_skip_repair_check', '1');
    }
    navigate('/', { replace: true });
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-2xl space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">
            {isRepairMode ? 'Configuration Issues Detected' : 'Set Up Background Services'}
          </h1>
          <p className="mt-2 text-base text-gray-600">
            {isRepairMode
              ? 'Some VaultLens components are missing or out of date. Review the issues below and approve the fix.'
              : 'VaultLens needs AppRole authentication to enable rotation, backup, and webhooks.'}
          </p>
        </div>

        <div className="rounded-lg bg-white p-8 shadow">
          <div className="mb-8">
            <StepIndicator current={step} steps={activeSteps} />
          </div>

          {error && step !== 'error' && (
            <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Status check */}
          {step === 'status' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Checking current configuration…</p>
              <div className="h-2 w-24 animate-pulse rounded bg-gray-200" />
            </div>
          )}

          {/* Permissions check */}
          {step === 'permissions' && (
            <div className="space-y-4">
              {loading ? (
                <>
                  <p className="text-sm text-gray-600">Verifying your permissions…</p>
                  <div className="h-2 w-32 animate-pulse rounded bg-gray-200" />
                </>
              ) : permissions ? (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${permissions.canCreate ? 'bg-green-400' : 'bg-red-400'}`} />
                      <span className="text-sm text-gray-700">
                        {permissions.canCreate ? '✓ You have sufficient permissions' : '✗ Missing required permissions'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${permissions.approleEnabled ? 'bg-green-400' : 'bg-amber-400'}`} />
                      <span className="text-sm text-gray-700">
                        {permissions.approleEnabled ? '✓ AppRole is enabled' : '◆ AppRole will be enabled'}
                      </span>
                    </div>
                  </div>
                  {!permissions.canCreate && (
                    <div className="rounded bg-red-50 border border-red-200 p-3">
                      <p className="text-sm text-red-700">
                        You need additional permissions. Contact a Vault administrator.
                      </p>
                    </div>
                  )}
                  {!permissions.approleEnabled && (
                    <div className="rounded bg-amber-50 border border-amber-200 p-3">
                      <p className="text-sm text-amber-700">
                        AppRole auth method is not currently enabled. We&apos;ll enable it as part of the setup process.
                      </p>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}

          {/* Preview (initial setup) */}
          {step === 'preview' && (
            <div className="space-y-4">
              {preview?.approleNeedsEnabled && (
                <div className="rounded bg-amber-50 border border-amber-200 p-3">
                  <p className="text-sm text-amber-700">
                    • <strong>Enable AppRole:</strong> AppRole auth method will be enabled
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Policy</p>
                <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-auto max-h-32 font-mono text-gray-700 whitespace-pre-wrap">
                  {preview?.policy.hcl}
                </pre>
              </div>
              <div className="rounded bg-blue-50 border border-blue-200 p-4 space-y-2">
                <p className="text-sm font-medium text-blue-900">This will create:</p>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• <strong>Policy:</strong> {preview?.policy.name}</li>
                  <li>• <strong>AppRole:</strong> {preview?.approleRole.name}</li>
                  <li>• <strong>Permissions:</strong> System-level access for background services</li>
                </ul>
              </div>
            </div>
          )}

          {/* Repair review */}
          {step === 'repair-review' && (
            <div className="space-y-5">
              <p className="text-sm text-gray-600">
                The following issues were detected with your VaultLens configuration. Approving will apply the fixes automatically.
              </p>
              <div className="space-y-3">
                {repairIssues.map((issue) => (
                  <div key={issue.item} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <IssueBadge type={issue.type} />
                          <span className="text-sm font-medium text-gray-900">{issue.name}</span>
                        </div>
                        <p className="text-sm text-gray-600">{issue.description}</p>
                        <p className="text-xs text-gray-500">
                          {issue.item === 'approle-role'
                            ? 'Will be re-created. New credentials will be generated and stored securely.'
                            : `Will be ${issue.type === 'missing' ? 'created' : 'updated'} with the current expected content.`}
                        </p>
                      </div>
                      {issue.expectedHcl && (
                        <button
                          onClick={() => setExpandedHcl(expandedHcl === issue.item ? null : issue.item)}
                          className="shrink-0 text-xs text-[#1563ff] hover:underline"
                        >
                          {expandedHcl === issue.item ? 'Hide HCL' : 'View HCL'}
                        </button>
                      )}
                    </div>
                    {expandedHcl === issue.item && issue.expectedHcl && (
                      <pre className="mt-3 text-xs bg-white border border-gray-200 rounded p-3 overflow-auto max-h-40 font-mono text-gray-700 whitespace-pre-wrap">
                        {issue.expectedHcl}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
              {loading && (
                <div className="h-2 w-32 animate-pulse rounded bg-gray-200" />
              )}
              {!loading && repairPermissions && !repairPermissions.canCreate && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-2">
                  <p className="text-sm font-semibold text-red-800">Insufficient permissions</p>
                  <p className="text-sm text-red-700">
                    Your account does not have the Vault permissions required to apply these fixes.
                    Please contact a Vault administrator to complete this setup.
                  </p>
                  <ul className="mt-1 space-y-1">
                    {repairPermissions.missingCapabilities.map((cap) => (
                      <li key={cap} className="text-xs text-red-600 font-mono">• {cap}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!loading && repairPermissions?.canCreate && (
                <div className="rounded bg-blue-50 border border-blue-200 p-3">
                  <p className="text-sm text-blue-800">
                    <strong>Effect:</strong> Background services (rotation, backup, webhooks) will be restored. All existing secrets are unaffected.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Creating / Repairing */}
          {step === 'create' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                {isRepairMode ? 'Applying fixes…' : 'Setting up AppRole infrastructure…'}
              </p>
              <div className="h-2 w-40 animate-pulse rounded bg-[#1563ff]" />
            </div>
          )}

          {/* Done */}
          {step === 'done' && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                  <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
              <div className="text-center">
                <p className="font-semibold text-gray-900">
                  {isRepairMode ? 'Configuration Repaired' : 'AppRole Configured'}
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  {isRepairMode ? 'All issues have been resolved.' : 'Background services are now enabled.'}
                </p>
              </div>
              <p className="text-xs text-gray-500 text-center">Redirecting to dashboard…</p>
            </div>
          )}

          {/* Error */}
          {step === 'error' && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                  <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
              </div>
              <div className="text-center">
                <p className="font-semibold text-gray-900">Setup Failed</p>
                <p className="mt-1 text-sm text-red-600">{error}</p>
              </div>
              <div className="flex justify-center">
                <button
                  onClick={handleCancel}
                  className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  ← Back to Dashboard
                </button>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-8 flex items-center justify-between gap-3 border-t border-gray-200 pt-6">
            {/* Initial setup: approve after preview */}
            {step === 'preview' && !loading && (
              <>
                <button
                  onClick={handleCancel}
                  className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApprove}
                  className="rounded px-4 py-2 text-sm font-medium text-white bg-[#1563ff] hover:bg-[#1250d4]"
                >
                  Set Up AppRole →
                </button>
              </>
            )}

            {/* Repair mode: approve or skip */}
            {step === 'repair-review' && !loading && (
              <>
                <button
                  onClick={handleCancel}
                  className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Skip for now
                </button>
                <button
                  onClick={handleApprove}
                  disabled={repairPermissions !== null && !repairPermissions.canCreate}
                  className="rounded px-4 py-2 text-sm font-medium text-white bg-[#1563ff] hover:bg-[#1250d4] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Approve &amp; Fix →
                </button>
              </>
            )}

            {(step === 'create' || (step === 'permissions' && !autoAdvance && loading)) && (
              <div className="text-center flex-1">
                <div className="inline-flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-[#1563ff] animate-pulse" />
                  <span className="text-sm text-gray-600">Processing…</span>
                </div>
              </div>
            )}
            {step === 'error' && (
              <button
                onClick={handleCancel}
                className="w-full rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                ← Back to Dashboard
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

