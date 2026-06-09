# Installation

Exo is currently a source-installed JavaScript CLI. The goal right now is not fancy packaging. The goal is a command that Claude, Codex, and a human shell can all call against the same local workspace state.

## Requirements

- Node `24+`
- npm

Check what you have:

```bash
node --version
npm --version
```

## Install From the Local Checkout

From the repo root:

```bash
cd <repo-root>
npm install
npm link
```

Exo applies versioned local database migrations automatically when it opens the state store. A new Exo version should upgrade `.exo/exo.db` before motion or company commands try to parse older payloads.

Verify:

```bash
exo --help
exo motion start --url https://example.com/product --premise "This offer matters when ..." --audience "Primary ICP" --signal "company::Is there recent evidence that ...?" --json
exo motion list
exo companies list
exo profiles discover --json
exo profiles list
exo profiles capabilities --json
exo profiles resolve --capability linkedin --json
exo config export --json
```

## Shared State For Multiple Agent Shells

If multiple Claude/Codex conversations should operate on the same Exo state store, pin it explicitly:

```bash
export EXO_STATE_DIR=<repo-root>/.exo
```

## Marketplace Plugin Initialization

This repo now exposes a publishable Codex plugin at the repo root:

```bash
.codex-plugin/plugin.json
skills/
```

The internal wrapper implementation still lives under:

```bash
.agents/plugins/plugins/exo
```

The plugin install contract is explicit:

- adding the plugin should only add the plugin
- initializing the plugin should install requirements if needed, inspect the real Exo onboarding state, and surface recognized runtime services
- a true fresh workspace should still ask whether this should be a `local-folder` workspace or a `global-install`

From the repo root:

```bash
npm run plugin:check -- --json
npm run plugin:init -- --json
```

Use `plugin:check` as the once-a-day health command. It runs the wrapper against the current workspace, proves the cold-start path still works on a temp workspace, and runs the plugin tests that guard version alignment and wrapper behavior.

To inspect only the current workspace through the wrapper:

```bash
npm run plugin:init -- --json
```

To apply a chosen install scope through the same wrapper:

```bash
npm run plugin:init -- --scope local-folder --apply --json
```

To prove the wrapper still supports a real cold start:

```bash
npm run plugin:verify
```

Then all shells can run Exo against the same local state even if their working directories differ.

## Why `npm link` Matters

`npm link` creates a global shell entrypoint pointing at this checkout. That means:

- a human shell can run `exo`
- a parallel Claude/Codex session can run `exo`
- you do not need to publish the package first

It is the right bridge until Homebrew packaging exists.

## Shared Local State

Exo stores workspace-local state in:

```bash
.exo/exo.db
```

That path is resolved from the current working directory unless `EXO_STATE_DIR` is set. So if you want multiple shells or chats to operate on the same Exo state, either run them from the same repo root or set `EXO_STATE_DIR` explicitly:

```bash
cd <repo-root>
exo motion list
```

If you run `exo` from another folder, it will create and use a different `.exo` directory there.

## Example

```bash
exo motion start \
  --url https://example.com/product \
  --premise "This offer matters when regulated lenders enter more complex credit-decision environments." \
  --audience "Traditional FI risk owners" \
  --signal "company::Is there recent evidence that this company expanded into a more complex lending segment?" \
  --geo "United States" \
  --icp "regulated-enterprise" \
  --industry "banking,lending" \
  --company-type "public-company" \
  --company-shape "high-compliance,multi-brand" \
  --title "Chief Risk Officer"
```

Then inspect it:

```bash
exo motion list
exo motion show <motion-id>
exo motion target <motion-id> --json
```

Add a company and link it later if needed:

```bash
exo companies add --name ExampleCo --domain example.com
exo companies find chainguard
```

## Browser Profile Setup

Because Exo will drive real browser-backed work, you should register the browser profile you expect it to use:

```bash
exo profiles discover --json
```

Then register the right one:

```bash
exo profiles add \
  --browser chrome \
  --label work-linkedin \
  --profile-directory "Profile 2" \
  --capability linkedin \
  --capability sales-navigator
```

Then claim it:

```bash
exo profiles claim <profile-id> \
  --label operator-main \
  --owner operator \
  --workspace primary \
  --account linkedin:operator-linkedin@example.com
```

Then verify it:

```bash
exo profiles list
exo profiles capabilities --json
exo profiles resolve --capability linkedin --json
exo profiles test <profile-id>
```

Exo now distinguishes between declared capabilities and verified capabilities. The verification pass is intentionally local and conservative. It verifies that Exo can resolve the browser executable, the user-data directory, the specific profile directory, the expected Chrome-style session files, and capability-specific evidence from local browser artifacts before any real browser work is attempted.

The built-in default paths are currently macOS-oriented. If you are on another environment, pass explicit `--user-data-dir` and `--browser-command` values instead of relying on defaults.

## Config Export / Import

Use config export/import when you want to move Exo setup without copying the SQLite file directly:

```bash
exo config export --out ./exo-config.json
exo config import ./exo-config.json
```

That bundle currently carries:

- motions
- companies
- browser profiles

Browser profiles are re-tested on import.

## Common Failure Mode

If a new shell says `exo: command not found`, one of three things is true:

1. `npm link` was never run from this checkout.
2. Your global npm bin directory is not on `PATH`.
3. The shell session started before `npm link` completed and needs a fresh shell.

Quick check:

```bash
which exo
npm prefix -g
```

## Uninstall

```bash
npm unlink -g @audienti/exo
```

That removes the global shim without touching the repo.
