export const labels: Record<string, string> = {
  ttl: "Issued certificates expire after",
  max_ttl: "Max TTL",
  not_before_duration: "Issued certificate backdating",
  issuer_ref: "Issuer",
  generate_lease: "Generate lease with certificate",
  no_store: "Do not store certificates",
  basic_constraints_valid_for_non_ca: "Add basic constraints",
  key_type: "Key type",
  key_bits: "Key bits",
  signature_bits: "Signature bits",
  common_name: "Common name",
  csr: "CSR",
  pem_bundle: "PEM bundle",
  pem: "Private key PEM",
  path: "Mount’s API path",
  aia_path: "AIA path",
  enabled: "Enabled",
  dns_resolver: "DNS resolver",
  eab_policy: "EAB policy",
  allow_role_ext_key_usage: "Allow role ExtKeyUsage",
  crl_distribution_points: "CRL distribution points",
  ocsp_servers: "OCSP servers",
  disable: "Disable CRL building",
  enable_delta: "Delta CRL building",
  ocsp_disable: "Disable OCSP responder",
  ocsp_expiry: "OCSP interval",
  safety_buffer: "Certificate safety buffer",
  issuer_safety_buffer: "Issuer safety buffer",
};
export const fieldLabel = (key: string) =>
  labels[key] || key[0].toUpperCase() + key.slice(1).replace(/_/g, " ");
export function fieldGroup(key: string) {
  if (
    /^(allowed_domains|allow_any_name|allow_bare_domains|allow_glob_domains|allow_localhost|allow_subdomains|allow_wildcard|enforce_hostnames|cn_validations)/.test(
      key,
    )
  )
    return "Domain handling";
  if (/^(key_type|key_bits|signature_bits|use_pss)/.test(key))
    return "Key parameters";
  if (
    /^(key_usage|ext_key_usage|server_flag|client_flag|code_signing_flag|email_protection_flag)/.test(
      key,
    )
  )
    return "Key usage";
  if (/policy_identifiers/.test(key)) return "Policy identifiers";
  if (/sans|alt_names/.test(key)) return "SAN options";
  if (
    /^(ou|organization|country|locality|province|street_address|postal_code|allowed_user_ids|allowed_serial_numbers|serial_number_source|require_cn|use_csr_common_name)$/.test(
      key,
    )
  )
    return "Additional subject fields";
  if (/^(permitted_|excluded_)/.test(key)) return "Name constraints";
  return "General";
}
export const groupOrder = [
  "General",
  "Domain handling",
  "Key parameters",
  "Key usage",
  "Policy identifiers",
  "SAN options",
  "Additional subject fields",
  "Name constraints",
];
export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value.length ? value.map(displayValue).join(", ") : "None";
  if (typeof value === "object")
    return Object.entries(value)
      .map(([key, v]) => `${fieldLabel(key)}: ${displayValue(v)}`)
      .join("\n");
  return String(value);
}
export function downloadText(value: string, filename: string) {
  const href = URL.createObjectURL(new Blob([value], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function propertyValue(key: string, value: unknown) {
  if (
    typeof value === "number" &&
    /(^ttl$|_ttl$|_duration$|_buffer$)/.test(key)
  ) {
    for (const [seconds, unit] of [
      [2592000, "month"],
      [86400, "day"],
      [3600, "hour"],
      [60, "minute"],
      [1, "second"],
    ] as const) {
      if (value >= seconds && value % seconds === 0) {
        const n = value / seconds;
        return `${n} ${unit}${n === 1 ? "" : "s"}`;
      }
    }
    return `${value} seconds`;
  }
  return displayValue(value);
}
