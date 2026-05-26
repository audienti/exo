# Exo Repo Instructions

This repo is agent-first.

Exo is not primarily a human shell product. It is a GTM operating kernel that agents query in order to:

- load governed GTM state
- decide what action path they are on
- enforce browser/profile safety
- preserve durable motion/company/config state

If you are an agent entering this repo, treat Exo as a behavior and governance layer, not as a generic CLI bag.
Treat Exo as the GTM system of record. Do not leave durable research findings only in browser tabs, scratch notes, or prose when Exo has a place to store them.

The operator-facing conversation contract lives inside Exo itself. Do not invent your own explanation layer when `exo what-is-this --json` already provides one.

## Session Start

Run this sequence first:

```bash
cd /Users/williamflanagan/Projects/omalab/exo
export EXO_STATE_DIR=/Users/williamflanagan/Projects/omalab/exo/.exo
exo what-is-this --json
```

Then read these fields from the JSON result before doing anything else:

- `operatorInterface`
- `agentUsage.recommendedPath`
- `stateSummary`
- `gettingStarted`
- `currentLimitations`

Do not skip that step.

## Reinitialize

If you are told to "reinitialize", do this:

1. Re-read this `AGENTS.md`
2. Re-run:

```bash
cd /Users/williamflanagan/Projects/omalab/exo
export EXO_STATE_DIR=/Users/williamflanagan/Projects/omalab/exo/.exo
exo what-is-this --json
```

3. Re-evaluate:
   - what mode you are in
   - what state already exists
   - what the next governed action should be

Reinitialize does **not** mean "assume empty state" or "create a new motion."

Use `operatorInterface.currentCall` and `agentUsage.recommendedPath` as the source of truth for what Exo thinks the next governed move is.

## Hard Rules

1. Always pin `EXO_STATE_DIR` when shared state matters.
2. Prefer `--json`.
3. Do not guess browser identity.
4. Browser-backed work fails closed if no trusted profile exists.
5. Do not add duplicate motions or companies until you inspect existing state.
6. Use config export/import for handoff. Do not default to copying SQLite files.
7. If a command starts working after opening the state store on a new version, assume a local state migration ran. That is intended behavior.
8. Exo resolves browser identity; the session chooses the browser-control harness. In Codex, prefer the Chrome skill/native Chrome connector. In Claude, prefer the native browser-use/browser-control surface. Do not default to Playwriter.
9. Treat Exo as the system of record. If you find a durable signal, website, stakeholder, or assignment that Exo can store, write it back before you summarize.

## What Exo Is Good For Right Now

Exo currently supports:

- motion definition and inspection
- canonical company registry
- browser profile registry and capability inspection
- config export/import
- shared local state across parallel agents
- versioned local DB migrations

## What Exo Does Not Do Yet

Do not pretend these exist:

- automatic company retrieval from motions
- live Sales Navigator retrieval
- live LinkedIn/Gmail/HubSpot auth proof
- profile-to-motion assignment
- real target-map generation beyond seeded placeholders
- real stakeholder-map generation beyond seeded placeholders

## Recommended First Actions

If you need the actual current state:

```bash
exo motion list --json
exo companies list --json
exo profiles list --json
exo profiles capabilities --json
```

If you need to inspect a motion:

```bash
exo motion show <motion-id> --json
```

If you need to create a new motion:

```bash
exo motion add \
  --url https://example.com/product \
  --premise "This offer matters when ..." \
  --audience "Primary ICP" \
  --signal "company::Is there recent evidence that ...?" \
  --json
```

If the motion is richer than a few flags, use:

```bash
exo motion add --config ./motion.json --json
```

## Interpretation Rule

Exo is queryable, but querying is secondary.

The main purpose of Exo is to:

- drive agent behavior
- hold durable GTM state
- define safe next actions
- constrain execution to governed objects and paths

If you use Exo like a simple status command, you are under-using it.
