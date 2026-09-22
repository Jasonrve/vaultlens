// Field names, types and defaults verified against Vault 1.21.4 OpenAPI.
// Operations are explicitly scoped to a discovered PKI mount.
export interface PkiField {
  type: string;
  format?: string;
  default?: unknown;
  enum?: string[];
}
export interface PkiOperation {
  title: string;
  endpoint: string;
  tab: string;
  reference: boolean;
  method: string;
  fields: Record<string, PkiField>;
}
export const pkiOperations: Record<string, PkiOperation> = {
  "role-save": {
    title: "Save role",
    endpoint: "roles/{ref}",
    tab: "roles",
    reference: true,
    method: "POST",
    fields: {
      allow_any_name: {
        type: "boolean",
      },
      allow_bare_domains: {
        type: "boolean",
      },
      allow_glob_domains: {
        type: "boolean",
      },
      allow_ip_sans: {
        type: "boolean",
        default: true,
      },
      allow_localhost: {
        type: "boolean",
        default: true,
      },
      allow_subdomains: {
        type: "boolean",
      },
      allow_wildcard_certificates: {
        type: "boolean",
        default: true,
      },
      allowed_domains: {
        type: "array",
      },
      allowed_domains_template: {
        type: "boolean",
        default: false,
      },
      allowed_other_sans: {
        type: "array",
      },
      allowed_serial_numbers: {
        type: "array",
      },
      allowed_uri_sans: {
        type: "array",
      },
      allowed_uri_sans_template: {
        type: "boolean",
        default: false,
      },
      allowed_user_ids: {
        type: "array",
      },
      basic_constraints_valid_for_non_ca: {
        type: "boolean",
      },
      client_flag: {
        type: "boolean",
        default: true,
      },
      cn_validations: {
        type: "array",
        default: ["email", "hostname"],
      },
      code_signing_flag: {
        type: "boolean",
      },
      country: {
        type: "array",
      },
      email_protection_flag: {
        type: "boolean",
      },
      enforce_hostnames: {
        type: "boolean",
        default: true,
      },
      ext_key_usage: {
        type: "array",
        default: [],
      },
      ext_key_usage_oids: {
        type: "array",
      },
      generate_lease: {
        type: "boolean",
      },
      issuer_ref: {
        type: "string",
        default: "default",
      },
      key_bits: {
        type: "integer",
        default: 0,
      },
      key_type: {
        type: "string",
        default: "rsa",
        enum: ["rsa", "ec", "ed25519", "any"],
      },
      key_usage: {
        type: "array",
        default: ["DigitalSignature", "KeyAgreement", "KeyEncipherment"],
      },
      locality: {
        type: "array",
      },
      max_ttl: {
        type: "string",
        format: "duration",
      },
      no_store: {
        type: "boolean",
      },
      not_after: {
        type: "string",
      },
      not_before_duration: {
        type: "string",
        format: "duration",
        default: 30,
      },
      organization: {
        type: "array",
      },
      ou: {
        type: "array",
      },
      policy_identifiers: {
        type: "array",
      },
      postal_code: {
        type: "array",
      },
      province: {
        type: "array",
      },
      require_cn: {
        type: "boolean",
        default: true,
      },
      serial_number_source: {
        type: "string",
        default: "json-csr",
      },
      server_flag: {
        type: "boolean",
        default: true,
      },
      signature_bits: {
        type: "integer",
        default: 0,
      },
      street_address: {
        type: "array",
      },
      ttl: {
        type: "string",
        format: "duration",
      },
      use_csr_common_name: {
        type: "boolean",
        default: true,
      },
      use_csr_sans: {
        type: "boolean",
        default: true,
      },
      use_pss: {
        type: "boolean",
        default: false,
      },
    },
  },
  "role-delete": {
    title: "Delete role",
    endpoint: "roles/{ref}",
    tab: "roles",
    reference: true,
    method: "DELETE",
    fields: {},
  },
  issue: {
    title: "Generate certificate",
    endpoint: "issue/{ref}",
    tab: "roles",
    reference: true,
    method: "POST",
    fields: {
      alt_names: {
        type: "string",
      },
      cert_metadata: {
        type: "string",
      },
      common_name: {
        type: "string",
      },
      exclude_cn_from_sans: {
        type: "boolean",
        default: false,
      },
      format: {
        type: "string",
        default: "pem",
        enum: ["pem", "der", "pem_bundle"],
      },
      ip_sans: {
        type: "array",
      },
      issuer_ref: {
        type: "string",
        default: "default",
      },
      not_after: {
        type: "string",
      },
      other_sans: {
        type: "array",
      },
      private_key_format: {
        type: "string",
        default: "der",
        enum: ["", "der", "pem", "pkcs8"],
      },
      remove_roots_from_chain: {
        type: "boolean",
        default: false,
      },
      serial_number: {
        type: "string",
      },
      ttl: {
        type: "string",
        format: "duration",
      },
      uri_sans: {
        type: "array",
      },
      user_ids: {
        type: "array",
      },
    },
  },
  sign: {
    title: "Sign certificate",
    endpoint: "sign/{ref}",
    tab: "roles",
    reference: true,
    method: "POST",
    fields: {
      alt_names: {
        type: "string",
      },
      cert_metadata: {
        type: "string",
      },
      common_name: {
        type: "string",
      },
      csr: {
        type: "string",
        default: "",
      },
      exclude_cn_from_sans: {
        type: "boolean",
        default: false,
      },
      format: {
        type: "string",
        default: "pem",
        enum: ["pem", "der", "pem_bundle"],
      },
      ip_sans: {
        type: "array",
      },
      issuer_ref: {
        type: "string",
        default: "default",
      },
      not_after: {
        type: "string",
      },
      other_sans: {
        type: "array",
      },
      private_key_format: {
        type: "string",
        default: "der",
        enum: ["", "der", "pem", "pkcs8"],
      },
      remove_roots_from_chain: {
        type: "boolean",
        default: false,
      },
      serial_number: {
        type: "string",
      },
      ttl: {
        type: "string",
        format: "duration",
      },
      uri_sans: {
        type: "array",
      },
      user_ids: {
        type: "array",
      },
    },
  },
  "issuer-import": {
    title: "Import CA bundle",
    endpoint: "issuers/import/bundle",
    tab: "issuers",
    reference: false,
    method: "POST",
    fields: {
      pem_bundle: {
        type: "string",
      },
    },
  },
  "root-generate": {
    title: "Generate root",
    endpoint: "issuers/generate/root/{mode}",
    tab: "issuers",
    reference: false,
    method: "POST",
    fields: {
      alt_names: {
        type: "string",
      },
      common_name: {
        type: "string",
      },
      country: {
        type: "array",
      },
      exclude_cn_from_sans: {
        type: "boolean",
        default: false,
      },
      excluded_dns_domains: {
        type: "array",
      },
      excluded_email_addresses: {
        type: "array",
      },
      excluded_ip_ranges: {
        type: "array",
      },
      excluded_uri_domains: {
        type: "array",
      },
      format: {
        type: "string",
        default: "pem",
        enum: ["pem", "der", "pem_bundle"],
      },
      ip_sans: {
        type: "array",
      },
      issuer_name: {
        type: "string",
      },
      key_bits: {
        type: "integer",
        default: 0,
      },
      key_name: {
        type: "string",
      },
      key_ref: {
        type: "string",
        default: "default",
      },
      key_type: {
        type: "string",
        default: "rsa",
        enum: ["rsa", "ec", "ed25519"],
      },
      key_usage: {
        type: "array",
        default: ["CertSign", "CRLSign"],
      },
      locality: {
        type: "array",
      },
      managed_key_id: {
        type: "string",
      },
      managed_key_name: {
        type: "string",
      },
      max_path_length: {
        type: "integer",
        default: -1,
      },
      not_after: {
        type: "string",
      },
      not_before_duration: {
        type: "string",
        format: "duration",
        default: 30,
      },
      organization: {
        type: "array",
      },
      other_sans: {
        type: "array",
      },
      ou: {
        type: "array",
      },
      permitted_dns_domains: {
        type: "array",
      },
      permitted_email_addresses: {
        type: "array",
      },
      permitted_ip_ranges: {
        type: "array",
      },
      permitted_uri_domains: {
        type: "array",
      },
      postal_code: {
        type: "array",
      },
      private_key_format: {
        type: "string",
        default: "der",
        enum: ["", "der", "pem", "pkcs8"],
      },
      province: {
        type: "array",
      },
      serial_number: {
        type: "string",
      },
      signature_bits: {
        type: "integer",
        default: 0,
      },
      street_address: {
        type: "array",
      },
      ttl: {
        type: "string",
        format: "duration",
      },
      uri_sans: {
        type: "array",
      },
      use_pss: {
        type: "boolean",
        default: false,
      },
    },
  },
  "intermediate-generate": {
    title: "Generate intermediate CSR",
    endpoint: "issuers/generate/intermediate/{mode}",
    tab: "issuers",
    reference: false,
    method: "POST",
    fields: {
      add_basic_constraints: {
        type: "boolean",
      },
      alt_names: {
        type: "string",
      },
      common_name: {
        type: "string",
      },
      country: {
        type: "array",
      },
      exclude_cn_from_sans: {
        type: "boolean",
        default: false,
      },
      format: {
        type: "string",
        default: "pem",
        enum: ["pem", "der", "pem_bundle"],
      },
      ip_sans: {
        type: "array",
      },
      key_bits: {
        type: "integer",
        default: 0,
      },
      key_name: {
        type: "string",
      },
      key_ref: {
        type: "string",
        default: "default",
      },
      key_type: {
        type: "string",
        default: "rsa",
        enum: ["rsa", "ec", "ed25519"],
      },
      key_usage: {
        type: "array",
        default: [],
      },
      locality: {
        type: "array",
      },
      managed_key_id: {
        type: "string",
      },
      managed_key_name: {
        type: "string",
      },
      not_after: {
        type: "string",
      },
      not_before_duration: {
        type: "string",
        format: "duration",
        default: 30,
      },
      organization: {
        type: "array",
      },
      other_sans: {
        type: "array",
      },
      ou: {
        type: "array",
      },
      postal_code: {
        type: "array",
      },
      private_key_format: {
        type: "string",
        default: "der",
        enum: ["", "der", "pem", "pkcs8"],
      },
      province: {
        type: "array",
      },
      serial_number: {
        type: "string",
      },
      signature_bits: {
        type: "integer",
        default: 0,
      },
      street_address: {
        type: "array",
      },
      ttl: {
        type: "string",
        format: "duration",
      },
      uri_sans: {
        type: "array",
      },
    },
  },
  "intermediate-set": {
    title: "Import signed intermediate",
    endpoint: "intermediate/set-signed",
    tab: "issuers",
    reference: false,
    method: "POST",
    fields: {
      certificate: {
        type: "string",
      },
    },
  },
  "intermediate-sign": {
    title: "Sign intermediate",
    endpoint: "issuer/{ref}/sign-intermediate",
    tab: "issuers",
    reference: true,
    method: "POST",
    fields: {
      alt_names: {
        type: "string",
      },
      common_name: {
        type: "string",
      },
      country: {
        type: "array",
      },
      csr: {
        type: "string",
        default: "",
      },
      enforce_leaf_not_after_behavior: {
        type: "boolean",
        default: false,
      },
      exclude_cn_from_sans: {
        type: "boolean",
        default: false,
      },
      excluded_dns_domains: {
        type: "array",
      },
      excluded_email_addresses: {
        type: "array",
      },
      excluded_ip_ranges: {
        type: "array",
      },
      excluded_uri_domains: {
        type: "array",
      },
      format: {
        type: "string",
        default: "pem",
        enum: ["pem", "der", "pem_bundle"],
      },
      ip_sans: {
        type: "array",
      },
      issuer_name: {
        type: "string",
      },
      key_usage: {
        type: "array",
        default: ["CertSign", "CRLSign"],
      },
      locality: {
        type: "array",
      },
      max_path_length: {
        type: "integer",
        default: -1,
      },
      not_after: {
        type: "string",
      },
      not_before_duration: {
        type: "string",
        format: "duration",
        default: 30,
      },
      organization: {
        type: "array",
      },
      other_sans: {
        type: "array",
      },
      ou: {
        type: "array",
      },
      permitted_dns_domains: {
        type: "array",
      },
      permitted_email_addresses: {
        type: "array",
      },
      permitted_ip_ranges: {
        type: "array",
      },
      permitted_uri_domains: {
        type: "array",
      },
      postal_code: {
        type: "array",
      },
      private_key_format: {
        type: "string",
        default: "der",
        enum: ["", "der", "pem", "pkcs8"],
      },
      province: {
        type: "array",
      },
      serial_number: {
        type: "string",
      },
      signature_bits: {
        type: "integer",
        default: 0,
      },
      skid: {
        type: "string",
        default: "",
      },
      street_address: {
        type: "array",
      },
      ttl: {
        type: "string",
        format: "duration",
      },
      uri_sans: {
        type: "array",
      },
      use_csr_values: {
        type: "boolean",
        default: false,
      },
      use_pss: {
        type: "boolean",
        default: false,
      },
    },
  },
  "issuer-save": {
    title: "Configure issuer",
    endpoint: "issuer/{ref}",
    tab: "issuers",
    reference: true,
    method: "POST",
    fields: {
      crl_distribution_points: {
        type: "array",
      },
      delta_crl_distribution_points: {
        type: "array",
      },
      enable_aia_url_templating: {
        type: "boolean",
        default: false,
      },
      issuer_name: {
        type: "string",
      },
      issuing_certificates: {
        type: "array",
      },
      leaf_not_after_behavior: {
        type: "string",
        default: "err",
      },
      manual_chain: {
        type: "array",
      },
      ocsp_servers: {
        type: "array",
      },
      revocation_signature_algorithm: {
        type: "string",
        default: "",
      },
      usage: {
        type: "array",
        default: [
          "read-only",
          "issuing-certificates",
          "crl-signing",
          "ocsp-signing",
        ],
      },
    },
  },
  "issuer-revoke": {
    title: "Revoke issuer",
    endpoint: "issuer/{ref}/revoke",
    tab: "issuers",
    reference: true,
    method: "POST",
    fields: {},
  },
  "issuer-delete": {
    title: "Delete issuer",
    endpoint: "issuer/{ref}",
    tab: "issuers",
    reference: true,
    method: "DELETE",
    fields: {},
  },
  "key-generate": {
    title: "Generate key",
    endpoint: "keys/generate/{mode}",
    tab: "keys",
    reference: false,
    method: "POST",
    fields: {
      key_bits: {
        type: "integer",
        default: 0,
      },
      key_name: {
        type: "string",
      },
      key_type: {
        type: "string",
        default: "rsa",
        enum: ["rsa", "ec", "ed25519"],
      },
      managed_key_id: {
        type: "string",
      },
      managed_key_name: {
        type: "string",
      },
    },
  },
  "key-import": {
    title: "Import key",
    endpoint: "keys/import",
    tab: "keys",
    reference: false,
    method: "POST",
    fields: {
      key_name: {
        type: "string",
      },
      pem_bundle: {
        type: "string",
      },
    },
  },
  "key-save": {
    title: "Edit key",
    endpoint: "key/{ref}",
    tab: "keys",
    reference: true,
    method: "POST",
    fields: {
      key_name: {
        type: "string",
      },
    },
  },
  "key-delete": {
    title: "Delete key",
    endpoint: "key/{ref}",
    tab: "keys",
    reference: true,
    method: "DELETE",
    fields: {},
  },
  "certificate-revoke": {
    title: "Revoke certificate",
    endpoint: "revoke",
    tab: "certificates",
    reference: false,
    method: "POST",
    fields: {
      certificate: {
        type: "string",
      },
      serial_number: {
        type: "string",
      },
    },
  },
  "tidy-start": {
    title: "Tidy",
    endpoint: "tidy",
    tab: "tidy",
    reference: false,
    method: "POST",
    fields: {
      acme_account_safety_buffer: {
        type: "string",
        format: "duration",
        default: 2592000,
      },
      issuer_safety_buffer: {
        type: "string",
        format: "duration",
        default: 31536000,
      },
      pause_duration: {
        type: "string",
        default: "0s",
      },
      revocation_queue_safety_buffer: {
        type: "string",
        format: "duration",
        default: 172800,
      },
      safety_buffer: {
        type: "string",
        format: "duration",
        default: 259200,
      },
      tidy_acme: {
        type: "boolean",
        default: false,
      },
      tidy_cert_metadata: {
        type: "boolean",
      },
      tidy_cert_store: {
        type: "boolean",
      },
      tidy_cmpv2_nonce_store: {
        type: "boolean",
      },
      tidy_cross_cluster_revoked_certs: {
        type: "boolean",
      },
      tidy_expired_issuers: {
        type: "boolean",
      },
      tidy_move_legacy_ca_bundle: {
        type: "boolean",
      },
      tidy_revocation_list: {
        type: "boolean",
      },
      tidy_revocation_queue: {
        type: "boolean",
        default: false,
      },
      tidy_revoked_cert_issuer_associations: {
        type: "boolean",
      },
      tidy_revoked_certs: {
        type: "boolean",
      },
    },
  },
  "tidy-cancel": {
    title: "Cancel tidy",
    endpoint: "tidy-cancel",
    tab: "tidy",
    reference: false,
    method: "POST",
    fields: {},
  },
  "root-delete": {
    title: "Delete all issuers",
    endpoint: "root",
    tab: "configuration",
    reference: false,
    method: "DELETE",
    fields: {},
  },
  "config-cluster": {
    title: "Save Cluster Config",
    endpoint: "config/cluster",
    tab: "configuration",
    reference: false,
    method: "POST",
    fields: {
      aia_path: {
        type: "string",
      },
      path: {
        type: "string",
      },
    },
  },
  "config-acme": {
    title: "Save ACME Config",
    endpoint: "config/acme",
    tab: "configuration",
    reference: false,
    method: "POST",
    fields: {
      allow_role_ext_key_usage: {
        type: "boolean",
        default: false,
      },
      allowed_issuers: {
        type: "array",
        default: ["*"],
      },
      allowed_roles: {
        type: "array",
        default: ["*"],
      },
      default_directory_policy: {
        type: "string",
        default: "sign-verbatim",
      },
      dns_resolver: {
        type: "string",
        default: "",
      },
      eab_policy: {
        type: "string",
        default: "always-required",
      },
      enabled: {
        type: "boolean",
        default: false,
      },
      max_ttl: {
        type: "string",
        format: "duration",
        default: 7776000,
      },
    },
  },
  "config-urls": {
    title: "Save Global URLs",
    endpoint: "config/urls",
    tab: "configuration",
    reference: false,
    method: "POST",
    fields: {
      crl_distribution_points: {
        type: "array",
      },
      delta_crl_distribution_points: {
        type: "array",
      },
      enable_templating: {
        type: "boolean",
        default: false,
      },
      issuing_certificates: {
        type: "array",
      },
      ocsp_servers: {
        type: "array",
      },
    },
  },
  "config-crl": {
    title: "Save CRL and OCSP",
    endpoint: "config/crl",
    tab: "configuration",
    reference: false,
    method: "POST",
    fields: {
      auto_rebuild: {
        type: "boolean",
      },
      auto_rebuild_grace_period: {
        type: "string",
        default: "12h",
      },
      cross_cluster_revocation: {
        type: "boolean",
      },
      delta_rebuild_interval: {
        type: "string",
        default: "15m",
      },
      disable: {
        type: "boolean",
      },
      enable_delta: {
        type: "boolean",
      },
      expiry: {
        type: "string",
        default: "72h",
      },
      max_crl_entries: {
        type: "integer",
        default: 100000,
      },
      ocsp_disable: {
        type: "boolean",
      },
      ocsp_expiry: {
        type: "string",
        default: "1h",
      },
      unified_crl: {
        type: "boolean",
        default: "false",
      },
      unified_crl_on_existing_paths: {
        type: "boolean",
        default: "false",
      },
    },
  },
  "config-issuers": {
    title: "Save Default issuer",
    endpoint: "config/issuers",
    tab: "configuration",
    reference: false,
    method: "POST",
    fields: {
      default: {
        type: "string",
      },
      default_follows_latest_issuer: {
        type: "boolean",
        default: false,
      },
    },
  },
  "config-auto-tidy": {
    title: "Save Automatic tidy",
    endpoint: "config/auto-tidy",
    tab: "tidy",
    reference: false,
    method: "POST",
    fields: {
      acme_account_safety_buffer: {
        type: "string",
        format: "duration",
        default: 2592000,
      },
      enabled: {
        type: "boolean",
      },
      interval_duration: {
        type: "string",
        format: "duration",
        default: 43200,
      },
      issuer_safety_buffer: {
        type: "string",
        format: "duration",
        default: 31536000,
      },
      maintain_stored_certificate_counts: {
        type: "boolean",
        default: false,
      },
      max_startup_backoff_duration: {
        type: "string",
        format: "duration",
        default: 900,
      },
      min_startup_backoff_duration: {
        type: "string",
        format: "duration",
        default: 300,
      },
      pause_duration: {
        type: "string",
        default: "0s",
      },
      publish_stored_certificate_count_metrics: {
        type: "boolean",
        default: false,
      },
      revocation_queue_safety_buffer: {
        type: "string",
        format: "duration",
        default: 172800,
      },
      safety_buffer: {
        type: "string",
        format: "duration",
        default: 259200,
      },
      tidy_acme: {
        type: "boolean",
        default: false,
      },
      tidy_cert_metadata: {
        type: "boolean",
      },
      tidy_cert_store: {
        type: "boolean",
      },
      tidy_cmpv2_nonce_store: {
        type: "boolean",
      },
      tidy_cross_cluster_revoked_certs: {
        type: "boolean",
      },
      tidy_expired_issuers: {
        type: "boolean",
      },
      tidy_move_legacy_ca_bundle: {
        type: "boolean",
      },
      tidy_revocation_list: {
        type: "boolean",
      },
      tidy_revocation_queue: {
        type: "boolean",
        default: false,
      },
      tidy_revoked_cert_issuer_associations: {
        type: "boolean",
      },
      tidy_revoked_certs: {
        type: "boolean",
      },
    },
  },
};
