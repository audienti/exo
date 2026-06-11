# Audienti decommission remaining plan

Status: active.
Last audited: 2026-06-11.

This is the only active WIP plan in this folder. Older cutover, review, and
feature-design files were folded into this plan or removed after the work closed.

## Current state

- Exo 0.3.0 is cut over to the normalized core.
- Onboarding is ready.
- The scheduler is installed and loaded.
- The live agent queue has 50 due tasks, 6 waiting tasks, and 0 blockers.
- The current due work is research, not browser-backed send work.
- Focused verification passed: `npm test -- test/agent-queue.test.js
  test/agent-host-pass.test.js test/inbound-reconciliation-contract.test.js
  test/profile-view-signal.test.js` passed 162/162.

## Closed work

- Normalized core cutover landed.
- Host pass lane locking landed.
- Merged agent summaries landed.
- Test isolation hardening landed.
- The visible-total invariant no longer bricks LinkedIn follower surfaces when
  live totals drop below historical itemized rows.
- The agent queue now sees normalized company research backlog by deriving work
  from company-to-motion links, not only legacy `targetMap.accounts`.
- In-pass failed-task skip landed, so one bad retrieval slice no longer burns the
  whole pass.

## Operating rules until this plan closes

- Keep scheduled send mode at `verify` or `canary` until the outbound dispatch
  gate is complete.
- Do not run a blind loop over every old WIP item. The remaining work is this
  file.
- Retrieval and research may drain. Outbound sends may not drain.
- Any live-send rollout needs passing tests plus live evidence from `exo agent
  doctor --json`, `exo agent queue --json`, and one bounded pass.

## P0: stabilize and ship the current fixes

Why this matters: the live runner can use the working tree, but the team cannot
depend on uncommitted local state as the decommission path.

Remaining work:

1. Review the current dirty tree and separate unrelated changes from the
   decommission fixes.
2. Commit the queue fix, visible-total fix, and related tests.
3. Push or otherwise hand off the exact revision the worker should run.
4. Re-run the focused suite after commit.
5. Confirm live queue still reports research backlog and no blockers.

Acceptance:

- The committed revision contains the decommission-critical fixes.
- `exo agent queue --json` shows due research work.
- `exo agent doctor --json` shows scheduler loaded and no blockers.
- Focused tests pass from a clean checkout or a clean working tree.

## P1: drain the current research backlog

Why this matters: Audienti replacement needs Exo to move companies through
research, prospect selection, prospect research, draft writing, and safe send
readiness without the operator manually driving every packet.

Remaining work:

1. Run bounded agent passes against the current queue.
2. Measure throughput per pass.
3. Verify company research packets advance or end with clear disposition.
4. Confirm exhausted research does not reappear as active work.
5. Watch for a new blocker class after company research drains into prospect
   selection.

Acceptance:

- The current 50 due research tasks decrease through real writeback.
- Completed or exhausted packets have durable state in Exo.
- The queue does not return to a false zero when work remains.
- The next bottleneck is visible in `exo agent queue --json` and the UI.

## P1: outbound dispatch gate and pacing

Why this matters: record-time safety exists, but the send handoff can still
produce a ready contract before ownership, disposition, pacing, and caps are
checked at dispatch time. That is not safe enough for live LinkedIn volume.

Remaining work:

1. Add one pre-dispatch gate used by LinkedIn send handoff and the transport
   executor.
2. Re-check cross-motion ownership immediately before physical dispatch.
3. Re-check prospect and account disposition immediately before dispatch.
4. Enforce per-account action pacing with visible `waitingReason: pacing`.
5. Add rolling hourly, daily, and weekly caps per connector account and action
   type.
6. Add randomized delays between LinkedIn outbound actions.
7. Add account warm-up ceilings for new or inactive accounts.
8. Gate cold outbound by target-local business hours.
9. Keep inbound replies exempt from send windows while still counting them
   against action budgets.

Acceptance:

- A seeded queue of 10 due connection requests dispatches over at least 3 hours.
- No rolling hour exceeds the policy cap.
- The 26th default daily connection request is deferred with a visible reason.
- A warm-up account is capped at its current ceiling.
- A Morocco-timezone prospect only sends inside the Casablanca business window.
- Dispatch timestamps show variance, not flat intervals.
- A stale cross-motion branch is blocked before physical dispatch.

## P1: retrieval and research throughput

