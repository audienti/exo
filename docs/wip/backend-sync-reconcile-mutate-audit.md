# Backend capability audit: sync, reconcile, mutate

Date: 2026-06-13
Scope: backend only. The UI should read this state after the backend contracts are trustworthy.

## Core contract

Exo needs one governed path for every service capability.

- Sync pulls the current external truth into Exo as surface state and normalized observations.
- Reconcile compares external truth with Exo intent, prospect state, cadence state, and queued work.
- Mutate performs or records an external write. Every mutation creates a reconciliation obligation until sync proves the external system agrees.

Correctness rules:

- A surface cannot claim quiet if Exo has newer row-level evidence that still needs reconciliation.
- A mutation is not done when the click or API call is attempted. It is done when Exo has recorded the result and the relevant surface can reconcile it.
- Operator cards must come from backend facts, not UI inference.
- Agent queue work must come from backend facts, not stale renderer state.
- Each capability needs one owning module for sync apply, one owning module for reconciliation, and one mutation writeback path when mutation exists.

## Status legend

- Working: the repo has a catalog entry, command path, writeback path, tests, and current state is coherent enough to trust.
- Partial: some pieces exist, but ownership, proof, pagination, or current state can still mislead Exo.
- Missing: the capability is needed but does not exist as a backend contract.
- Wrong-risk: current backend state can tell the operator or agent the wrong thing.

## Current backend snapshot

Observed on 2026-06-13 with `EXO_STATE_DIR=/Users/williamflanagan/Projects/omalab/exo/.exo`.

The living backend capability contract is now `src/lib/backend-capability-registry.js`.
This document explains the audit and backlog. The registry is the code path tests use to prevent new surfaces or mutations from skipping owner/status coverage.

- User `b9d8c947-fae3-4677-9aee-b7949a9a8bab` has 5 connected accounts and 8 enabled inbound surfaces.
- Agent host is running with 65 due tasks and 7 waiting identity-resolution tasks.
- 54 due tasks are `reconcile_connection_request_status`.
- LinkedIn sent invitations currently reports a complete zero-item sync, while the queue still has 54 connection-request reconciliation tasks. Treat this as wrong-risk until one reconciliation owner proves the state.
- LinkedIn followers is explicitly incomplete with `page_budget_stopped_early`.
- LinkedIn profile views reports 3 itemized observations against a visible total of 103.
- LinkedIn following reports 412 itemized observations against a visible total of 413.
- Preferred Gmail account `92b947ea-319f-469c-a350-372e0a15d145` has never checked `gmail-inbox-threads`.
- HubSpot account is connected, but no HubSpot sync surfaces exist yet.

## Capability matrix

