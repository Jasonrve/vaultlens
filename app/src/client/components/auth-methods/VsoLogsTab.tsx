import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';

interface VsoErrorDetails {
  message: string;
  kubernetesHost?: string;
  identity?: { serviceAccount?: string; namespace?: string; iamRole?: string };
}

function errorDetails(error: unknown): VsoErrorDetails {
  if (axios.isAxiosError<{ error?: string; kubernetesHost?: string; identity?: VsoErrorDetails['identity'] }>(error)) {
    const data = error.response?.data;
    if (error.response?.status === 401 || error.response?.status === 403) {
      const identity = data?.identity;
      const name = identity?.serviceAccount
        ? `ServiceAccount ${identity.namespace ? `${identity.namespace}/` : ''}${identity.serviceAccount}`
        : 'The current pod identity';
      const role = identity?.iamRole ? ` (IAM role ${identity.iamRole})` : '';
      return { message: `${name}${role} needs permission to read pod logs in the downstream Kubernetes cluster.`, kubernetesHost: data?.kubernetesHost, identity };
    }
    return { message: data?.error || 'Unable to query the downstream Kubernetes cluster.', kubernetesHost: data?.kubernetesHost };
  }
  return { message: 'Unable to query the downstream Kubernetes cluster.' };
}

function lineClassName(line: string): string {
  const lower = line.toLowerCase();
  if (/"level":"?error"?|\berror\b/.test(lower)) return 'text-red-300';
  if (/"level":"?warn"?|\bwarn(ing)?\b/.test(lower)) return 'text-amber-300';
  return 'text-slate-300';
}

const TAIL_LINE_OPTIONS = [100, 500, 1000, 2000];