Why this matters: after reinit or a thin state store, the worker must catch up in
hours, not days, without babysitting.

Remaining work:

1. Replace the single working-hours gate with per-capability scheduling.
2. Keep Gmail retrieval available around the clock.
3. Keep LinkedIn retrieval inside humane account-local windows.
4. Keep LinkedIn outbound inside stricter target-local windows.
5. Add drain posture for retrieval and research lanes only.
6. Keep outbound sends on the pacer even when backlog is deep.
7. Add surface fair-share so one LinkedIn surface cannot starve inboxes or
   invitations.
8. Add cross-pass backoff and visible blockers for repeat retrieval failures.

Acceptance:

- A fresh reinit with one real LinkedIn account backfills enabled surfaces within
  the same humane window, target 2 hours of active draining.
- Gmail retrieval is due regardless of operator working hours.
- LinkedIn retrieval is due inside the account-local humane window.
- LinkedIn sends remain gated by target-local send windows and pacing.
- A failing surface backs off across passes and does not hot-loop.

## P1: operator visibility

Why this matters: the operator needs to know what the worker is doing without
reading logs or inferring from stale panels.

Remaining work:

1. Add `exo agent status --watch` or an equivalent status command.
2. Add the UI equivalent panel.
3. Show lane, current task, subject, started time, and elapsed time.
4. Show per-surface captured items, pages walked, resume cursor, and last error.
5. Group backlog by waiting reason with next due time.
6. Show throughput for the last pass and last 24 hours.
7. Replace bare `partial` states with reason plus next action.

Acceptance:

- During a live drain, the operator can answer what is running, what it captured,
  what is waiting, and when it resumes from one screen.
- Waiting reasons are visible in CLI and UI.
- A partial panel always explains why it is partial.

## P2: acceptance-review follow-ups

These do not block the first research drain, but they reduce operational risk.

Remaining work:

1. Email canonical-variant linkage: Gmail dot and plus variants should link as
   `same_person_probable`, not create disconnected people.
2. Held cross-motion visibility: held branches should be visible as held behind
   the owning motion, not silently removed from operator views.
3. Slim `next` path: avoid full daily projection and duplicate `describeExo`
   work on the happy path.
4. Golden snapshots for `next --json` across daily, motion, and operator-call
   sources.
5. Stored payload scan gate proving `motions.payload_json` never stores
   `targetMap`.
6. Delete unreachable prospect-level repair paths from `rehydrate-motion.js`.
7. Decide whether cross-motion release should apply cooldown semantics now or
   stay owned by lifecycle work.

Acceptance:

- Gmail variant identity has regression coverage.
- Held branches are visible in at least one operator-facing view.
- `exo next --json` avoids the known duplicate heavy path.
- Tests fail if a stored motion payload contains `targetMap`.

## Deferred: prospect lifecycle phase B

The schema and kernel pieces are done. The behavior track is not started.

Build this after throughput and safe outbound unless packet review becomes the
next bottleneck.

Remaining work:

1. Add `packetReviewPolicy` with `auto` and `review`.
2. Let workers submit proposed outcomes.
3. Add accept, amend, and return operations for submitted packets.
4. Add disposition CLI and UI actions.
5. Add packet review to inbox, daily, and agent commands.
6. Add disposition counts, nurture shelf, timeline entries, and stale-review
   doctor warnings.

Acceptance:

- `auto` policy keeps current outputs unchanged.
- `review` policy parks packet completion without advancing queue state.
- Terminal branches never reappear in active queue scans.
- Nurture is visible but not due.
- Every disposition transition writes a permanent event.

## Deferred: WS4 research concurrency

Build this only after single-worker research drain is stable.

Remaining work:

1. Add `EXO_AGENT_RESEARCH_CONCURRENCY`, default 2.
2. Prove two research workers claim disjoint tasks.
3. Keep transport serial per connector identity.
4. Surface per-lane concurrency and lock state in doctor.

Acceptance:

- A 2-worker research pass completes with disjoint task sets.
- The merged summary is coherent.
- Transport cadence is unaffected by a long research pass.

## Final exit criteria

This plan is done when:

- Exo drains research and retrieval backlog without manual babysitting.
- The operator can see worker activity and waiting reasons live.
- LinkedIn outbound cannot rapid-fire or bypass ownership/disposition checks.
- Live send mode can move beyond verify with bounded evidence.
- Customer work no longer depends on Audienti for the covered motions.
