# Prospect Lifecycle & Packet Review Plan

- **Status:** Phase A (schema + kernel) **folded into the 0.3.0 core plan** as
  Amendment A1 / board task T16 — see
  `docs/wip/normalized-core-and-parallel-execution-plan.md`. This document owns
  **Phase B: the post-cutover behavior track** — the first feature to run after
  the normalized core lands.
- **Date:** 2026-06-10
- **Issue:** omalab/exo#12 — *Finish packet lifecycle with review, nurture, and
  terminal prospect outcomes* (p1)
- **Target release:** first 0.3.x after the 0.3.0 cutover. No schema changes beyond
  Amendment A1 — Phase B is behavior, surfaces, and reporting only.
- **Scope:** worker outcome proposals + review policy, disposition operator
  actions, review-queue surfaces, reports/doctor. No mode policy, no motion
  classes, no analytics dashboards (see Out of scope).

## Why this feature next (prioritization record)

Stack-ranking the 23 open issues against the 0.3.0 base:

| Rank | Work | Why here |
|------|------|----------|
| — | #27–#32 (incident bugs) | Bug fixes, not feature design. Most map onto in-flight workstreams: #31 is the same blob read-modify-write disease on `users` (small serialized-mutation fix now; a `user_accounts` table is a candidate follow-up); #30's recovery-first ordering lands with the T09 SQL queue scan; #29 is WS2 territory (doctor + routine artifact); #28, #32 are small standalone fixes; #27 needs verification against the fail-closed identity-guard fix (`801012b`) |
| **1** | **#12 prospect lifecycle + packet review** | The only p1 feature whose data model had to exist before the WS3 schema froze — hence Amendment A1. This doc is the rest of it |
| 2 | #2 + #13 (stage model, mode policy, motion classes) | The spine of epics #1/#25. Mostly motion-core payload (zod) + intake/reporting logic — additive after cutover. Its CRM stage vocabulary must align with (not replace) the disposition axis |
| 3 | #17 + #25 (targets, analytics, boards) | Pure readers. Cheap SQL over `activity_events`/`prospects` after normalization — and meaningless before #12, because funnels need branches that end |
| 4 | #16, #19, #20, #15, #14 (inbound execution artifacts) | New additive tables/payloads; adding tables post-0.3.0 is a normal additive migration |
| 5 | #24, #26 (operator-first alignment, ownership labels) | UX/copy alignment; #26 gets simpler once `motion_accounts.execution_user_id` exists |

## The state model (contract for both phases)

Three orthogonal axes per branch (prospect or account):

| Axis | Question | Values |
|------|----------|--------|
| `queue_status` | Where in the work pipeline? | `discovered … ready` (+ legacy `suppressed`/`exhausted`, + `held_cross_motion` on prospects) |
| `disposition` | Is this branch alive? | `active`, `nurture`, `not_a_fit`, `no_longer_target`, `exhausted` (last three terminal) |
| `cadence_status` | Is a touch due? | `pending`, `ready` (+ `cadence_next_action_due_at`) |

Plus the packet work-product axis: `packet_status` ∈ `claimed`, `submitted`
(awaiting review), `returned` (redo with notes); cleared on accept.

### Design decisions

