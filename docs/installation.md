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
exo list-motions
```

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

That path is resolved from the current working directory. So if you want multiple shells or chats to operate on the same Exo state, run them from the same repo root:

```bash
cd /Users/williamflanagan/Projects/omalab/exo
exo list-motions
```

If you run `exo` from another folder, it will create and use a different `.exo` directory there.

## Example

```bash
exo define-motion \
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
exo list-motions
exo show-motion <motion-id>
```

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
