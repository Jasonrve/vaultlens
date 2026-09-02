# Analytics Dashboard

![Analytics](/screenshots/analytics.png)

The Analytics dashboard provides a real-time overview of your Vault cluster's health and resource counts.

## Accessing Analytics

Navigate to **Admin → Analytics**.

::: info
The Analytics page requires the `vaultlens-admin` policy (or `root`).
:::

## Cluster Health

| Metric | Description |
|--------|-------------|
| **Status** | Initialized / Uninitialized |
| **Sealed** | Whether Vault is sealed |
| **Standby** | Whether this node is in standby mode |
| **Version** | Vault server version |
| **Cluster Name** | Vault cluster identifier |
| **Storage Backend** | Active storage backend (raft, consul, etc.) |

## Resource Counts

| Counter | Description |
|---------|-------------|
| **Secret Engines** | Number of mounted KV engines |
| **Auth Methods** | Number of enabled auth methods |
| **ACL Policies** | Total policy count |
| **Entities** | Identity entity count |
| **Groups** | Identity group count |

## Internal Counters

Vault's internal request counters (if enabled) show:
- Total requests
- Requests by auth method
- Requests by namespace

## Seal Status Details

Expanded seal information including:
- Seal type (`shamir`, `awskms`, `gcpckms`, etc.)
- Key shares and threshold (Shamir seal)
- Sealed/unsealed state
- Cluster leader address

## Audit Logging

The **Lens Audits** page records events from VaultLens features and integrations using a generic format:

| Field | Description |
|-------|-------------|
| **Action** | The event name, such as `login`, `logout`, or `share.created` |
| **Status** | Whether the event succeeded or failed, when applicable |
| **Actor** | The user, service, or system that performed the action |
| **Target** | The resource, path, or object affected by the action |
| **Details** | Event-specific context for filtering and investigation |
| **Client IP** | The originating client address, when available |

This allows authentication, sharing, and future event types to appear in the same audit trail. Credentials and secret values are never written to the audit log. Older sharing entries are converted to the generic format when read.

When the [socket audit source](/architecture/system-token) is active, the Audit Logging card shows live stats about the in-memory audit buffer:

| Stat | Description |
|------|-------------|
| **Connected Clients** | Number of Vault nodes currently streaming audit events to VaultLens |
| **Events Received** | Total audit events received since the socket server started |
| **Buffer Size** | Number of entries currently held in the ring buffer |
| **Memory (est.)** | Estimated memory footprint of the buffered entries |
| **Last Event** | Time of the most recently received audit event |

::: info
**Memory (est.)** is an approximation based on V8's structured-clone byte length, not an exact heap measurement. It's calculated on demand when the Analytics page loads (not on every event), so it may briefly show a loading spinner while the buffer is serialized.
:::

## Auto-Refresh

The analytics page refreshes data every **30 seconds** automatically.
