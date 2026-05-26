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
cd /Users/williamflanagan/Projects/omalab/exo
npm install
npm link
```

Verify:

```bash
exo --help
exo motion list
exo profiles list
```

## Shared State For Multiple Agent Shells

If multiple Claude/Codex conversations should operate on the same Exo state store, pin it explicitly:

```bash
export EXO_STATE_DIR=/Users/williamflanagan/Projects/omalab/exo/.exo
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
cd /Users/williamflanagan/Projects/omalab/exo
exo motion list
```

If you run `exo` from another folder, it will create and use a different `.exo` directory there.

## Example

```bash
exo motion add \
  --url https://example.com/product \
  --geo "United States" \
  --icp "regulated-enterprise" \
  --industry "banking,lending" \
  --company-type "public-company" \
  --company-shape "high-compliance,multi-brand" \
  --company-size "enterprise" \
  --title "Chief Risk Officer" \
  --title "VP Vendor Management" \
  --segment "traditional-fi"
```

Then inspect it:

```bash
exo motion list
exo motion show <motion-id>
```

## Browser Profile Setup

Because Exo will drive real browser-backed work, you should register the browser profile you expect it to use:

```bash
exo profiles add \
  --browser chrome \
  --label work-linkedin \
  --profile-directory "Profile 2" \
  --capability linkedin \
  --capability sales-navigator
```

Then verify it:

```bash
exo profiles list
exo profiles test <profile-id>
```

That check is intentionally local and conservative. It verifies that Exo can resolve the browser executable, the user-data directory, the specific profile directory, and the expected Chrome-style session files before any real browser work is attempted.

The built-in default paths are currently macOS-oriented. If you are on another environment, pass explicit `--user-data-dir` and `--browser-command` values instead of relying on defaults.

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
npm unlink -g @omalab/exo
```

That removes the global shim without touching the repo.
