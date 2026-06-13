# Backend Sync, Reconcile, Mutate Seam Rollout

## Objective

Move Exo from a partial backend audit to explicit, tested seam owners for the remaining sync, reconcile, and mutate surfaces. The goal is a backend that can say what it knows, what it has only requested, what still needs proof, and which owner is responsible for each decision.

## Current Baseline

The prior board established:

- A backend capability registry covering inbound surfaces and mutation actions.
- A single owner for connection-request reconciliation.
- Mutation reconciliation debt for the highest-risk connection-request actions and email sends.
- Account capability health for checked, unchecked, stale, failed, unsupported, disabled, and unconfigured states.
- A backend agent run-log query.

This board starts from that work and expands the remaining seams without changing the UI first.

## Scope

- Backend only.
- Extend the capability registry into a seam matrix with proof surfaces, state keys, sync strategy, reconciliation strategy, mutation debt policy, and current status for each stage.
- Add a shared seam contract and test harness that every service-specific owner can implement.
- Add isolated seam owner modules for Gmail, LinkedIn private messaging and InMail, LinkedIn social graph and profile views, LinkedIn public engagement, and HubSpot capability support.
- Integrate those owners into shared mutation writeback, sync review, and agent queue paths only after the isolated contracts are green.

## Non-Goals

- No frontend work in this board.
- No live external sends, withdrawals, accepts, declines, replies, or deploys.
- No broad LinkedIn scraping or repeated full-surface polling.
- No claim that Sales Navigator, InMail proof, public engagement retrieval, or HubSpot sync is fully live unless a backend proof path exists.

## Architecture Contract

Every capability seam is treated as three separate stages:

- Sync: Exo pulls truth down from a connector, capture surface, or future service integration and records itemized facts or an explicit itemization gap.
- Reconcile: Exo compares truth facts against local intentions, touches, drafts, observations, and queued work to decide whether state is quiet, pending proof, contradicted, stale, or reconciled.
- Mutate: Exo records a requested or completed external action and emits reconciliation debt until the relevant proof surface confirms or clears it.

Single-owner rule:

- Each seam has one backend reconciliation owner module.
- Shared files may call owners, but must not re-implement service-specific state decisions.
- Mutation writeback creates or clears reconciliation debt through owner modules rather than ad hoc payload shape checks.

## Parallelization Model

Two controller tasks define the interfaces. After those are green, five service lanes can run in parallel because they own separate files:

- Gmail email send and thread reconciliation.
- LinkedIn private messaging and InMail reconciliation.
- LinkedIn follower, following, and profile-view reconciliation.
- LinkedIn public engagement reconciliation.
- HubSpot capability support.

Controller-owned integration tasks follow the parallel lanes because they touch shared files such as `record-action-result`, `inbound-sync-run`, `user-inbound-sync`, and `build-agent-queue`.

## Acceptance Criteria

- Registry tests fail if any row lacks stage status, owner, proof surface, state key, sync strategy, reconciliation strategy, or mutation debt policy.
- Each remaining seam has a pure backend owner with tests for quiet, pending proof, contradicted, stale, and unsupported states where applicable.
- Mutation writeback uses seam owners for reconciliation debt rather than embedding service-specific decisions in shared writeback code.
- Agent queue and sync review read seam status from backend owners where integration exists.
- The board stays green after each completed task and finishes with `npm test` and `git diff --check`.

## Verification Commands

```bash
npm test
git diff --check
python3 /Users/williamflanagan/.codex/plugins/cache/audienti/plan-loop-executor/0.4.0/skills/plan-loop-executor/scripts/validate_board.py docs/plans/remaining-sync-reconcile-mutate-seams-board.json
python3 /Users/williamflanagan/.codex/plugins/cache/audienti/plan-loop-executor/0.4.0/skills/plan-loop-executor/scripts/render_board.py docs/plans/remaining-sync-reconcile-mutate-seams-board.json
```

## Safety Boundaries

Tests must use fixtures or local temporary state only. This board may define live proof contracts, but it must not perform live external mutations.
