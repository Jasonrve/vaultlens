export type ConfigFormat = 'json' | 'env' | 'yaml' | 'ini' | 'toml' | 'properties';

export interface ConfigParser {
  id: ConfigFormat;
  label: string;
  extensions: string[];
  parse(content: string): unknown;
}

export interface ParsedConfig {
  format: ConfigFormat;
  label: string;
  data: Record<string, string>;
  keyCount: number;
  payloadSize: number;
}