| # | Decision | Rationale |
|---|----------|-----------|
| L1 | **Disposition is its own axis, not new queue_status members** | Stuffing nurture/not-a-fit into queue_status repeats the conflation that made suppressed/exhausted ambiguous; orthogonal axes keep every scan predicate one column |
| L2 | **Flat disposition enum; reasons/notes in payload + event, not more members** | Minimum states from #12; CHECK stays small; free-text explains, enum gates |
| L3 | **`queue_status` keeps `suppressed`/`exhausted` unchanged** (D4 view compat). Writer-enforced invariant: `not_a_fit`/`no_longer_target` ⇒ `suppressed`, `exhausted` ⇒ `exhausted`, `nurture` leaves queue_status untouched | Bounded blast radius; collapsing the duplication is post-0.3.x cleanup owned by the #25 analytics work |
| L4 | **Packet review is a packet state, not a disposition** | "Operator hasn't looked yet" must not masquerade as a branch outcome |
| L5 | **Review is policy-driven, default `auto`.** Motion-core payload gains `packetReviewPolicy` (`auto` \| `review`, optional per-kind override) | No forced friction; `auto` preserves today's behavior exactly; operators opt in per motion |
| L6 | **Workers propose, policy disposes.** Completion carries a proposed outcome (advance, nurture, or terminal + reason); `auto` applies it in-transaction, `review` parks it as the default the operator accepts, amends, or overrides | Agent autonomy where wanted, parent review where wanted, one code path |
| L7 | **Every disposition change appends an `activity_events` row** (`kind='system'`; from, to, reason, actor). Events are permanent (D6) | "Why did this branch end?" stays answerable forever |
| L8 | **Account-level disposition gates by JOIN, not cascade.** Closing an account doesn't rewrite its prospect rows; the scan's existing motion_accounts join excludes them; reactivating the account resurfaces them untouched | No fan-out writes, no lost per-prospect state, reactivation is one UPDATE |
| L9 | **Cross-motion release predicate:** ownership releases when the owning prospect's disposition leaves `active` (nurture or terminal) or its motion is archived; held assignments then follow cadence cooldown computed from `activity_events` | One queryable rule; replaces the informal outcome list |
| L10 | **Reverse invariant — disposition is always truthful.** Every path that suppresses or exhausts routes through `setProspectDisposition`/`setAccountDisposition` (legacy `suppressed` writes map to `no_longer_target` with a source note) | No row can be queue-dead but disposition-alive; the partial `prospects_due` index stays correct |

### Disposition transitions

| From | To | Who | How |
|------|----|----|-----|
| active | nurture | operator; worker proposal (L6) | explicit action or accepted proposal; optional revisit note in payload |
| active | not_a_fit / no_longer_target | operator; worker proposal | one-line reason required; L3 invariant moves queue_status to `suppressed` |
| active | exhausted | system (cadence runs out); operator | the exhausted writer routes through the same entry point (L10) |
| nurture | active | operator only | `reactivate`; re-enters at existing queue/cadence state |
| terminal | active | operator only | explicit reactivation; a new event records the full arc |

### Packet review flow

```
claim ──work──> complete(proposal)
                   │ policy=auto    ──> apply proposal atomically (today's behavior)
                   │ policy=review  ──> packet_status='submitted', queue_status unchanged
                                          │
                            operator: accept ──> apply proposal (advance or disposition)
                                      amend  ──> apply operator's outcome instead
                                      return ──> packet_status='returned'; notes in payload;
                                                 next claim's brief includes them
```

Accept/amend/return are each one transaction over packet columns +
queue_status/disposition + event append — #12's "packet completion and prospect
lifecycle stay in sync."

## Phase A — in the 0.3.0 branch (folded out of this doc)

Owned by the core plan now; recorded here only as the dependency Phase B builds on.
Board task **T16** (after T07, before T08/T09) delivers: the D9 columns
(`disposition`, `disposition_at`, `disposition_actor`, `packet_status` on
`prospects` and `motion_accounts`), partial `prospects_due` + review indexes, the
kernel entry points with the L3/L10 invariants and event append, packet
transitions, the shared workable-branch predicate, additive view fields, and the
kernel tests. T08 routes suppress/exhaust/completion writes through the entry
points; T09 gates the scans. **Phase B does not start until the 0.3.0 cutover
runbook has run.**

## Phase B — the post-cutover update (this plan's deliverable)

### FB1 — Worker proposals & review policy (kernel behavior)

1. `motionCoreSchema` gains `packetReviewPolicy`: `auto` | `review`, optional
   per-packet-kind override (`company_research` / `prospect_selection` /
   `prospect_research`). Default `auto`.
2. Packet completion APIs accept a **proposed outcome**: advance (today's
   `nextStatus` semantics), `nurture`, or terminal + reason. Under `auto`, apply
   in-transaction (observable behavior unchanged). Under `review`, park as
   `submitted` with the proposal in payload; queue_status does not advance.
3. `accept` / `amend` / `return` kernel operations per the flow above; return
   notes surface in the regenerated packet brief.
4. Worker prompt/brief updates so research and selection lanes propose nurture or
   terminal honestly instead of forcing everything to `researched`.

**Acceptance:** `auto`-policy snapshot outputs of `next`, `daily`, `agent queue`,
and the motion report are byte-identical to pre-FB1 behavior; `review`-policy
completion never advances queue_status; a returned packet's next brief carries the
return notes.

