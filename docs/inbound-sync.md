# Inbound Sync

Exo treats inbound observation as a governed truth layer, not as a browser trick.

The first slice does three things:

- defines the canonical inbound surfaces Exo cares about
- stores which of those surfaces are enabled on each connected user account
- stores the last known sync result for each enabled surface
- stores normalized inbound observations that an agent can write back after inspecting a live surface

The next management layer is `exo inbound review`, which combines that sync state with the concrete observations so the operator can see what actually needs a decision.

It does **not** yet do live retrieval by itself.

## Canonical surfaces

Current surfaces:

- `linkedin-sent-invitations`
- `linkedin-received-invitations`
- `linkedin-messaging-inbox`
- `linkedin-profile-views`
- `linkedin-followers-list`
- `linkedin-following-list`
- `linkedin-comment-replies`
- `linkedin-catch-up-updates`
- `gmail-inbox-threads`

These are the truth surfaces Exo should reason about first.
The LinkedIn notifications bell is intentionally not the primary source of truth.

## Why this exists

Cadence is not real if Exo cannot answer:

- which requests were accepted
- which requests came in
- which people viewed us
- which inbox threads changed
- which public replies landed

Before retrieval exists, Exo still needs a governed place to store:

- what each connected account intends to scan
- whether the last sync succeeded
- when it last synced
- how many items it saw
- whether the last run failed
- what the agent actually observed and wants Exo to remember as inbound truth

## CLI

Inspect the catalog:

```bash
exo inbound surfaces
exo inbound surface linkedin-messaging-inbox
```

Inspect one user's sync coverage:

```bash
exo inbound sync show <user-id>
exo inbound sync show <user-id> --capability linkedin --json
exo inbound sync plan <user-id> --mode quick --json
exo inbound sync run <user-id> --input ./inbound-sync.json --refresh --json
exo inbound review <user-id> --json
```

Build the actual run contract for a sync pass:

```bash
exo inbound sync plan <user-id> --mode quick
exo inbound sync plan <user-id> --mode normal --capability linkedin --json
exo inbound sync plan <user-id> --mode full --account <account-id>
```

Modes:

- `quick`: enabled authoritative surfaces only
- `normal`: enabled authoritative surfaces first, then enabled supplementary surfaces
- `full`: everything in `normal`, plus disabled optional surfaces that may be worth widening into during a reconciliation pass

Write back one inspected sync pass:

```bash
exo inbound sync run <user-id> --input ./inbound-sync.json --refresh --json
cat ./inbound-sync.json | exo inbound sync run <user-id> --input - --json
```

Payload shape:

```json
{
  "mode": "quick",
  "accounts": [
    {
      "accountId": "linkedin-account-id",
      "surfaces": [
        {
          "surfaceKey": "linkedin-received-invitations",
          "status": "success",
          "itemCount": 1,
          "observedAt": "2026-05-30T14:00:00.000Z",
          "observations": [
            {
              "kind": "connection_request_received",
              "externalId": "invite-123",
              "observedAt": "2026-05-30T14:00:00.000Z",
              "actorName": "Alicia Buyer",
              "summary": "Alicia Buyer sent us a new inbound connection request."
            }
          ]
        },
        {
          "surfaceKey": "linkedin-sent-invitations",
          "status": "warning",
          "itemCount": 1,
          "error": "Saw one pending invite but did not itemize it before leaving the page.",
          "observations": []
        }
      ]
    }
  ]
}
```

Run rules:

- the payload mode is governed, not decorative; `quick` cannot write back supplementary-only surfaces
- `success` cannot carry an error
- `warning` and `failed` must explain what was partial or broken
- `failed` cannot carry observations
- if `itemCount` is larger than the itemized observations, Exo preserves that gap so inbound review can call it out
- `--refresh` returns a fresh inbox/daily/next summary after the writeback lands

First producer slice: Gmail capture

```bash
exo inbound sync gmail <user-id> --account <account-id> --input ./gmail-capture.json --json
exo inbound sync gmail <user-id> --account <account-id> --input ./gmail-capture.json --apply --refresh --json
```

Gmail capture shape:

```json
{
  "mode": "quick",
  "status": "success",
  "checkedAt": "2026-05-30T14:05:00.000Z",
  "threads": [
    {
      "threadId": "189f7d0c123",
      "kind": "email_reply_received",
      "observedAt": "2026-05-30T14:02:00.000Z",
      "fromName": "Alicia Buyer",
      "fromEmail": "alicia@buyer.example",
      "subject": "Re: Risk workflow question",
      "summary": "Alicia replied by email asking for a short overview of the workflow.",
      "motionId": "motion-id",
      "companyId": "company-id",
      "prospectId": "prospect-id"
    }
  ]
}
```

Gmail capture rules:

- this is still agent-supplied live truth, not a built-in Gmail retriever
- `gmail` builds the governed `sync run` payload for `gmail-inbox-threads`
- `--apply` immediately writes the payload back through the generic sync-run engine
- `--refresh` only makes sense with `--apply`, and returns fresh inbox/daily/next summaries

Enable or disable surfaces on one account:

```bash
exo inbound sync set <user-id> \
  --account <account-id> \
  --enable-surface linkedin-profile-views \
  --disable-surface linkedin-comment-replies \
  --json
```

Record the last run outcome for one surface:

```bash
exo inbound sync record <user-id> \
  --account <account-id> \
  --surface linkedin-profile-views \
  --status success \
  --observed-at 2026-05-28T13:00:00.000Z \
  --item-count 4 \
  --json
```

Write back one observed inbound event:

```bash
exo inbound observations add <user-id> \
  --account <account-id> \
  --surface linkedin-messaging-inbox \
  --kind inbound_reply_received \
  --observed-at 2026-05-28T14:00:00.000Z \
  --summary "Prospect replied in LinkedIn inbox." \
  --actor-name "Parm Uppal" \
  --actor-profile-url https://www.linkedin.com/in/example \
  --json
```

Inspect stored observations:

```bash
exo inbound observations list <user-id> --json
exo inbound observations show <observation-id> --json
```

## Design rule

This layer is for:

- truth-surface inventory
- per-account enablement
- sync-state memory
- normalized inbound observation writeback

Later work will add:

- live LinkedIn retrieval
- live Gmail retrieval
- cross-motion rationalization
- inbound inbox
- daily agenda
