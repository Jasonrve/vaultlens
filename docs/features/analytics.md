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