### FB2 — Disposition operator actions

1. CLI verbs (names aligned to existing command families at implementation time):
   `exo prospect disposition set|reactivate`, account-level equivalent, with
   required one-line reason for terminal dispositions.
2. Governed UI actions on motion detail / prospect detail for the same
   transitions, consistent with the compose/approve interaction pattern.
3. Reactivation re-enters at the branch's existing queue/cadence state and emits
   the arc event (L7).

**Acceptance:** a terminal branch never reappears in `exo next`, the due scan, or
the agent queue across restarts and worker passes; nurture is excluded from due
work but visible; reactivate restores eligibility; every transition has a
permanent `activity_events` row that survives motion removal.

### FB3 — Review queue in the operator loop

1. `inbox`/`daily` gain a "packets awaiting review" section when any motion has
   `review` policy — count, age, and per-packet accept/amend/return actions.
2. Operator can resolve a review straight to nurture/terminal in one step (packet
   cleared + disposition set + event, one transaction).
3. Expert command (`exo agent packets review|accept|return`) mirrors the surface.

**Acceptance:** the operator can review and resolve packets entirely from the main
loop; a review-resolved-to-terminal branch shows the packet, the decision, and the
reason in the motion timeline.

### FB4 — Reports & doctor

1. `exo report motion`: disposition counts (active / nurture / terminal by
   reason), review-pending count + oldest age, branch-ended timeline entries.
2. Nurture shelf: a motion-scoped list of nurtured branches with revisit notes —
   visible, never due.
3. Doctor warns when `submitted` packets age past a threshold (a review-mode
   motion with an absent reviewer must be loud, not silent).

**Acceptance:** one report answers "what's alive, what's parked, what ended and
why, what awaits my review"; stale-review warning fires in doctor and the host
pass summary.

### Sequencing

FB1 first (kernel behavior under both policies), then FB2 and FB3 in parallel
(both consume FB1's operations), FB4 last (reads everything). All normal additive
commits on `main` post-cutover; no schema change beyond Amendment A1; no long-lived
branch.

## Acceptance criteria (issue #12 mapping)

1. Terminal work stops polluting the active queue → FB2 acceptance + A1 scan gates.
2. Nurture visible without due-now treatment → FB2/FB4.
3. Operator reviews packet output before advancing or stopping → FB1/FB3.
4. Packet completion and prospect lifecycle stay in sync → one-transaction
   operations (A1 kernel, FB1 flows).
5. Branch termination durable, visible, explainable → L7 events + FB4 timeline.
6. Active, nurture, terminal represented cleanly → the three-axis model (A1).

## Out of scope

- Outreach mode policy, pre-connect/wait states, canonical CRM stage vocabulary
  (#2, #3) — the disposition axis is deliberately orthogonal to the future `stage`
  axis; #2's design must align with it, not replace it. **Next design after this.**
- Motion classes and inbound planning (#13, #4, #16).
- Analytics dashboards, boards, target-vs-actual (#25, #17, #5) — consumers of
  these states.
- Automatic nurture-retouch scheduling (quarterly-retouch stays a cadence concern;
  auto-reactivation can layer on later without schema change).
- Suppression-policy semantics and any global person-level do-not-contact list.
- Backfill/migration — A1 lands before the cutover wipe; dispositions start clean.

## Risks

| Risk | Mitigation |
|------|------------|
| Axis confusion (queue_status vs disposition) breeds drift | Single predicate helper used by every scan; single kernel write path; L3/L10 invariants tested; grep gate on direct column writes (all in A1) |
| Review mode stalls the pipeline when the operator is away | Default `auto`; doctor + report surface submitted-age; policy is per-motion so one inattentive motion can't hide |
| Disposition enum needs another member post-0.3.0 (CHECK rebuild) | The vocabulary covers #12's outcomes + the L9 release rule; new reasons go in payload notes. A genuinely new state is a known, costed table rebuild — not a surprise |
| Worker proposals skew terminal (over-eager not_a_fit) | Proposals carry required reasons; `review` policy exists precisely for low-trust lanes; FB4 counts make skew visible per motion |
| Legacy double-bookkeeping (L3) lingers | Tracked as post-0.3.x cleanup owned by the #25 analytics work that retires legacy view consumption |
