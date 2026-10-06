import { normalizeSerial } from "./certificate.js";

export function compareSerials(localSerials: string[], vaultSerials: string[]) {
  const local = new Set(localSerials.map(normalizeSerial));
  const vault = new Set(vaultSerials.map(normalizeSerial));
  let common = 0;
  for (const serial of vault) if (local.has(serial)) common++;
  return {
    localCount: local.size,
    vaultCount: vault.size,
    notCollected: vault.size - common,
    localOnly: local.size - common,
  };
}
