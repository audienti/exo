# Inbound Cues And Working Hours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add working-hours-aware inbound sync judgment plus a lightweight ambient cue layer so Exo can capture "I saw something worth checking" during other actions without pretending that cue is canonical truth.

**Architecture:** Store working hours on the execution user because the user owns the operating rhythm across accounts. Store ambient inbound cues in a dedicated table so cues remain distinct from authoritative observations. Feed both into planner surfaces and action briefs: cues create governed sync suspicion, working hours decide whether that suspicion is due now or at the next open window.

**Tech Stack:** Node.js CLI, Zod schemas, SQLite via `node:sqlite`, Commander, existing Exo planner/inbound/action-brief surfaces, Node test runner.

---

### Task 1: Add working-hours policy to execution users

**Files:**
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/schema/user.js`
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/cli/commands/users.js`
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/artifacts/render-user.js`
- Test: `/Users/williamflanagan/Projects/omalab/exo/test/cli.test.js`

- [ ] **Step 1: Write failing tests for `users working-hours show|set`**
- [ ] **Step 2: Run the focused CLI test block and verify the new expectations fail**
- [ ] **Step 3: Add a user-level working-hours schema with timezone, weekdays, and local start/end times**
- [ ] **Step 4: Add `exo users working-hours show` and `exo users working-hours set` plus user rendering support**
- [ ] **Step 5: Re-run the focused tests and verify they pass**

### Task 2: Add ambient inbound cue persistence and CLI

**Files:**
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/schema/inbound.js`
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/db/migrations.js`
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/db/database.js`
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/cli/commands/inbound.js`
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/artifacts/render-inbound.js`
- Create: `/Users/williamflanagan/Projects/omalab/exo/src/core/inbound-cues.js`
- Test: `/Users/williamflanagan/Projects/omalab/exo/test/cli.test.js`

- [ ] **Step 1: Write failing tests for `exo inbound cues add|list|resolve`**
- [ ] **Step 2: Run the focused tests and verify cue commands do not exist yet**
- [ ] **Step 3: Add inbound cue schemas and the new SQLite table with indexes**
- [ ] **Step 4: Add database helpers plus core logic for cue creation, listing, and resolution**
- [ ] **Step 5: Wire the CLI and text renderers, then re-run the focused tests**

### Task 3: Make planner sync judgment working-hours-aware and cue-aware

**Files:**
- Create: `/Users/williamflanagan/Projects/omalab/exo/src/core/working-hours.js`
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/core/build-daily-view.js`
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/core/build-next-view.js`
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/core/inbound-sync-run.js`
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/core/user-inbound-sync.js`
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/db/database.js`
- Test: `/Users/williamflanagan/Projects/omalab/exo/test/cli.test.js`

- [ ] **Step 1: Write failing tests for after-hours sync behavior and cue-driven sync prioritization**
- [ ] **Step 2: Run the focused tests and verify the planner still treats all stale truth the old way**
- [ ] **Step 3: Add working-hours helpers that classify `open_now` versus `next_open_at`**
- [ ] **Step 4: Update daily/next sync planner items so fresh cues can force sync pressure, while after-hours pressure becomes queued for the next working window**
- [ ] **Step 5: Resolve matching open cues when a governed sync run lands, then re-run the focused tests**

### Task 4: Add ambient cue hooks to action briefs and optional auto-sync trigger

**Files:**
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/core/build-motion-action-view.js`
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/artifacts/render-motion.js`
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/cli/commands/inbound.js`
- Modify: `/Users/williamflanagan/Projects/omalab/exo/src/core/what-is-this.js`
- Modify: `/Users/williamflanagan/Projects/omalab/exo/docs/inbound-sync.md`
- Modify: `/Users/williamflanagan/Projects/omalab/exo/docs/agent-usage.md`
- Test: `/Users/williamflanagan/Projects/omalab/exo/test/cli.test.js`

- [ ] **Step 1: Write failing tests asserting action briefs include the cue-capture writeback path**
- [ ] **Step 2: Run the focused tests and verify action briefs do not yet mention ambient cue capture**
- [ ] **Step 3: Add brief steps for LinkedIn and Gmail actions to capture ambient cues during execution**
- [ ] **Step 4: Add an optional cue-driven auto-sync path on cue creation when the account is live-supported and the user is inside working hours**
- [ ] **Step 5: Update docs/help surfaces and re-run the focused tests**

### Task 5: Full verification and dirty-worktree review

**Files:**
- Verify only: `/Users/williamflanagan/Projects/omalab/exo`

- [ ] **Step 1: Run `node --test /Users/williamflanagan/Projects/omalab/exo/test/cli.test.js`**
- [ ] **Step 2: Read the full output and confirm the exact pass count**
- [ ] **Step 3: Review `git diff` carefully to ensure the new work does not trample the pre-existing `report workspace` changes**
- [ ] **Step 4: Summarize exact implemented behavior, verification evidence, and any remaining edge gaps**