| Service | Surface or capability | External truth object | Sync state | Reconcile state | Mutate state | Owner files today | Current gap | Kanban lane |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gmail | Inbox threads | Inbox threads and messages | Partial | Partial | N/A | `src/core/inbound-gmail-live-sync.js`, `src/core/inbound-gmail-sync.js`, `src/core/inbound-sync-run.js`, `src/core/inbound-identity-resolution.js` | One Gmail account syncs, the preferred Gmail account has never checked. Identity retries are waiting. | Now |
| Gmail | Search messages | Search results across mailbox | Missing | Missing | N/A | None | Needed for historical lookup and identity evidence without broad inbox polling. | Next |
| Gmail | Retrieve one thread or message | Thread/message body | Partial | Partial | N/A | `src/core/inbound-gmail-sync.js` | Retrieval exists only as part of inbox capture. No standalone governed capability. | Next |
| Gmail | Reply to email | Outbound reply in existing thread | Missing as proof surface | Partial | Partial | `src/core/record-action-result.js`, `src/lib/action-result-catalog.js` | `send_email` can record a send, but no Gmail sent-mail or thread-proof surface reconciles it. | Now |
| Gmail | Send new email | Sent message | Missing as proof surface | Partial | Partial | `src/core/record-action-result.js`, `src/lib/action-result-catalog.js` | Mutation writeback exists. External send proof is missing. | Now |
| Gmail | Sent mail and delivery proof | Sent folder or provider send result | Missing | Missing | N/A | None | Required to avoid trusting only local writeback after email mutation. | Next |
| LinkedIn | Sent invitations | Pending, accepted, withdrawn outbound invites | Wrong-risk | Partial | Partial | `src/core/inbound-linkedin-live-sync.js`, `src/core/inbound-linkedin-sync.js`, `src/core/inbound-sync-run.js`, `src/lib/linkedin-unipile-maintenance.js`, `src/core/build-agent-queue.js`, `src/core/record-action-result.js` | Current surface says complete zero, while queue has 54 reconciliation tasks. This needs one owner and a no-false-quiet invariant. | Now |
| LinkedIn | Received invitations | Pending inbound invites | Partial | Partial | Partial | `src/core/inbound-linkedin-live-sync.js`, `src/core/inbound-sync-run.js`, `src/core/transition-inbound-observation.js`, `src/core/record-action-result.js`, `src/core/build-agent-queue.js` | Sync is present and itemized, but accept/decline requested and final states should live behind one reconciliation owner. | Now |
| LinkedIn | Messaging inbox | LinkedIn message threads | Partial | Partial | Partial | `src/core/inbound-linkedin-live-sync.js`, `src/core/private-inbound-message-classification.js`, `src/core/record-action-result.js`, `src/core/build-agent-queue.js` | Sync sees 9 threads and writes 2 observations. Need explicit model for counted thread vs actionable message. | Now |
| LinkedIn | Profile views | Profile viewers | Partial | Partial | Partial | `src/core/inbound-linkedin-live-sync.js`, `src/core/inbound-sync-run.js`, `src/core/build-agent-queue.js`, `src/core/record-action-result.js` | 3 itemized rows against 103 visible total should not look equally complete to an operator. | Next |
| LinkedIn | Followers list | Followers | Partial | Partial | N/A | `src/core/inbound-linkedin-live-sync.js`, `src/core/inbound-sync-run.js`, `src/core/build-agent-queue.js` | Continuation exists, but current state is incomplete and must resume without repeated full scraping. | Now |
| LinkedIn | Following list | Accounts followed by user | Partial | Partial | Partial | `src/core/inbound-linkedin-live-sync.js`, `src/core/inbound-sync-run.js`, `src/core/record-action-result.js` | Count discrepancy is small, but follow/unfollow reconciliation needs a single owner. | Next |
| LinkedIn | Comment replies | Public comment replies | Missing for autonomous sync | Missing | Partial | `src/lib/inbound-surface-catalog.js`, `src/core/record-action-result.js` | Cataloged as browser capture and disabled. Public reply retrieval is not wired. | Later |
| LinkedIn | Catch-up updates | Public post changes and engagement opportunities | Missing for autonomous sync | Missing | Partial | `src/lib/inbound-surface-catalog.js`, `src/core/select-linkedin-public-engagement.js`, `src/core/record-action-result.js` | Public engagement mutations exist, but the truth surface is disabled. | Later |
| LinkedIn | InMail inbox | InMail inbox threads | Missing | Missing | Partial | `src/lib/action-result-catalog.js`, `src/core/record-action-result.js` | Outbound InMail can be recorded. InMail inbox and sent proof do not exist as surfaces. | Next |
| LinkedIn | Sales Navigator search | Sales Nav search results | Missing | Missing | Missing | None | Not represented as a sync, reconcile, or mutation contract. | Later |
| LinkedIn | Account entitlements | Premium, InMail, Sales Nav availability | Missing | Missing | N/A | None | We need this before exposing InMail or Sales Nav work as available. | Next |
| HubSpot | CRM contacts, companies, activity | CRM records and engagement history | Missing | Missing | Missing | None | Account exists, but no HubSpot sync surfaces are defined. | Later |

## Current ownership problem

The backend has useful pieces, but connection request truth is spread across too many places:

- `src/core/inbound-sync-run.js` owns generic sync apply and normalized observation writes.
- `src/core/inbound-linkedin-sync.js` maps LinkedIn capture into sync payloads.
- `src/lib/linkedin-unipile-maintenance.js` performs connection-request status reconciliation work.
- `src/core/build-agent-queue.js` decides when reconciliation tasks exist.
- `src/core/transition-inbound-observation.js` changes requested and final observation states.
- `src/core/record-action-result.js` records mutation outcomes.
- `src/core/user-inbound-sync.js` stores surface sync state.

That is enough code to make progress, but not enough ownership to keep us out of loops. The first backend refactor should introduce a single connection-request reconciliation owner. Other modules can call it, but they should not each decide their own version of pending, accepted, withdrawn, quiet, or stale.

## Proposed backend owners

