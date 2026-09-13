---
description: Regenerate every evidence artifact the submission depends on, and check that none of them contains a secret.
allowed-tools: Bash, Read, Edit
---

## What this produces

Four artifacts, all read from records kept at the time rather than written from memory.
A claim about how the work was done is only worth what its evidence is worth.

## Run, in this order

1. `npm run evidence` — the parallelism swimlanes in `docs/SYSTEM.md`, from
   `.verbo/events.jsonl`. Generated, never typed: if the agents had not overlapped, no
   amount of formatting would say they did.

2. `npm run evidence:autonomy` — loops that closed inside a single human turn. The proof
   is the prompt id: every lifecycle event carries the id of the turn it belongs to, so
   a failure, its fixes and the passing re-check sharing one id means no instruction
   arrived between them.

3. `npm run evidence:autonomy -- --delegation` — what delegation cost, including the
   share of subagents that never reported finishing. Report that number. It is the
   argument for where the boundaries were drawn, not against it.

4. `npm run evidence:loop` — the product's own repair loop, printed: three candidates
   rejected at L1, the repair reading their diagnoses with no human input, the changed
   parameter read back out of the emitted module, attempt 2 injected.

## Then check for secrets

```
git ls-files | xargs grep -lE "sk-ant-[A-Za-z0-9_-]{20}|gh[pousr]_[A-Za-z0-9]{20}|AKIA[A-Z0-9]{16}"
```

Must print nothing. `.verbo/events.jsonl` is committed on purpose — evidence that lives
only on one machine is a claim with a script attached — and it records every command,
which is exactly where a key ends up. Fifty-eight lines held one before
`.claude/hooks/log-event.sh` started stripping them at write time.

If this finds something, the leak is already in the history: rotate the credential
first, then fix the hook, then rewrite. Redacting the working copy is not enough.
