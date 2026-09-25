import { parse as parseEnv } from 'dotenv';
import { parse as parseIni } from 'ini';
import { parse as parseToml } from 'smol-toml';
import { getProperties } from 'properties-file';
import { parse as parseYaml } from 'yaml';
import { flattenConfig } from './flattenConfig';
import { detectContentFormat, detectFormat } from './detectFormat';
import type { ConfigFormat, ConfigParser, ParsedConfig } from './types';

const parsers: ConfigParser[] = [
  { id: 'json', label: 'JSON', extensions: ['.json'], parse: JSON.parse },
  { id: 'env', label: 'ENV', extensions: ['.env'], parse: parseEnv },
  { id: 'yaml', label: 'YAML', extensions: ['.yaml', '.yml'], parse: parseYaml },
  { id: 'ini', label: 'INI', extensions: ['.ini', '.cfg'], parse: parseIni },
  { id: 'toml', label: 'TOML', extensions: ['.toml'], parse: parseToml },
  { id: 'properties', label: 'Properties', extensions: ['.properties'], parse: getProperties },
];

export function getParser(format: ConfigFormat): ConfigParser {
  const parser = parsers.find((candidate) => candidate.id === format);
  if (!parser) throw new Error(`Unsupported configuration format: ${format}`);
  return parser;
}

export function importConfig(content: string, filename: string, formatOverride?: ConfigFormat, includeParentPath = true): ParsedConfig {
  const format = formatOverride ?? detectFormat(filename) ?? detectContentFormat(content);
  if (!format) throw new Error('Could not detect the configuration format from this filename');
  const parser = getParser(format);
  let data: Record<string, string>;
  try {
    data = flattenConfig(parser.parse(content), '__', includeParentPath);
    for (const [key, value] of Object.entries(data)) {
      data[key] = value.replace(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/, '$2');
    }
  } catch (error) {
    throw new Error(`Could not parse ${filename} as ${parser.label}: ${error instanceof Error ? error.message : 'invalid content'}`);
  }
  return { format, label: parser.label, data, keyCount: Object.keys(data).length, payloadSize: JSON.stringify(data).length };
}

export { detectContentFormat, detectFormat, flattenConfig };
export type { ConfigFormat, ParsedConfig } from './types';