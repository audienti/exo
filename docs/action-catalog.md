# Action Catalog

Exo now has a canonical action catalog.

This is not a browser-automation abstraction.
It is the governed list of GTM actions the agent is allowed to reason about, brief, and write back after execution.

The execution hints are editable repo docs, not hardcoded recipes.
They live in platform folders such as:

- `docs/linkedin/connection_request.md`
- `docs/linkedin/follow.md`
- `docs/email/send_email.md`

Exo injects those docs into the canonical action definition and into `motion action-brief` at runtime.

Use:

```bash
exo actions list --json
exo actions show connection_request --json
exo actions result --action connection_request --result sent --company <company-id> --prospect <prospect-id> --occurred-at <iso-datetime> --json
exo motion actions <motion-id> --prospect <prospect-id> --json
exo motion action-brief <motion-id> --prospect <prospect-id> --action connection_request --json
```

## Why this exists

Before this, Exo knew:

- the motion
- the company
- the prospect
- the stored prospect context
- the cadence branch
- the draft surface

But it did not know the canonical action layer that sits between planning and execution.

That was wrong.

The existing operator workflow already has a real action vocabulary in its queue catalog, platform-action map, engagement-panel labels, and messaging replay surfaces.
Exo should use that same vocabulary instead of inventing a second one.

## Canonical actions

The current catalog covers the real outbound and warmup moves we actually care about:

- `connection_request`
- `profile_view`
- `follow`
- `unfollow`
- `send_direct_message`
- `in_mail_message`
- `send_email`
- `like_post`
- `unlike_post`
- `create_post_comment`
- `share_post`
- `create_comment_comment`
- `create_comment_reaction`
- `withdraw_connection`
- `accept_connection`
- `decline_connection`
- `voicemail_outreach`
- `video_outreach`

## Important distinction

Action type is not the same thing as draft surface.

Examples:

- canonical action: `connection_request`
  - draft surface: `connection_request`

- canonical action: `send_direct_message`
  - draft surface may be:
    - `post_accept_message`
    - `follow_up_direct_message`
    - `inbound_reply`

- canonical action: `create_post_comment`
  - draft surface: `public_comment`

- canonical action: `create_comment_comment`
  - draft surface: `comment_reply`

This distinction matters because the action is what the agent performs, while the draft surface is the writing stage the chat should use for copy.

## Execution rules

1. Resolve the company identity first.
2. Keep one sticky browser identity pinned to the company.
3. Prefer the native browser harness for the runtime.
4. Pull the action brief before performing anything sensitive.
5. If the action needs copy, pull the matching `motion draft-brief` and have the chat write from that context.
6. After the action actually happens, write it back into Exo with `exo actions result ...`.

## Hints, not recipes

LinkedIn changes too often for one rigid recipe to be trustworthy.

So Exo does not pretend that:

- one selector path always works
- one visible button location is permanent
- one warmup branch is mandatory

Instead, the injected action docs should capture:

- normal affordances
- fallback branches
- success proofs
- failure signatures
- cleanup expectations

That is enough to accelerate the normal case without lying about UI stability.

## Availability model

`exo motion actions` tells you whether an action is:

- `available`
- `blocked`
- `completed`
- `unsupported`

That judgment is based on stored prospect state such as:

- LinkedIn profile presence
- recent-post readiness
- email fallback presence
- connection acceptance state
- prior touch history
- preflight actions already completed

## What Exo still does not do

Exo still does not:

- click the button for you
- prove live entitlement for InMail
- discover phone/video delivery context automatically
- replace the chat as the writer

The correct split is:

- Exo governs the action model and state
- the chat writes the message when copy is needed
- the browser harness performs the action
- Exo records what actually happened through `exo actions result`, not by forcing every caller to hand-assemble low-level touch mutations
