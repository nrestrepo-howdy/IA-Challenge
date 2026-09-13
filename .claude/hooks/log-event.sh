#!/usr/bin/env bash
# Verbo · evidence layer.
#
# Installed both at project level and (scoped) at user level, because Claude Code
# loads project settings from the session's project root -- and a session started
# elsewhere would silently record nothing. Development evidence is the one artifact
# that cannot be reconstructed later, so it gets a belt and braces.
#
# NOT registered on WorktreeCreate. That event treats the hook's stdout as the
# worktree path, so a logger attached to it returns an empty path and aborts
# worktree creation outright. Worktree spans are reconstructed from
# SubagentStart/SubagentStop instead, which is what the parallelism evidence
# actually needs.
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

# Secrets are stripped here, at the only moment they can be stripped once.
#
# The evidence layer records every command, and a command is exactly where a key ends
# up: `ANTHROPIC_API_KEY=sk-ant-... npm run dev` is the shape of the fix for a server
# that needs one. 58 lines of this log held a live credential before this existed, and
# the log is a required submission artifact — so the leak was not hypothetical, it was
# scheduled.
#
# Redacting at write time rather than before publishing is the difference between a rule
# and a guarantee: a redaction step that runs at publish is one somebody has to remember,
# and the whole argument of this project is that those become defects.
DIR="$REPO/.verbo"
mkdir -p "$DIR" 2>/dev/null || exit 0
PAYLOAD="$(printf '%s' "$PAYLOAD" | sed -E 's/(sk-ant-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/\1<redacted>/g; s/(gh[pousr]_)[A-Za-z0-9]{10,}/\1<redacted>/g; s/(AKIA)[A-Z0-9]{12,}/\1<redacted>/g')"
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
