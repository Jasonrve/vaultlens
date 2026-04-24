import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICIES_DIR = join(__dirname, '..', 'policies');

function loadPolicy(filename: string): string {
  try {
    return readFileSync(join(POLICIES_DIR, filename), 'utf-8').trim();
  } catch (err) {
    throw new Error(
      `[Policy Loader] Failed to load ${filename} from ${POLICIES_DIR}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export const SYSTEM_TOKEN_POLICY_HCL: string = loadPolicy('vaultlens-system.hcl');
export const ADMIN_POLICY_HCL: string = loadPolicy('vaultlens-admin.hcl');
