import { useEffect, useRef } from 'react';
import type { AuditLogEntry } from '../../lib/api';

interface Props {
  x: number;
  y: number;
  entry: AuditLogEntry;
  onClose: () => void;
  onCreateWebhook: () => void;
}

const isHmac = (v: string) => !v || v.startsWith('hmac-sha256:');

export default function AuditContextMenu({ x, y, entry, onClose, onCreateWebhook }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onMouse = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouse);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouse);
    };
  }, [onClose]);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    onClose();
  };

  const copyJson = () => {
    const data = {
      requestId: entry.requestId,
      time: entry.time,
      operation: entry.operation,
      path: isHmac(entry.path) ? null : entry.path,
      mountType: entry.mountType,
      mountPoint: entry.mountPoint,
      displayName: isHmac(entry.displayName) ? null : entry.displayName,
      entityId: isHmac(entry.entityId) ? null : entry.entityId,
      remoteAddress: entry.remoteAddress || null,
      policies: entry.policies,
      error: entry.error || null,
    };
    copy(JSON.stringify(data, null, 2));
  };

  // Clamp to viewport
  const menuW = 210;
  const menuH = 160;
  const top = Math.min(y, window.innerHeight - menuH - 8);
  const left = Math.min(x, window.innerWidth - menuW - 8);

  return (
    <div
      ref={menuRef}
      style={{ position: 'fixed', top, left, zIndex: 9999 }}
      className="min-w-[210px] rounded-lg border border-gray-200 bg-white py-1 shadow-xl"
    >
      {!isHmac(entry.path) && (
        <MenuItem
          icon="copy"
          label="Copy path"
          onClick={() => copy(entry.path)}
        />
      )}
      {!isHmac(entry.displayName) && (
        <MenuItem
          icon="user"
          label="Copy user"
          onClick={() => copy(entry.displayName)}
        />
      )}
      <MenuItem icon="code" label="Copy as JSON" onClick={copyJson} />
      <div className="my-1 border-t border-gray-100" />
      <MenuItem
        icon="webhook"
        label="Create webhook…"
        onClick={() => { onCreateWebhook(); onClose(); }}
      />
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-400">
        {icon === 'copy' && (
          <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
          </svg>
        )}
        {icon === 'user' && (
          <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
        )}
        {icon === 'code' && (
          <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
          </svg>
        )}
        {icon === 'webhook' && (
          <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zm-7.518-.267A8.25 8.25 0 1120.25 10.5M8.288 14.212A5.25 5.25 0 1117.25 10.5" />
          </svg>
        )}
      </span>
      {label}
    </button>
  );
}
