#!/usr/bin/env bash
# Verbo · deterministic control.
#
# The specification and the contracts are not editable during implementation. They are
# the reference everything else is verified against, so an agent that can edit them can
# make any implementation correct — which is not a rule an agent should be asked to
# remember, it is one the environment should enforce.
#
# Exit code 2 is what makes this a control rather than a suggestion: Claude Code blocks
# the tool call and returns this message to the agent.
#
# The hatch is explicit and auditable: VERBO_SPEC_UNLOCK=1. Amending the spec is a human
# decision, and every use of it is recorded in docs/AI-DEV-LOG.md.
set -u
[ "${VERBO_SPEC_UNLOCK:-0}" = "1" ] && exit 0
PAYLOAD="$(cat)"
TARGET="$(printf '%s' "$PAYLOAD" | jq -r '(.tool_input.file_path // .tool_input.path // "") + " " + (.tool_input.command // "")')"
for P in "docs/SPEC.md" "docs/contracts/" "src/contracts.ts" ".verbo/" ".claude/hooks/"; do
  case "$TARGET" in
    *"$P"*)
      echo "BLOCKED by deterministic control: '$P' is a protected artifact." >&2
      echo "The spec and the contracts define the truth this work is verified against;" >&2
      echo "changing them mid-implementation invalidates the verification." >&2
      echo "If the change is intended, it is a human decision: VERBO_SPEC_UNLOCK=1" >&2
      exit 2 ;;
  esac
done
exit 0
