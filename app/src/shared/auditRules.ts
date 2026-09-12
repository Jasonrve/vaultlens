export const SEVERITIES = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
] as const;
export type Severity = (typeof SEVERITIES)[number];
export interface RuleDefinition {
  id: string;
  status: 'stable' | 'review' | 'experimental';
  enabled: boolean;
  severity: Severity;
  finding_kind:
    | 'security_issue'
    | 'risky_configuration'
    | 'review_recommendation';
  title: string;
  description: string;
  remediation: string;
  object_types: string[];
  detector: string;
  parameters: Record<string, unknown>;
  documentation: string[];
}
export interface RuleSettings {
  revision: number;
  configYaml: string;
  customRulesYaml: string;
}
export interface RuleView extends RuleDefinition {
  source: 'builtin' | 'custom';
  supported: boolean;
  active: boolean;
  effectiveSeverity: Severity;
  yaml: string;
}
export interface SettingsView {
  settings: RuleSettings;
  catalog: RuleView[];
  detectors: string[];
}
export interface RunConfiguration extends RuleSettings {
  catalog?: RuleView[];
  fingerprint: string;
  engineVersion: string;
  issues: { namespace?: string; path: string; reason: string }[];
}
