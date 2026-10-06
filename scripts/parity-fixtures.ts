import { isDeepStrictEqual } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Corpus = 'auth' | 'identity' | 'policy' | 'reference' | 'relationship';
export type Metadata = Record<string, unknown>;
export interface Resource {
  kind: string;
  path: string;
  data: Metadata;
}
export interface Scenario {
  name: string;
  resource?: Resource;
  resources?: Resource[];
  config?: Metadata;
  source?: string;
  path?: string;
  known?: string[];
}
interface ReferenceCase extends Scenario {
  expected: unknown[];
}

/** The checked-in answers came from the independent Python reference. Never
 * derive them from the implementation under test. New or changed inputs require
 * independently reviewed reference answers before they can enter this corpus.
 */
export function fixtures(corpus: Corpus, scenarios: Scenario[]): ReferenceCase[] {
  const source = new URL(
    `../app/src/server/security-audit/fixtures/${corpus}-parity.json`,
    import.meta.url,
  );
  const reference: ReferenceCase[] = JSON.parse(readFileSync(source, 'utf8'));
  const byName = new Map(reference.map((entry) => [entry.name, entry]));
  if (byName.size !== reference.length || scenarios.length !== reference.length)
    throw new Error(`${corpus}: scenario count or reference names differ`);
  const seen = new Set<string>();
  return scenarios.map((scenario) => {
    const entry = byName.get(scenario.name);
    if (!entry || seen.has(scenario.name))
      throw new Error(`${corpus}: missing reference or duplicate scenario ${scenario.name}`);
    seen.add(scenario.name);
    // Check both directions so dropping an input field cannot silently succeed.
    const { expected: _expected, blocks: _blocks, pythonAttributes: _raw,
      partial: _partial, ...referenceInput } = entry as ReferenceCase & Metadata;
    if (!isDeepStrictEqual(scenario, referenceInput))
      throw new Error(`${corpus}: input changed for ${scenario.name}; review reference answers independently`);
    return { ...entry, ...scenario };
  });
}

export function runGenerator(
  entryUrl: string,
  corpus: Corpus,
  scenarios: () => Scenario[],
): void {
  if (!process.argv[1] || resolve(process.argv[1]) !== fileURLToPath(entryUrl)) return;
  const output = process.argv[2];
  if (!output || process.argv.length !== 3)
    throw new Error(`Usage: tsx scripts/generate-${corpus}-parity.ts OUTPUT.json`);
  const entries = fixtures(corpus, scenarios());
  writeFileSync(output, `${JSON.stringify(entries)}\n`);
  const count = entries.reduce((total, entry) => total + entry.expected.length, 0);
  console.log(`${entries.length} ${corpus} fixtures; ${count} reference results`);
}

/** HCL source strings retain the reference generator's JSON literal spacing. */
export const capabilities = (values: string[]): string =>
  `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
