# Parallel Agent Access

Exo should assume that more than one agent conversation may be operating at the same time.

That is not a future nicety. It is part of the point. If Exo cannot support parallel agent access safely, it will bottleneck exactly where it is supposed to create leverage.

## The actual requirement

Multiple agents should be able to:

- read the same motion state
- read the same browser-profile state
- write small updates into the same store
- do this from separate shells or separate conversations

without silently diverging into separate local stores or throwing random lock failures.

## Current model

The current Exo model is:

- one local SQLite store
- parallel reads
- serialized writes
- short CLI invocations

That is enough for the current stage.

## Shared-state rule

All collaborating shells should point at the same Exo store.

There are two ways to do that:

### Option 1

Run from the same repo root:

```bash
cd /Users/williamflanagan/Projects/omalab/exo
exo motion list
```

### Option 2

Pin the store explicitly:

```bash
export EXO_STATE_DIR=/Users/williamflanagan/Projects/omalab/exo/.exo
```

This is better for multiple agent conversations because it removes dependence on matching working directories.

## Why `EXO_STATE_DIR` matters

If agents rely only on `cwd`, one drifted shell can accidentally create:

- a second `.exo` directory
- a second `exo.db`
- the illusion of concurrency while actually splitting state

That is garbage. Pin the store if the work matters.

## Current concurrency semantics

The current state store is SQLite.

The operational expectation is:

- reads can happen in parallel
- writes are serialized
- commands should be short and object-level
- long-running work should happen outside the write window

That means:

- `exo motion list --json` can be called freely
- `exo motion show <id> --json` can be called freely
- `exo profiles list --json` can be called freely
- write commands should remain small and bounded

## What not to do

Do not:

- hold open long write transactions
- rely on shell-local implicit state
- guess browser identity independently in each agent
- let one agent write into a different Exo store by accident

## Practical bootstrap for parallel agents

Each agent shell should start with:

```bash
export EXO_STATE_DIR=/Users/williamflanagan/Projects/omalab/exo/.exo
cd /Users/williamflanagan/Projects/omalab/exo
exo what-is-this --json
exo companies list --json
exo profiles list --json
exo profiles capabilities --json
exo motion list --json
```

That gives all agents:

- the same store
- the same browser-profile truth
- the same motion ids

## Current limitations

This does not yet solve:

- record-level conflict resolution
- profile-to-motion assignment
- live browser auth probing
- background coordination primitives

It only establishes the minimum viable concurrency contract: separate agent processes can safely share one Exo state store.

If agents are not sharing one store and the goal is handoff instead of live shared access, use:

```bash
exo config export --out ./exo-config.json
exo config import ./exo-config.json
```
