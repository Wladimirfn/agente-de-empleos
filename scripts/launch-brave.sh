#!/usr/bin/env bash
# Launch Brave (or Chrome/Edge) with --remote-debugging-port=9222
# so the agent can connect via CDP.
#
# Usage: ./scripts/launch-brave.sh [brave|chrome|edge]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/launch-brave.mjs" "${1:-brave}"
