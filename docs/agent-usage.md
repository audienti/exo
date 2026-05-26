# Agent Usage

This is the short guide for Claude, Codex, or any other agent using Exo from the command line.

## Do not treat Exo like a shell script bag

Exo is a stateful local operating layer. The important thing is not just running a command. The important thing is running it from the right workspace and consuming its structured outputs correctly.

## Hard rules for agents

1. `cd` to the Exo repo root before calling the CLI if shared local state matters.
2. Prefer `--json` whenever Exo output will feed another step.
3. Resolve browser profile state before browser-backed work.
4. Fail closed if the required browser profile is missing, `warning`, or `invalid` and the action is sensitive or unattended.
5. Use Exo nouns and verbs. Do not invent horizontal actions as if they are Exo features.

## Shared state rule

Exo state is currently stored in:

```bash
.exo/exo.db
```

That is relative to the current working directory.

So if an agent runs Exo from the wrong directory, it may silently create or use the wrong state store.

To prevent that, pin a shared store explicitly when multiple agent conversations should collaborate:

```bash
export EXO_STATE_DIR=/Users/williamflanagan/Projects/omalab/exo/.exo
```

That is the cleanest way to let multiple agents operate in parallel without depending on identical current working directories.

## Recommended agent flow

### First orientation call

1. `exo what-is-this --json`

Use this first when the agent needs to understand:

- what Exo is
- what Exo is not
- current commands
- browser-profile rules
- current limitations
- where local state lives

This should be the default bootstrap call for a new conversation that is about operating Exo.

### Parallel agent setup

When multiple agents will operate at the same time:

1. point them at the same Exo store with `EXO_STATE_DIR` or the same repo root
2. call `exo what-is-this --json`
3. call `exo profiles list --json`
4. call `exo motion list --json`

The current concurrency model is shared-state, parallel-read, serialized-write.

### Browser-backed work

1. `exo profiles list --json`
2. If needed, `exo profiles add ... --json`
3. `exo profiles test <profile-id> --json`
4. Refuse browser-backed work if the result is not trustworthy

### Motion setup

1. `exo motion add ... --json`
2. Persist the returned `motion.id`
3. `exo motion show <motion-id> --json` when the full stored object is needed later

## Current profile semantics

Browser profiles are first-class because the wrong local browser context means:

- the wrong LinkedIn identity
- no Sales Navigator entitlement
- the wrong Gmail session
- the wrong HubSpot org

Agents should treat profile resolution as execution identity, not local preference.

## Current limitations

Exo does not yet prove live SaaS authentication from the CLI. A `ready` profile means the local browser context appears structurally usable. It does not yet prove that LinkedIn or Sales Navigator is logged in and entitled.

That means agents should still be conservative:

- use `profiles test` as a gate
- prefer explicit profile assignment once motions support it
- avoid unattended browser work when profile trust is unresolved
