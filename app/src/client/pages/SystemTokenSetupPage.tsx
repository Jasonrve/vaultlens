import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';

type Step = 'status' | 'permissions' | 'preview' | 'create' | 'done' | 'error';

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

function StepIndicator({ current }: { current: Step }) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, idx) => {
        const done = idx < currentIndex;
        const active = idx === currentIndex;
        return (
          <div key={step.id} className="flex items-center">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold
              ${done ? 'bg-green-500 text-white' : active ? 'bg-[#1563ff] text-white' : 'bg-gray-200 text-gray-500'}`}>
              {done ? '✓' : idx + 1}
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`mx-2 h-1 w-8 ${done ? 'bg-green-400' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function SystemTokenSetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('status');
  const [status, setStatus] = useState<api.SysTokenStatus | null>(null);
  const [permissions, setPermissions] = useState<Awaited<ReturnType<typeof api.checkSysTokenPermissions>> | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewSysTokenSetup>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(true);

  // Step 1: Check status
  useEffect(() => {
    if (step !== 'status') return;
    setLoading(true);
    setError(null);
    api.getSysTokenStatus()
      .then((s) => {
        setStatus(s);
        // If system token is already configured, redirect to dashboard
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

  // Step 3: Preview
  useEffect(() => {
    if (step !== 'preview') return;
    setLoading(true);
    setError(null);
    api.previewSysTokenSetup()
      .then((result) => {
        setPreview(result);
        // Don't auto-advance — wait for user to review and decide
        setAutoAdvance(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load preview');
        setAutoAdvance(false);
      })
      .finally(() => setLoading(false));
  }, [step, autoAdvance]);

  // Step 4: Create AppRole (auto-run once user approves)
  useEffect(() => {
    if (step !== 'create') return;
    setLoading(true);
    setError(null);
    api.createAppRole()
      .then(() => api.testAppRole()) // Immediately test after creation
      .then(() => {
        setStep('done');
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to configure AppRole');
        setAutoAdvance(false);
      })
      .finally(() => setLoading(false));
  }, [step]);

  // Auto-return to dashboard after completion
  useEffect(() => {
    if (step === 'done') {
      const timer = setTimeout(() => {
        navigate('/', { replace: true });
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [step, navigate]);

  function handleApprove() {
    setAutoAdvance(true);
    setStep('create');
  }

  function handleCancel() {
    navigate('/', { replace: true });
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-2xl space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Set Up Background Services</h1>
          <p className="mt-2 text-base text-gray-600">
            VaultLens needs AppRole authentication to enable rotation, backup, and webhooks.
          </p>
        </div>

        <div className="rounded-lg bg-white p-8 shadow">
          <div className="mb-8">
            <StepIndicator current={step} />
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
                        AppRole auth method is not currently enabled. We'll enable it as part of the setup process.
                      </p>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}

          {/* Preview */}
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

          {/* Creating */}
          {step === 'create' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Setting up AppRole infrastructure…</p>
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
                <p className="font-semibold text-gray-900">AppRole Configured</p>
                <p className="mt-1 text-sm text-gray-600">Background services are now enabled.</p>
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

