# Next

`exo next` is the operator shorthand for:

> what should happen next?

It is not a separate truth model.
It is a routing surface over the planner state Exo already has.

## Resolution order

Exo resolves the next move in this order:

1. daily agenda item for a real execution user
2. motion-level next action for the focus or requested motion
3. general operator call from `exo what-is-this`

That means `exo next` prefers a concrete due move over a generic recommendation.

## Commands

```bash
exo next
exo next --user <user-id>
exo next --motion <motion-id> --json
```

## Current behavior

Today `exo next` can:
- return a due-now reply or follow-up from `daily`
- return the top motion blocker-clearing action when no user agenda exists
- fall back to Exo's current operator call when neither a user agenda nor a motion path is specific enough

It also carries the current priority class:
- `reply`
- `action`
- `wait`

It now also carries doc-backed planner guidance:
- a guidance document path under `docs/planner/`
- an agent-facing task prompt
- structured principles, do/avoid rules, and writeback expectations in JSON mode

When the strongest next move is a direct operator decision, `exo next --json` also exposes an `operatorPrompt` field.
That field is the short operator-facing question the agent should ask instead of narrating bootstrapping or planner internals.
Example:

> Jordan Cipolla sent you an inbound LinkedIn connection request. Accept or decline?

## Not implemented yet

`exo next` still does not:
- do live retrieval itself
- dispatch work to subagents
- perform the action

The agent still does the work.
Exo decides what the strongest next governed move is.