| Concern | Proposed owner | Rule |
| --- | --- | --- |
| Surface catalog | `src/lib/inbound-surface-catalog.js` | Names what Exo can observe. It should not decide reconciliation. |
| Sync apply | `src/core/inbound-sync-run.js` | Accepts producer payloads and writes normalized observations plus surface state. |
| Gmail producer | `src/core/inbound-gmail-live-sync.js` and `src/core/inbound-gmail-sync.js` | Produces canonical sync payloads only. |
| LinkedIn producer | `src/core/inbound-linkedin-live-sync.js` and `src/core/inbound-linkedin-sync.js` | Produces canonical sync payloads only. |
| Connection-request reconciliation | New `src/core/connection-request-reconciliation.js` | The only module allowed to decide sent, pending, accepted, withdrawn, no-longer-pending, and whether a surface is quiet. |
| Mutation writeback | `src/core/record-action-result.js` | Records action results and creates reconciliation requirements. |
| Agent queue | `src/core/build-agent-queue.js` | Reads reconciliation state and schedules work. It should not implement reconciliation rules. |
| Account health | New `src/core/account-capability-health.js` | Computes checked, unchecked, stale, failed, and unsupported states from backend facts. |
| Capability registry | New `src/lib/backend-capability-registry.js` | Durable matrix for service, surface, sync owner, reconcile owner, mutate owner, status, and required tests. |

## Kanban

| Lane | Work item | Acceptance test |
| --- | --- | --- |
| Now | Add a backend capability registry for this matrix. | Test loads every cataloged inbound surface and every action result into one registry row with owners and current status. |
| Now | Consolidate connection request reconciliation behind one module. | Given sent invite sync, action result, and no-longer-pending observation inputs, only the reconciliation owner determines final state and queue tasks. |
| Now | Prevent false quiet on sent invitations. | A surface with newer unresolved connection-request observations cannot report quiet or complete without a reconciliation reason. |
| Now | Make mutation create explicit reconciliation debt. | `connection_request:sent`, `withdraw_connection:sent`, `accept_connection:accepted`, `decline_connection:declined`, and `send_email:sent` create or clear a reconciliation marker intentionally. |
| Now | Add backend account health. | Preferred Gmail never checked returns unchecked/stale from backend health, not from UI guesswork. HubSpot with no surfaces returns unsupported or unconfigured. |
| Now | Add backend agent run log model. | Existing agent host state, last pass summary, and agent log can be queried through one backend command for job history. |
| Next | Add Gmail sent-mail or provider-send proof surface. | A recorded email send can be reconciled against provider truth instead of only local writeback. |
| Next | Define counted vs actionable LinkedIn messages. | A sync with 9 counted threads and 2 actionable observations reports complete sync and partial actionable extraction separately. |
| Next | Add LinkedIn InMail inbox and sent proof. | InMail mutation is not exposed as fully supported until inbox and sent proof surfaces exist. |
| Next | Define LinkedIn account entitlements. | Exo can tell whether InMail and Sales Nav capabilities are available before planning work. |
| Later | Wire public comment replies and catch-up updates. | Disabled browser-capture surfaces become explicit autonomous or manual sync paths with reconciliation rules. |
| Later | Define Sales Navigator search contract. | Sales Nav search has a producer, sync payload, dedupe key, owner, and test data. |
| Later | Define HubSpot CRM sync surfaces. | HubSpot contacts, companies, and engagement activity have explicit sync and reconciliation owners. |

## TDD operating rule

Do not patch these areas by changing UI copy or ad hoc queue logic first.

For each row:

1. Write the failing backend test against the contract.
2. Make the smallest backend change that passes.
3. Refactor toward the owner map above.
4. Only then update the UI surface that reads the backend fact.

First red tests to write:

- Sent invitations cannot be marked quiet when unresolved connection-request reconciliation tasks exist.
- Connection request mutation records a reconciliation marker and a sync surface proves or clears it.
- Preferred Gmail with `lastRunStatus=never` is backend-unchecked even if another Gmail account has synced.
- Followers pagination resumes from cursor and does not restart broad scraping unless the cursor expires.
- Message sync separates counted threads from actionable observations.

## Where we are

Exo is not blank. It has a real inbound catalog, action-result catalog, generic sync-run engine, normalized observations, mutation writeback, and an agent queue.

The unstable part is ownership. Connection requests, account health, and mutation reconciliation are spread across generic sync, queue construction, action result writeback, and LinkedIn maintenance. That is why the system can look active and still feel like it is not doing anything reliable.

The first backend stabilization slice should be connection-request reconciliation, because it is the largest live backlog and it is the clearest example of sync, reconcile, and mutate disagreeing.
