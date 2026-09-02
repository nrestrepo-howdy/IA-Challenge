#!/usr/bin/env bash
# Verbo · control determinista. La spec y los contratos no se tocan durante
# la implementación: son la referencia contra la que se verifica todo.
# Escotilla explícita y auditable: VERBO_SPEC_UNLOCK=1
set -u
[ "${VERBO_SPEC_UNLOCK:-0}" = "1" ] && exit 0
PAYLOAD="$(cat)"
TARGET="$(printf '%s' "$PAYLOAD" | jq -r '(.tool_input.file_path // .tool_input.path // "") + " " + (.tool_input.command // "")')"
for P in "docs/SPEC.md" "docs/contracts/" "src/contracts.ts" ".verbo/" ".claude/hooks/"; do
  case "$TARGET" in
    *"$P"*)
      echo "BLOQUEADO por control determinista: '$P' es un artefacto protegido." >&2
      echo "La spec y los contratos definen la verdad contra la que se verifica el trabajo;" >&2
      echo "cambiarlos a mitad de implementación invalida la verificación." >&2
      echo "Si el cambio es intencional, es una decisión humana: VERBO_SPEC_UNLOCK=1" >&2
      exit 2 ;;
  esac
done
exit 0
