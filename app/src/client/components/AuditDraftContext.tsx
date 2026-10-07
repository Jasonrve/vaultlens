import { createContext, useContext, useState, type ReactNode } from 'react';
import type { RuleSettings } from '../../shared/auditRules';
import type { CheckGroup } from '../../shared/auditCheckGroups';

function useDraftState() {
  const [draft, setDraft] = useState<RuleSettings | null>(null);
  const [group, setGroup] = useState<CheckGroup | 'All'>('All');
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const discard = () => {
    setDraft(null);
    setEditorVersion((value) => value + 1);
  };
  return {
    draft,
    setDraft,
    group,
    setGroup,
    selected,
    setSelected,
    saving,
    setSaving,
    editorVersion,
    discard,
  };
}
const AuditDraftContext = createContext<ReturnType<
  typeof useDraftState
> | null>(null);

export function AuditDraftProvider({ children }: { children: ReactNode }) {
  const state = useDraftState();
  return (
    <AuditDraftContext.Provider value={state}>
      {children}
    </AuditDraftContext.Provider>
  );
}
export function useAuditDraft() {
  const value = useContext(AuditDraftContext);
  if (!value) throw new Error('Audit draft requires the audit workspace');
  return value;
}
