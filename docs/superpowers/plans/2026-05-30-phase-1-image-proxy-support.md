# Phase 1 Image Proxy Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add canonical company and prospect media fields to Exo, proxy raw image URLs through BizBridge on write, and expose stored media through report/workspace surfaces.

**Architecture:** Introduce one shared image-proxy helper in `src/lib`, store both raw source URLs and proxied URLs on canonical company/prospect records, and thread those stored fields through motion/account/report view models. Keep render layers dumb: they consume stored media instead of inventing or re-proxying state.

**Tech Stack:** Node.js, Commander CLI, Zod schemas, static HTML report builder, node:test

---

### Task 1: Add a failing end-to-end CLI test for canonical media storage and report exposure

**Files:**
- Modify: `test/cli.test.js`

- [ ] **Step 1: Write the failing test**

Add a test that:
- creates a motion
- adds a company with a raw logo image URL
- updates the same company with a replacement raw logo image URL
- adds a prospect with a raw avatar image URL
- updates the same prospect with a replacement raw avatar image URL
- asserts stored company/prospect JSON includes both raw source and proxied BizBridge URLs
- asserts `exo report motion <motion-id> --json` exposes the stored media fields

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cli.test.js --test-name-pattern "proxy company logos and prospect avatars"`
Expected: FAIL because the CLI does not yet accept or persist the new media fields.

### Task 2: Add canonical schema fields and shared BizBridge proxy helper

**Files:**
- Create: `src/lib/image-proxy.js`
- Modify: `src/schema/company.js`
- Modify: `src/schema/target-account.js`

- [ ] **Step 1: Add helper API**

Create helper functions for:
- normalizing raw source URLs
- detecting already-proxied BizBridge URLs
- unwrapping known legacy proxy prefixes when needed
- generating proxied BizBridge URLs
- returning `{ sourceUrl, proxiedUrl }` for callers

- [ ] **Step 2: Add schema fields**

Add:
- company: `logoSourceUrl`, `logoUrl`
- prospect: `avatarSourceUrl`, `avatarUrl`
- target account mirror fields: `companyLogoSourceUrl`, `companyLogoUrl`

Use nullable defaults so legacy payloads still parse.

- [ ] **Step 3: Run the targeted test**

Run: `node --test test/cli.test.js --test-name-pattern "proxy company logos and prospect avatars"`
Expected: still FAIL, but now because write paths and CLI options are not wired yet.

### Task 3: Wire proxy-on-write through canonical company and prospect writers

**Files:**
- Modify: `src/core/add-company.js`
- Modify: `src/core/update-company.js`
- Modify: `src/core/record-prospect.js`
- Modify: `src/core/target-account-state.js`
- Modify: `src/core/record-signal-match.js`
- Modify: `src/core/record-prospect-touch.js`
- Modify: `src/core/set-target-account-queue.js`
- Modify: `src/core/set-prospect-through-line.js`
- Modify: `src/core/set-prospect-opening-plan.js`
- Modify: `src/core/set-prospect-cadence.js`
- Modify: `src/core/claim-motion-prospect-packet.js`
- Modify: `src/core/complete-motion-prospect-packet.js`
- Modify: `src/core/claim-target-account-packet.js`
- Modify: `src/core/complete-target-account-packet.js`

- [ ] **Step 1: Company write path**

On company create/update:
- accept raw logo source URL input
- store `logoSourceUrl`
- store proxied `logoUrl`

- [ ] **Step 2: Prospect write path**

On prospect add/update:
- accept raw avatar source URL input
- store `avatarSourceUrl`
- store proxied `avatarUrl`

- [ ] **Step 3: Keep motion-owned account mirrors in sync**

Whenever target-account state is built or rewritten from a company:
- mirror `companyLogoSourceUrl`
- mirror `companyLogoUrl`

- [ ] **Step 4: Run the targeted test**

Run: `node --test test/cli.test.js --test-name-pattern "proxy company logos and prospect avatars"`
Expected: still FAIL, but now because CLI surfaces and report exposure are incomplete.

### Task 4: Expose new media fields through CLI and motion seed paths

**Files:**
- Modify: `src/cli/commands/companies.js`
- Modify: `src/cli/commands/motion.js`

- [ ] **Step 1: Company CLI options**

Add `--logo-source-url <url>` to:
- `exo companies add`
- `exo companies update`
- `exo motion discover`
- `exo motion seed`

- [ ] **Step 2: Prospect CLI options**

Add `--avatar-source-url <url>` to:
- `exo companies prospects add`
- `exo companies prospects update`
- person-first `exo motion seed`

- [ ] **Step 3: Run the targeted test**

Run: `node --test test/cli.test.js --test-name-pattern "proxy company logos and prospect avatars"`
Expected: PASS.

### Task 5: Add a failing motion-seed regression test

**Files:**
- Modify: `test/cli.test.js`

- [ ] **Step 1: Write the failing test**

Add a test that seeds:
- a company-first motion target with `--logo-source-url`
- a person-first motion seed with `--avatar-source-url`

Assert canonical company + motion-owned prospect state store proxied media fields.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cli.test.js --test-name-pattern "motion seed proxies company and prospect images"`
Expected: FAIL because seed option plumbing is not complete for the new fields.

### Task 6: Expose stored media through motion reports and workspace projection

**Files:**
- Modify: `src/core/evaluate-motion-targeting.js`
- Modify: `src/core/build-motion-prospect-view.js`
- Modify: `src/cli/commands/report.js`
- Modify: `prototype/build-motion-workspace.mjs`

- [ ] **Step 1: Motion report view-model**

Expose:
- company logo fields in company loop / writing brief
- prospect avatar fields in prospect view / writing brief

- [ ] **Step 2: Workspace projection**

Consume stored report media fields in the workspace model so cards render stored media or fall back cleanly.

- [ ] **Step 3: Run the new seed test**

Run: `node --test test/cli.test.js --test-name-pattern "motion seed proxies company and prospect images"`
Expected: PASS.

### Task 7: Verify the report and workspace surfaces with targeted live commands

**Files:**
- Modify: `prototype/motion-workspace.html` (generated)

- [ ] **Step 1: Run targeted unit/CLI verification**

Run:
- `node --test test/cli.test.js --test-name-pattern "proxy company logos and prospect avatars|motion seed proxies company and prospect images"`
- `node ./src/cli/index.js report workspace --user 00d08a04-c0b5-457c-8cb0-205c81593224 --json`
- `node ./src/cli/index.js report workspace --user 00d08a04-c0b5-457c-8cb0-205c81593224 --out ./prototype/motion-workspace.html`

Expected:
- targeted tests pass
- workspace report writes successfully
- JSON includes media fields where present

- [ ] **Step 2: Regenerate the prototype artifact**

Run: `node ./prototype/build-motion-workspace.mjs`
Expected: `prototype/motion-workspace.html` regenerates successfully.
