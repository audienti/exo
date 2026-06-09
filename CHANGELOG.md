# Changelog

All notable changes to Exo's public plugin surface land here.

## [Unreleased]

- No unreleased plugin-facing changes yet.

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
