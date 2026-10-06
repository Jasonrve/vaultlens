# VaultLens UI Test Results

Full-app UI QA pass performed via the Claude-in-Chrome browser plugin against a local dev stack
(Vault dev server + `npm run dev`, logged in with the Vault root token). Every route in
`app/src/client/App.tsx` was exercised. All issues found below have been fixed and verified live
in the browser. Everything not listed here was verified working with no console errors and no
failed network requests.

## Fixed issues

- [x] **Analytics page — ACL Policies count always showed "—"** (`/admin/analytics`)
  - `AnalyticsPage.tsx` stored the result of `api.getPolicies()` (which resolves to `{ policies: string[], restricted?: boolean }`) directly into `policies` state typed `string[] | null`. Reading `policies?.length` on the wrapper object was always `undefined`.
  - Fix: `setPolicies(p.value.policies)` instead of `setPolicies(p.value)`. Verified live — the tile now shows the real count (10).

- [x] **Policies — comment-only policies rendered blank, and switching edit modes silently discarded content** (`/policies/vaultlens-admin`, `/policies/vaultlens-system-policy`, and in principle any policy with comments)
  - Root cause: `PolicyDetail.tsx` initialized `editMode` to `'visual'` instead of `'view'`, so every policy page landed directly in an edit mode (Save/Cancel visible) rather than the neutral read-only view. For a policy with no `path` blocks (comment-only), the Visual editor showed "No paths" and switching to "Raw HCL" regenerated the textarea from the (empty) parsed rows via `generateHCL(visualRows)`, discarding the actual HCL comments entirely — clicking Save would have silently wiped them.
  - Fix: default `editMode` to `'view'`. Policies now land on a proper read-only view (HCL rules + parsed paths) with explicit "Edit (Visual)" / "Edit (Raw HCL)" / "Delete" actions, matching the code's own intended (but previously unreachable) view-mode rendering. Verified live — `vaultlens-admin` now shows its comments correctly in both the view and Raw HCL editor.

- [x] **Login — invalid token showed raw HTTP error** (`/login`, Token method)
  - `authStore.ts`'s `login()` catch block read only `err.message` (axios's generic "Request failed with status code 403"), ignoring the server's own friendly `{ error: "Permission denied" }` response body.
  - Fix: prefer `err.response.data.error` when present, falling back to `err.message`. Verified live — invalid token now shows "Permission denied".

- [x] **Webhooks — delete had no confirmation prompt** (`/admin/hooks`)
  - Fix: added a confirmation step before deleting, consistent with every other destructive action in the app. Verified live.

- [x] **Destructive actions used unstyled native `window.confirm()` instead of the app's Modal component**
  - `SecretView.tsx` (delete secret, restore version), `PolicyList.tsx`, `PolicyDetail.tsx`, `RoleList.tsx`, `RoleDetail.tsx` (delete role, revoke secret ID), `DevIntegrationTab.tsx` (reset guide), and `HooksPage.tsx` (delete webhook) all gated deletes behind the browser's native `confirm()` dialog.
  - Fix: added a small reusable `common/ConfirmDialog.tsx` built on the existing `Modal.tsx`, and swapped every native `confirm()` call site to use it. Verified live for secret delete and webhook delete — both now show the app's own styled confirmation dialog.

## Investigated, not a real bug (false positive)

- **Visualizations — node search box "doesn't accept keyboard input"** (`/visualizations`)
  - Initial QA testing reported the search box swallowing keystrokes on all 4 graph tabs. Root-caused by hand: typing via precise element-reference clicks succeeded reliably across all 4 tabs (Auth→Role→Policy, Policy→Secret Path, Policy Relationships, Identity) with correct filtering, highlighting, and match-count updates every time. The original failures reproduced only when the automation clicked at stale/imprecise coordinates (e.g. after a viewport-size drift, or a triple-click that landed a native text selection outside the input instead of focusing it) — a testing-tool artifact, not an application bug. No code change made.

## Verified working (no issues found)

- Dashboard overview cards + quick nav
- Secrets Engines list; full KV v2 secret CRUD (create/edit/version-history/diff/metadata/delete), JSON editor mode
- ACL Policies list and policy visualization graph (for policies with real path rules)
- Auth Methods list (15 methods), Roles/Configuration/Method Options tabs, role detail (Role Details/Developer Guide/Audits), auth-method relationship graph
- Entities & Groups list/detail, relationships graph modal
- My Identity chain graph
- Visualizations — all 4 graph tabs, Graph/Table toggle, node expand, zoom/pan, node search
- Permission Tester — both "Via Vault API" and simulated cross-entity modes, correct allow/deny graphs
- Branding — logo/name/color pickers with live preview
- Audit Log — live streaming, search/filter, pause/resume, row expansion, resource links
- Secret Rotation — scheduler status, timestamps, instructions
- Backup & Restore — schedule config, manual "Create KV Backup", backup list
- Webhooks — add-form validation, SSRF protection (blocks localhost/private targets), create/delete round trip
- Features Settings — toggles auto-save and persist correctly
- Changelog — markdown rendering with version badges
- Sharing Audit (VaultLensAuditPage) — real audit event data, date filter
- Legacy redirects (`/admin/sharing-settings`, `/admin/policies-settings`, `/admin/auth-methods-settings` → `/admin/features`)
- Login page (OIDC/Token tab switch, valid root-token login, sign out)
- Share a Secret — link creation, recipient decryption via URL fragment, one-time-view enforcement (server-side 404 after first view)
- Secret Generator — all 6 modes (password, passphrase, api-token, uuid, hex, base64), copy button
- `/setup` correctly redirects away when system token already configured
- Unknown routes correctly redirect to `/app` via the catch-all route
