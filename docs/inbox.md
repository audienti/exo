# Inbox

Exo inbox is the ranked triage surface over stored inbound observations.

It is not a notification feed and it is not the same thing as sync.

The stack is:

- inbound surfaces
- sync policy
- sync-state memory
- inbound observations
- inbox
- daily

## What inbox does

Inbox answers:

- what changed
- why it matters
- what kind of next move that change may justify

It is a read surface over stored observations and linked motion context.
It now also echoes the last checked state of enabled surfaces so "quiet" has evidence behind it.

## What inbox does not do

Inbox does not:

- scrape LinkedIn or Gmail by itself
- replace cadence logic
- replace the future daily agenda
- pretend every observation is a command to act
- replace `exo inbound review` when you need the full management question of what is sitting on invites, views, follows, and other inbound surfaces

## CLI

```bash
exo inbox --user <user-id>
exo inbox --user <user-id> --motion <motion-id> --json
exo inbox --user <user-id> --prospect <prospect-id> --json
```

## Design rule

The inbox is a triage surface.

It should rank meaningful changes, preserve context, and tell the operator what kind of move is now plausible.
It should not become a noisy feed of every low-value state change.
