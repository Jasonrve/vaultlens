import { deepStrictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { authScenarios } from './generate-auth-parity.js';
import { identityScenarios } from './generate-identity-parity.js';
import { policyScenarios } from './generate-policy-parity.js';
import { referenceScenarios } from './generate-reference-parity.js';
import { relationshipScenarios } from './generate-relationship-parity.js';
import { fixtures, type Corpus, type Scenario } from './parity-fixtures.js';

const generators: [Corpus, () => Scenario[]][] = [
  ['auth', authScenarios], ['identity', identityScenarios], ['policy', policyScenarios],
  ['reference', referenceScenarios], ['relationship', relationshipScenarios],
];
for (const [corpus, generate] of generators) {
  const reference = JSON.parse(readFileSync(new URL(
    `../app/src/server/security-audit/fixtures/${corpus}-parity.json`, import.meta.url,
  ), 'utf8'));
  const entries = fixtures(corpus, generate());
  deepStrictEqual(entries, reference);
  console.log(`${corpus}: ${entries.length} scenarios match the independent reference corpus`);
}
