#!/usr/bin/env bash
# Verbo · capa de evidencia. Proyecta cada evento del ciclo de vida a JSONL.
# Nunca bloquea: cualquier fallo sale 0 y el agente sigue.
set -u
DIR="${CLAUDE_PROJECT_DIR:-$PWD}/.verbo"
mkdir -p "$DIR" 2>/dev/null || exit 0
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat | jq -c --arg ts "$TS" '{
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
