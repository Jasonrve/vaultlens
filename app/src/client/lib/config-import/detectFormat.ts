import type { ConfigFormat } from './types';

const extensionMap: Record<string, ConfigFormat> = {
  '.json': 'json', '.env': 'env', '.yaml': 'yaml', '.yml': 'yaml', '.ini': 'ini',
  '.cfg': 'ini', '.toml': 'toml', '.properties': 'properties',
};

export function detectFormat(filename: string): ConfigFormat | null {
  const lowerName = filename.toLowerCase();
  if (lowerName === '.env' || lowerName.includes('.env.')) return 'env';
  const extension = lowerName.slice(lowerName.lastIndexOf('.'));
  return extensionMap[extension] ?? null;
}

export function detectContentFormat(content: string): ConfigFormat {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // A section header such as [RESTAPI] is more likely to be INI than JSON.
    }
  }
  if (/^\s*\[[^\]\r\n]+\]\s*$/m.test(content) || /^\s*[^#;\s][^=\r\n]*=.*/m.test(content)) {
    return 'ini';
  }
  if (/^\s*(export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(content)) return 'env';
  if (/^\s*[^\s:=]+\s*[:=]\s+/.test(content)) return 'properties';
  return 'json';
}