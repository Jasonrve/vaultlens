import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../../lib/api';
import Modal from './Modal';
import Badge from './Badge';
import LoadingSpinner from './LoadingSpinner';

export type RefKind = 'policy' | 'entity' | 'group';

const ROUTES: Record<RefKind, string> = {
  policy: '/policies',
  entity: '/access/entities',
  group: '/access/groups',
};

function Section({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <div className="flex flex-wrap gap-1">
        {items.length ? items.map((i) => <Badge key={i} text={i} variant="read" />) : <span className="text-sm text-gray-400">None</span>}
      </div>
    </div>
  );
}

function Preview({ kind, id }: { kind: RefKind; id: string }) {
  const [body, setBody] = useState<ReactNode>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async (): Promise<ReactNode> => {
      if (kind === 'policy') {
        const p = await api.getPolicy(id);
        return <pre className="max-h-96 overflow-auto rounded bg-gray-50 p-3 font-mono text-xs text-gray-800">{p.rules}</pre>;
      }
      if (kind === 'entity') {
        const e = await api.getEntity(id);
        return (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">{e.name}</p>
            <Section label="Policies" items={e.policies ?? []} />
            <Section label="Groups" items={e.group_ids ?? []} />
          </div>
        );
      }
      const g = await api.getGroup(id);
      return (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">{g.name}</p>
          <Section label="Policies" items={g.policies ?? []} />
          <Section label="Member entities" items={g.member_entity_ids ?? []} />
          <Section label="Member groups" items={g.member_group_ids ?? []} />
        </div>
      );
    };
    load()
      .then((node) => live && setBody(node))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Failed to load preview'));
    return () => { live = false; };
  }, [kind, id]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  return body ?? <LoadingSpinner />;
}

interface RefLinkProps {
  kind: RefKind;
  id: string;
  className?: string;
  title?: string;
  children?: ReactNode;
}

/** Link to a policy/entity/group page; Ctrl/Cmd-click opens an in-page preview instead of navigating. */
export default function RefLink({ kind, id, className, title, children }: RefLinkProps) {
  const [open, setOpen] = useState(false);
  const to = `${ROUTES[kind]}/${id}`;

  function handleClick(e: MouseEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setOpen(true);
    }
  }

  return (
    <>
      <Link to={to} onClick={handleClick} className={className} title={title ?? `${id} — Ctrl+click to preview`}>
        {children ?? id}
      </Link>
      <Modal open={open} onClose={() => setOpen(false)} title={`${kind[0].toUpperCase()}${kind.slice(1)}: ${id}`}>
        <Preview kind={kind} id={id} />
        <div className="mt-4 flex justify-end">
          <Link to={to} onClick={() => setOpen(false)} className="text-sm text-[#1563ff] hover:text-[#1250d4]">Open page →</Link>
        </div>
      </Modal>
    </>
  );
}
