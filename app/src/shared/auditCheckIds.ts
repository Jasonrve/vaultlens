/** Previous IDs remain accepted for saved configurations and historical findings. */
export const CHECK_ID_ALIASES: Record<string, string> = {
  'POL-005': 'TOKEN-005',
  'POL-012': 'TOKEN-006',
  'POL-016': 'IDENTITY-004',
  'POL-017': 'TRANSIT-006',
  'POL-019': 'PKI-007',
};
export const canonicalCheckId = (id: string): string =>
  Object.prototype.hasOwnProperty.call(CHECK_ID_ALIASES, id) ? CHECK_ID_ALIASES[id] : id;
