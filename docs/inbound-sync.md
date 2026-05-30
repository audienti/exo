# Inbound Sync

Exo treats inbound observation as a governed truth layer, not as a browser trick.

The first slice does three things:

- defines the canonical inbound surfaces Exo cares about
- stores which of those surfaces are enabled on each connected user account
- stores the last known sync result for each enabled surface
- stores normalized inbound observations that an agent can write back after inspecting a live surface
- runs the first live retrieval slice for Gmail through supported `runtime:gmail` harness-backed accounts
- runs the first live retrieval slice for LinkedIn quick-mode surfaces through a trusted Chrome profile plus a supported `runtime:chrome` harness

The next management layer is `exo inbound review`, which combines that sync state with the concrete observations so the operator can see what actually needs a decision.

It still does **not** do broad live retrieval by itself.
Right now the built-in live producers are Gmail through supported runtime-backed Gmail harness connections and LinkedIn quick-mode surfaces through a trusted Chrome profile plus a supported runtime-backed Chrome harness.

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
exo users harness probe <user-id> --runtime codex --connector gmail --json
exo users harness probe <user-id> --runtime codex --connector chrome --json
exo inbound sync plan <user-id> --mode quick --json
exo inbound sync gmail-live <user-id> --account <account-id> --apply --refresh --json
exo inbound sync linkedin-live <user-id> --account <account-id> --runtime codex --apply --refresh --json
exo inbound sync linkedin <user-id> --account <account-id> --input ./linkedin-capture.json --apply --refresh --json
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
- when a stored prospect has an exact matching email or LinkedIn profile URL, Exo auto-links the observation to that prospect, its company, and its motion during writeback
- ambiguous matches stay unlinked; explicit ids still win, but Exo rejects explicit ids that conflict with the resolved prospect context
- `--refresh` returns a fresh inbox/daily/next summary after the writeback lands

First live producer slice: Gmail through supported runtimes

```bash
exo inbound sync gmail-live <user-id> --account <account-id> --json
exo inbound sync gmail-live <user-id> --account <account-id> --limit 10 --since 2026-05-30T00:00:00.000Z --apply --refresh --json
```

Gmail live rules:

- this only works when the Gmail account resolves through a supported `runtime:gmail` harness connection such as `codex:gmail` or `claude:gmail`
- Exo probes the resolved runtime first and refuses to fake a live retrieval when the Gmail connector is unavailable
- connector failure becomes governed sync failure data for `gmail-inbox-threads`, not an unstructured crash
- `--limit` controls how many recent inbox threads the resolved runtime should inspect
- `--since` narrows the returned threads by newest relevant message time
- `--apply` immediately writes the payload back through the generic sync-run engine
- `--refresh` only makes sense with `--apply`, and returns fresh inbox/daily/next summaries

First manual producer slice: Gmail capture

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

- this is still agent-supplied live truth, not the built-in live Gmail path
- `gmail` builds the governed `sync run` payload for `gmail-inbox-threads`
- `fromEmail` is enough for auto-linking when the prospect already has that exact email stored in Exo
- use `exo users harness probe <user-id> --runtime <runtime> --connector gmail --json` before the run to confirm the Gmail connector is actually enabled in the current runtime
- `--apply` immediately writes the payload back through the generic sync-run engine
- `--refresh` only makes sense with `--apply`, and returns fresh inbox/daily/next summaries

First browser-backed producer slice: LinkedIn quick capture

```bash
exo inbound sync linkedin <user-id> --account <account-id> --input ./linkedin-capture.json --json
exo inbound sync linkedin <user-id> --account <account-id> --input ./linkedin-capture.json --apply --refresh --json
```

LinkedIn quick capture shape:

```json
{
  "mode": "quick",
  "sentInvitations": {
    "status": "success",
    "checkedAt": "2026-05-30T14:10:00.000Z",
    "items": []
  },
  "receivedInvitations": {
    "status": "success",
    "checkedAt": "2026-05-30T14:12:00.000Z",
    "items": [
      {
        "invitationId": "invite-123",
        "kind": "connection_request_received",
        "observedAt": "2026-05-30T14:11:00.000Z",
        "actorName": "Alicia Buyer",
        "summary": "Alicia Buyer sent us a new inbound connection request."
      }
    ]
  },
  "messagingInbox": {
    "status": "success",
    "checkedAt": "2026-05-30T14:14:00.000Z",
    "items": []
  },
  "profileViews": {
    "status": "success",
    "checkedAt": "2026-05-30T14:15:00.000Z",
    "items": []
  },
  "followingList": {
    "status": "success",
    "checkedAt": "2026-05-30T14:16:00.000Z",
    "items": []
  }
}
```

LinkedIn quick capture rules:

- this is the agent-facing quick-mode producer for the five authoritative LinkedIn surfaces
- for now it supports `quick` mode only
- each section maps to one canonical Exo inbound surface under the hood
- `actorProfileUrl` is enough for auto-linking when the prospect already has that exact LinkedIn profile stored in Exo
- use `warning` when you saw real items but did not fully itemize them
- use `failed` only when the surface could not actually be checked

First live producer slice: LinkedIn quick-mode through supported runtimes

```bash
exo inbound sync linkedin-live <user-id> --account <account-id> --runtime codex --json
exo inbound sync linkedin-live <user-id> --account <account-id> --runtime claude --limit 10 --apply --refresh --json
```

LinkedIn live rules:

- this only works when the LinkedIn account resolves through a browser-profile-backed account with a trusted Chrome profile and the user also has a supported `runtime:chrome` harness connection such as `codex:chrome` or `claude:chrome`
- Exo probes the selected runtime first and refuses to fake a live retrieval when that Chrome harness is unavailable
- runtime failure becomes governed sync failure data across the five quick LinkedIn surfaces, not an unstructured crash
- `--runtime` is required whenever more than one supported Chrome harness exists for the user
- `--limit` controls how many relevant items per surface the resolved runtime should inspect
- the live path checks only the five authoritative quick surfaces: sent invitations, received invitations, messaging inbox, profile views, and following list
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

Manual observation rule:

- `exo inbound observations add` uses the same exact-match auto-linking as `sync run`, so actor email and actor LinkedIn profile URL should be supplied whenever they are known

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
