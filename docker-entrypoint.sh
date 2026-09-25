#!/bin/sh

case "${1:-}" in
  /bin/sh|/bin/ash|sh|ash|/usr/bin/bash|bash)
    if [ "${VAULTLENS_DEBUG_SHELL:-false}" = "true" ]; then
      :
    elif [ "${1}" = "sh" ] && [ "${2:-}" = "-c" ]; then
      # Pattern match (not exact-string equality) so a compose `command:` that adds
      # a flag or step to the npm-install-then-start sequence doesn't need a second
      # hardcoded string added here every time — it must still start with
      # "npm install" and end by starting the app with "npm start".
      case "${3:-}" in
        "npm install"*"npm start")
          :
          ;;
        *)
          echo "Shell access is disabled. Set VAULTLENS_DEBUG_SHELL=true for debugging." >&2
          exit 126
          ;;
      esac
    else
      echo "Shell access is disabled. Set VAULTLENS_DEBUG_SHELL=true for debugging." >&2
      exit 126
    fi
    ;;
esac

exec "$@"