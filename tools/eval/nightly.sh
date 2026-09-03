#!/usr/bin/env bash
# Verbo · nightly evaluation runner.
#
# Self-contained: builds, serves, evaluates, tears down. Runs unattended, so it must
# never leave a preview server behind and never block on a port that is already taken.
#
# Install:  crontab -l | { cat; echo "17 3 * * * $HOME/verbo/tools/eval/nightly.sh"; } | crontab -
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

PORT=${VERBO_EVAL_PORT:-4199}
LOG=".verbo/eval/runner.log"
mkdir -p .verbo/eval
exec >>"$LOG" 2>&1
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) starting"

# A stale server from a crashed run would silently serve yesterday's build, and the
# evaluation would report on code that is no longer in the tree.
lsof -ti :"$PORT" | xargs -r kill -9 2>/dev/null

npm run build || { echo "build failed; nothing evaluated"; exit 1; }
npx vite preview --port "$PORT" --strictPort &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT

for _ in $(seq 1 30); do
  curl -sf "http://localhost:$PORT" >/dev/null && break
  sleep 1
done

VERBO_URL="http://localhost:$PORT" node tools/eval/nightly.mjs
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) done"
