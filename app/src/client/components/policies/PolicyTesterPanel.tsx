import { useState } from 'react';
import { evaluateSinglePolicy } from '../../../shared/policyEvaluator';

const ALL_CAPABILITIES = ['create', 'read', 'update', 'delete', 'list', 'sudo', 'deny'] as const;
type Capability = (typeof ALL_CAPABILITIES)[number];

const CAP_COLORS: Record<Capability, string> = {
  create: 'bg-green-100 text-green-700 border-green-300',
  read: 'bg-blue-100 text-blue-700 border-blue-300',
  update: 'bg-amber-100 text-amber-700 border-amber-300',
  delete: 'bg-red-100 text-red-700 border-red-300',
  list: 'bg-purple-100 text-purple-700 border-purple-300',
  sudo: 'bg-orange-100 text-orange-700 border-orange-300',
  deny: 'bg-gray-200 text-gray-700 border-gray-400',
};

const TEST_OPERATIONS = ['create', 'read', 'update', 'delete', 'list', 'sudo'] as const;

export interface PolicyRule {
  path: string;
  capabilities: string[];
}

interface TestResult {
  allowed: boolean;
  matchedRule: string | null;
  matchedCapabilities: string[];
  reason: string;
}

export interface PolicyTesterPanelProps {
  rules: PolicyRule[];
  isUnsaved?: boolean;
  onClose: () => void;
  onMatchedRuleChange?: (matchedRulePath: string | null) => void;
}

export default function PolicyTesterPanel({
  rules,
  isUnsaved = false,
  onClose,
  onMatchedRuleChange,
}: PolicyTesterPanelProps) {
  const [testPath, setTestPath] = useState('');
  const [operation, setOperation] = useState<string>('read');
  const [result, setResult] = useState<TestResult | null>(null);

  const handleTest = () => {
    if (!testPath.trim()) return;
    const evalResult = evaluateSinglePolicy(rules, testPath.trim(), operation);
    const testResult: TestResult = {
      allowed: evalResult.allowed,
      matchedRule: evalResult.matchedPath,
      matchedCapabilities: evalResult.effectiveCapabilities,
      reason: evalResult.reason,
    };
    setResult(testResult);
    onMatchedRuleChange?.(testResult.matchedRule);
  };

  return (
    <div className="flex h-full flex-col rounded-md border border-gray-200">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-600">Policy Tester</span>
          <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            Simulated
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-400 hover:text-gray-600"
          title="Close tester"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* Unsaved changes notice */}
        {isUnsaved && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <strong>Testing unsaved changes</strong> — save the policy to make these rules active
            in Vault.
          </div>
        )}

        {/* Path input */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Path to test</label>
          <input
            type="text"
            value={testPath}
            onChange={(e) => {
              setTestPath(e.target.value);
              setResult(null);
              onMatchedRuleChange?.(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTest();
            }}
            placeholder="e.g. kv/data/myapp/config"
            className="w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-sm focus:border-blue-400 focus:outline-none"
          />
        </div>

        {/* Operation selector */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-600">Operation</label>
          <div className="flex flex-wrap gap-1.5">
            {TEST_OPERATIONS.map((op) => (
              <button
                key={op}
                type="button"
                onClick={() => {
                  setOperation(op);
                  setResult(null);
                  onMatchedRuleChange?.(null);
                }}
                className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  operation === op
                    ? CAP_COLORS[op as Capability]
                    : 'border-gray-200 bg-white text-gray-400 hover:text-gray-600'
                }`}
              >
                {op}
              </button>
            ))}
          </div>
        </div>

        {/* Test button */}
        <button
          type="button"
          onClick={handleTest}
          disabled={!testPath.trim()}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
        >
          Test
        </button>

        {/* Result */}
        {result && (
          <div
            className={`rounded-md border p-3 ${
              result.allowed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
            }`}
          >
            {/* Banner */}
            <div className="mb-2 flex items-center gap-2">
              {result.allowed ? (
                <svg
                  className="h-5 w-5 shrink-0 text-green-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              ) : (
                <svg
                  className="h-5 w-5 shrink-0 text-red-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              )}
              <span
                className={`text-sm font-semibold ${result.allowed ? 'text-green-800' : 'text-red-800'}`}
              >
                {result.allowed ? 'ALLOWED' : 'DENIED'}
              </span>
            </div>

            {/* Reason */}
            <p className={`mb-2 text-xs ${result.allowed ? 'text-green-700' : 'text-red-700'}`}>
              {result.reason}
            </p>

            {/* Matched rule */}
            {result.matchedRule ? (
              <div className="mb-2 text-xs text-gray-600">
                <span className="font-medium">Matched rule: </span>
                <code className="rounded bg-white/60 px-1 font-mono">{result.matchedRule}</code>
              </div>
            ) : (
              <div className="mb-2 text-xs text-gray-500">No matching rule found</div>
            )}

            {/* Capabilities on matched rule */}
            {result.matchedCapabilities.length > 0 && (
              <div>
                <span className="text-xs font-medium text-gray-600">Capabilities on rule: </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {result.matchedCapabilities.map((cap) => (
                    <span
                      key={cap}
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                        ALL_CAPABILITIES.includes(cap as Capability)
                          ? CAP_COLORS[cap as Capability]
                          : 'border-gray-300 bg-gray-100 text-gray-600'
                      }`}
                    >
                      {cap}
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Disclaimer */}
        <p className="mt-auto border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-400">
          Results are <strong>simulated</strong> based on this policy&apos;s rules only. Vault&apos;s
          actual evaluation also considers all other policies on a token, group memberships, and
          sentinel rules — and may differ.
        </p>
      </div>
    </div>
  );
}
