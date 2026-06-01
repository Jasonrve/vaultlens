---
layout: home

hero:
  name: VaultLens
  text: A Modern Web UI for HashiCorp Vault
  tagline: Browse secrets. Visualize policies. Share securely. Manage Vault with confidence.
  image:
    src: /logo.png
    alt: VaultLens
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/Jasonrve/vaultlens

features:
  - icon: 🔐
    title: Secret Management
    details: Browse and manage KV v1/v2 secrets across all mounted engines. Restricted-access partial updates let users modify fields without seeing values they can't read.
  - icon: 🗺️
    title: Interactive Visualizations
    details: Explore your Vault's structure through React Flow graphs — auth methods to policies, policies to secret paths, and full identity chains.
  - icon: 🔗
    title: Secure Secret Sharing
    details: Share secrets with end-to-end encryption via URL fragment. The server never sees plaintext. Recipients decrypt entirely in their browser.
  - icon: 🔄
    title: Secret Auto-Rotation
    details: Automatically rotate KV v2 secrets on a schedule using Vault custom metadata. Set rotate-interval and let VaultLens handle the rest.
  - icon: 💾
    title: Backup & Restore
    details: Create instant or scheduled full backups of all KV secrets. Restore any saved backup with one click.
  - icon: 🔔
    title: Webhook Notifications
    details: Monitor the Vault audit log and fire HMAC-signed HTTP POST webhooks when secrets at matching paths are modified.
  - icon: 🧪
    title: Permission Tester
    details: Select any entity, enter a path and operation, and instantly see whether access is allowed — with a full graph showing which policies contribute.
  - icon: 📊
    title: Analytics Dashboard
    details: Vault health, seal status, version, storage backend, token counts, entity counters, and request metrics — all in one place.
  - icon: 🎨
    title: Custom Branding
    details: Customize VaultLens with your organization's logo, primary color, and application name.
---
