#!/bin/sh

case "${1:-}" in
  /bin/sh|/bin/ash|sh|ash|/usr/bin/bash|bash)
    if [ "${VAULTLENS_DEBUG_SHELL:-false}" = "true" ]; then
      :
    elif [ "${1}" = "sh" ] && [ "${2:-}" = "-c" ] && [ "${3:-}" = "npm install && npm run build && npm start" ]; then
      :
    else
      echo "Shell access is disabled. Set VAULTLENS_DEBUG_SHELL=true for debugging." >&2
      exit 126
    fi
    ;;
esac

exec "$@"