# Changelog

All notable changes to Exo's public plugin surface land here.

## [Unreleased]

- No unreleased plugin-facing changes yet.

## [0.2.3] - 2026-06-10

- Fixed every live runtime call — Gmail and LinkedIn live sync, Gmail thread disposal, harness-connection probes, and the LLM repair generator — leaving the spawned `claude`/`codex` CLI's stdin open. Both CLIs read stdin when it is a pipe, and codex blocked on that read until its timeout, adding latency to or hanging capture, disposal, and probe passes. The prompt always travels as an argument, so stdin is now closed immediately after the process is spawned.

## [0.2.2] - 2026-06-10

- Contract self-repair now documents every fix it makes: each generated repair appends an agent-authored repair note (shared tool repair-note shape) to `.exo/repair-notes.jsonl` with evidence references to the override and submission records; replays never duplicate notes, and notes are never garbage-collected.
- Added the LLM-backed repair generator: when a contract fails and no stored repair matches, exo asks the local `claude` CLI (falling back to `codex` on any claude failure, including an expired login) to propose a corrected contract, which is revalidated before it is ever used. Generator choice is controlled by `EXO_REPAIR_GENERATOR` (`claude`, `codex`, `off`), and `EXO_REPAIR_GENERATOR_TIMEOUT_MS` overrides the 180s timeout.
- Hardened repairs to drop/reorder/bookkeeping-only: a repaired agent queue can never promote waiting work into the runnable lane, daily/inbox repairs may only drop or reorder byte-identical items, and next-view repairs must preserve operator guidance that was already valid.
- The repair runtimes run with tool use disabled at the CLI level (claude: no built-in tools, no MCP servers; codex: read-only sandbox in an empty temp dir), so a prompt-injected string inside a failed contract has nothing to reach.

## [0.2.1] - 2026-06-09

- Fixed the last two LinkedIn surfaces (received invitations and messaging inbox) dropping their pagination bounds and resume cursors during full-mode backfills, completing the bounded-slice fix across all six surfaces.
- Added contract self-repair V1: an opt-in (`EXO_REPAIR_ENABLED=1`), fail-closed layer that can apply a temporary, version-bounded local repair when a read/planner/queue contract (`next`, `daily`, `inbox`, `agent queue`) fails validation, so a broken build no longer dead-ends the operator. Inert by default; `EXO_DISABLE_REPAIR=1` is a hard kill switch.
- Repair submissions hash-redact every string value before they are spooled, and pushing them upstream additionally requires `EXO_REPAIR_SUBMIT_UPSTREAM=1` plus a configured endpoint — nothing leaves the machine otherwise.

## [0.2.0] - 2026-06-09

- Split background agent work into lanes with per-lane run locks so quick inbound sync and motion work are never starved by long backfills; transport and research lanes now run concurrently.
- Bounded every full-mode LinkedIn backfill into resumable slices, and fixed the profile-views and sent-invitations surfaces dropping their pagination bounds and resume cursors — the root cause of the infinite `ETIMEDOUT` inbound sync retry loop on field machines.
- Plumbed `nextCursor`/`nextStartOffset` through the canonical invitation surface schema and adapter so sent/received invitation backfills persist forward progress between agent passes.
- Fixed the verify-mode operator-send gate deadlock that stalled outbound motion work.
- Background agent scheduler repair: renamed/foreign exo launchd agents are detected and reported truthfully in the operator header, `exo agent install-routine` converges them, and `exo agent doctor` explains macOS TCC (exit 126/78) blocks.
- Moved the launchd entry point outside macOS TCC-protected folders so background passes survive Documents/Desktop privacy prompts.
- Added `npm run plugin:check`, a daily plugin health command covering the wrapper, fresh-init path, and version-alignment tests.

## [0.1.1] - 2026-06-09

- Aligned the CLI, plugin manifest, and export surfaces to one shared package version source.
- Added a version-alignment regression test so future plugin release bumps stay synchronized.

## [0.1.0] - 2026-06-09

- Added the repo-root Codex plugin manifest and marketplace-facing wrapper.
- Preserved the real Exo onboarding flow through `plugin:init` and `plugin:verify`.
