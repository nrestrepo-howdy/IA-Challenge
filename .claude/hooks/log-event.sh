#!/usr/bin/env bash
# Verbo · evidence layer.
#
# Installed both at project level and (scoped) at user level, because Claude Code
# loads project settings from the session's project root -- and a session started
# elsewhere would silently record nothing. Development evidence is the one artifact
# that cannot be reconstructed later, so it gets a belt and braces.
#
# Outside the Verbo repo this is a no-op: it must never pollute other work.
# It never blocks: any failure exits 0 and the agent continues.
set -u
REPO="$HOME/verbo"
PAYLOAD="$(cat)"

# Scope check: log only when the work is happening inside the repo.
CWD="$(printf '%s' "$PAYLOAD" | jq -r '.cwd // ""' 2>/dev/null || echo "")"
case "${CLAUDE_PROJECT_DIR:-$CWD}" in
  "$REPO"|"$REPO"/*) ;;
  *) case "$CWD" in "$REPO"|"$REPO"/*) ;; *) exit 0 ;; esac ;;
esac

DIR="$REPO/.verbo"
mkdir -p "$DIR" 2>/dev/null || exit 0
printf '%s' "$PAYLOAD" | jq -c --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{
  ts:        $ts,
  event:     (.hook_event_name // "unknown"),
  session:   (.session_id      // null),
  prompt:    (.prompt_id       // null),
  agent:     (.agent_id        // null),
  agent_type:(.agent_type      // null),
  tool:      (.tool_name       // null),
  use_id:    (.tool_use_id     // null),
  file:      (.tool_input.file_path // .tool_input.path // null),
  cmd:       (.tool_input.command   // null),
  ok:        (if .hook_event_name == "PostToolUseFailure" then false else null end),
  stop:      (.stop_reason     // null)
}' >> "$DIR/events.jsonl" 2>/dev/null
exit 0
