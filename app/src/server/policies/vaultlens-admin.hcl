# VaultLens admin policy
# Marker policy only — assign to users who need VaultLens admin menu access.
# VaultLens checks for this policy name to determine admin UI access (requireAdmin middleware).
# This policy grants NO Vault permissions — all operations go through the user's own token.
# VaultLens will auto-create this policy on startup if it does not exist.
