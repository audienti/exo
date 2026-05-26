# CLI Guide

This is the practical guide for a human operator using Exo from the shell.

Exo is not a general browser automation tool. It is a GTM operating kernel with a CLI projection. That means the commands are about Exo objects and motions, not keystrokes or websites.

## Core operating rules

1. Run Exo from the same repo root when you want multiple shells or agent chats to share state.
2. Use `--json` when a downstream tool or agent needs structured output.
3. Treat browser profiles as a prerequisite for browser-backed work.
4. Do not let Exo guess which browser identity to use.

## Local state

Exo stores workspace-local state in:

```bash
.exo/exo.db
```

That path is resolved from the current working directory.

If you want several shells or agent chats to share one Exo store even when their working directories differ, set:

```bash
export EXO_STATE_DIR=/Users/williamflanagan/Projects/omalab/exo/.exo
```

## First operator flow

### 0. Ask Exo what it is

```bash
exo what-is-this
```

Or for agent-readable output:

```bash
exo what-is-this --json
```

### 1. Register the browser profile you expect to use

```bash
exo profiles add \
  --browser chrome \
  --label work-linkedin \
  --profile-directory "Profile 2" \
  --capability linkedin \
  --capability sales-navigator
```

Then verify it:

```bash
exo profiles list
exo profiles test <profile-id>
```

### 2. Define a motion

```bash
exo motion add \
  --url https://example.com/product \
  --geo "United States" \
  --icp regulated-enterprise \
  --industry banking,lending \
  --title "Chief Risk Officer" \
  --segment traditional-fi
```

### 3. Inspect the stored motion

```bash
exo motion list
exo motion show <motion-id>
```

## Output modes

### Human mode

Plain terminal output:

```bash
exo profiles list
exo motion show <motion-id>
```

### Agent mode

Structured output:

```bash
exo profiles list --json
exo motion show <motion-id> --json
exo motion add --url https://example.com/product --json
```

## Parallel agent access

Multiple agents can operate against the same Exo store at the same time.

The current model is:

- shared local SQLite state
- parallel reads
- serialized writes
- short object-level commands

That is enough for multiple parallel CLI invocations as long as they are all pointed at the same Exo store and they are not trying to hold long-lived write work open.

## Browser profile status

The current status meanings are:

- `ready`: profile looks usable for browser-backed work
- `warning`: profile exists, but Exo found non-fatal trust issues
- `invalid`: profile should not be used until repaired

The CLI currently checks local browser artifacts, not live SaaS auth. That is enough to catch many wrong-profile failures early, but it does not yet prove live LinkedIn or Sales Navigator access.

## Current command set

- `exo motion add`
- `exo motion list`
- `exo motion show`
- `exo profiles add`
- `exo profiles list`
- `exo profiles show`
- `exo profiles test`
- `exo profiles remove`

## What is not built yet

The current CLI does not yet:

- attach a browser profile to a motion
- probe live LinkedIn or Sales Navigator access
- build the real target map from browser retrieval
- drive browser actions through MCP

That is still ahead.
