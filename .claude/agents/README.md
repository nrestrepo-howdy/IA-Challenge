# Workstream agents

The five agents that built Verbo, as definitions rather than as prompts.

They ran in parallel git worktrees against `src/contracts.ts`, which was frozen before
any of them started. That freeze is the whole reason five agents integrated with zero
merge conflicts while 38% of delegations never reported finishing (`npm run
evidence:autonomy -- --delegation`): a dead agent cost its own workstream and nothing
else, because there was no shared interface for it to have half-written.

Three things are declared here that used to live in an instruction:

- **`tools`** — the context boundary as a control. WS1 has no browser and no web; WS3
  has no renderer. An agent that cannot reach a directory cannot be asked to remember
  not to.
- **`isolation: worktree`** — the branch is not a convention the agent follows, it is
  where it wakes up.
- **The charter** — scope, the contract it must honour, and its definition of done, in
  the system prompt instead of in whichever message happened to start it.

The rubric warns against inventing agent roles to satisfy a competition. These are the
roles that ran; what changed is that they are now reproducible.
