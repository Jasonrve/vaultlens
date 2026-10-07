import { canonicalCheckId } from './auditCheckIds.js';
import type { RuleView } from './auditRules.js';
export const CHECK_GROUPS = [
  'Policies',
  'AppRole',
  'Kubernetes',
  'JWT / OIDC',
  'Token',
  'Identity',
  'PKI',
  'Transit',
  'Assignments',
] as const;
export type CheckGroup = (typeof CHECK_GROUPS)[number];
export function checkGroup(
  rule: Pick<RuleView, 'id' | 'object_types'>,
): CheckGroup {
  rule = { ...rule, id: canonicalCheckId(rule.id) };
  if (rule.id.startsWith('TOKEN-')) return 'Token';
  if (rule.id.startsWith('IDENTITY-')) return 'Identity';
  if (rule.id.startsWith('PKI-')) return 'PKI';
  if (rule.id.startsWith('TRANSIT-')) return 'Transit';
  if (rule.id === 'REF-001' || rule.id === 'LOCAL-ROOT-001')
    return 'Assignments';
  if (rule.object_types.some(type=>type.startsWith('pki-'))) return 'PKI';
  if (rule.object_types.includes('transit-key')) return 'Transit';
  if (rule.object_types.includes('alias')) return 'Identity';
  if (rule.id.startsWith('POL-')) return 'Policies';
  if (rule.id.includes('APPROLE')) return 'AppRole';
  if (rule.id.startsWith('JWT-')) return 'JWT / OIDC';
  if (rule.id.startsWith('K8S-') || rule.id.startsWith('KUBE'))
    return 'Kubernetes';
  if (rule.object_types.includes('token_role')) return 'Token';
  if (rule.object_types.some((type) => ['entity', 'group'].includes(type)))
    return 'Identity';
  if (rule.object_types.includes('kubernetes_role')) return 'Kubernetes';
  return 'Assignments';
}