export default function VsoLogsTab({ method }: { method: string }) {
  const [pods, setPods] = useState<api.VsoLogPod[]>([]);
  const [selectedPod, setSelectedPod] = useState<string>('');
  const [tailLines, setTailLines] = useState(500);
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorInfo, setErrorInfo] = useState<VsoErrorDetails | null>(null);
  const [liveTail, setLiveTail] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState(false);
  const [copied, setCopied] = useState(false);
  const logPanelRef = useRef<HTMLDivElement>(null);

  const loadLogs = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) {
      setLoading(true);
      setError(null);
      setErrorInfo(null);
    }
    try {
      const result = await api.getVsoLogs(method, { pod: selectedPod || undefined, tailLines });
      setPods(result.pods);
      if (result.selectedPod) setSelectedPod(result.selectedPod);
      setLines(result.lines);
      setPendingUpdate(false);
    } catch (requestError) {
      if (!opts.silent) {
        const details = errorDetails(requestError);
        setError(details.message);
        setErrorInfo(details);
      } else {
        setPendingUpdate(true);
      }
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, [method, selectedPod, tailLines]);

  useEffect(() => {
    void loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, tailLines]);

  useEffect(() => {
    if (!liveTail) return undefined;
    const interval = window.setInterval(() => { void loadLogs({ silent: true }); }, 5000);
    return () => window.clearInterval(interval);
  }, [liveTail, loadLogs]);

  function selectPod(pod: string) {
    setSelectedPod(pod);
    setLoading(true);
    setError(null);
    setErrorInfo(null);
    void (async () => {
      try {
        const result = await api.getVsoLogs(method, { pod, tailLines });
        setPods(result.pods);
        setLines(result.lines);
      } catch (requestError) {
        const details = errorDetails(requestError);
        setError(details.message);
        setErrorInfo(details);
      } finally {
        setLoading(false);
      }
    })();
  }

  function copyAll() {
    void navigator.clipboard.writeText(lines.join('\n')).then(() => setCopied(true));
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Vault Secrets Operator logs</h2>
          <p className="mt-1 text-xs text-gray-500">Logs from the VSO operator pod itself — useful for reconcile errors, auth failures, or issues not tied to a single resource.</p>
        </div>
        {!loading && !error && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={liveTail} onChange={(e) => setLiveTail(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300 text-[#1563ff] focus:ring-[#1563ff]" />
              Live tail
              {liveTail && pendingUpdate && <span className="ml-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">updated</span>}
            </label>
            <button type="button" onClick={copyAll} className="text-xs font-medium text-[#1563ff] hover:underline">{copied ? 'Copied' : 'Copy all'}</button>
            <button type="button" onClick={() => void loadLogs()} className="text-xs font-medium text-[#1563ff] hover:underline">Refresh</button>
          </div>
        )}
      </div>

      {loading && <LoadingSpinner className="py-12" />}

      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <h3 className="font-semibold">VSO logs are not available</h3>
          <p className="mt-1">{error}</p>
          <p className="mt-3">VaultLens uses the Kubernetes URL configured on this Vault auth mount:</p>
          <code className="mt-1 block overflow-x-auto rounded bg-amber-100 px-3 py-2 text-xs">{errorInfo?.kubernetesHost || 'No Kubernetes URL is configured on this auth mount.'}</code>
          <p className="mt-4 font-medium">The VaultLens workload identity needs read access to pod logs in the downstream cluster.</p>
          <p className="mt-1 text-xs">Current identity: {errorInfo?.identity?.serviceAccount ? `ServiceAccount ${errorInfo.identity.namespace ? `${errorInfo.identity.namespace}/` : ''}${errorInfo.identity.serviceAccount}` : 'the pod ServiceAccount'}{errorInfo?.identity?.iamRole ? ` (IAM role ${errorInfo.identity.iamRole})` : ''}</p>
          <pre className="mt-3 overflow-x-auto rounded bg-slate-900 p-3 text-xs leading-5 text-slate-100">{`apiVersion: rbac.authorization.k8s.io/v1\nkind: ClusterRole\nmetadata:\n  name: vaultlens-vso-logs-reader\nrules:\n  - apiGroups: [""]\n    resources:\n      - pods\n      - pods/log\n    verbs: ["get", "list"]\n---\napiVersion: rbac.authorization.k8s.io/v1\nkind: ClusterRoleBinding\nmetadata:\n  name: vaultlens-vso-logs-reader\nroleRef:\n  apiGroup: rbac.authorization.k8s.io\n  kind: ClusterRole\n  name: vaultlens-vso-logs-reader\nsubjects:\n  - kind: ServiceAccount\n    name: ${errorInfo?.identity?.serviceAccount || 'vaultlens'}\n    namespace: ${errorInfo?.identity?.namespace || 'default'}`}</pre>
          <button type="button" onClick={() => void loadLogs()} className="mt-3 font-medium underline">Check again</button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            {pods.length > 1 && (
              <select
                value={selectedPod}
                onChange={(e) => selectPod(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-[#1563ff]"
              >
                {pods.map((pod) => <option key={pod.name} value={pod.name}>{pod.namespace}/{pod.name}</option>)}
              </select>
            )}
            {pods.length === 1 && (
              <span className="text-xs text-gray-500">{pods[0].namespace}/{pods[0].name}</span>
            )}
            <select
              value={tailLines}
              onChange={(e) => setTailLines(Number(e.target.value))}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-[#1563ff]"
            >
              {TAIL_LINE_OPTIONS.map((n) => <option key={n} value={n}>Last {n} lines</option>)}
            </select>
          </div>

          {pods.length === 0 ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-5 text-sm text-gray-600">
              No Vault Secrets Operator pod was found. VaultLens looks for a pod labeled <code>app.kubernetes.io/name=vault-secrets-operator</code> in the operator&rsquo;s namespace (defaults to <code>vault-secrets-operator-system</code>; override per mount with <code>K8S_ACCESS_&lt;MOUNT&gt;_VSO_NAMESPACE</code>).
            </div>
          ) : (
            <div ref={logPanelRef} className="max-h-[32rem] flex-1 overflow-auto rounded-md bg-slate-950 p-4 font-mono text-xs leading-6">
              {lines.length > 0 ? lines.map((line, index) => (
                <div key={index} className="flex min-w-max">
                  <span className="mr-4 w-10 select-none text-right text-slate-600">{index + 1}</span>
                  <code className={`whitespace-pre ${lineClassName(line)}`}>{line}</code>
                </div>
              )) : <p className="text-slate-400">No log lines returned</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
