# Exo

Exo is the control room for agentic GTM.

It helps one high-agency operator supervise signals, research, drafts, replies, and CRM actions across humans and agents from a single system of record.

## Docs

- [Vision One-Page](docs/vision-one-page.md)
- [CLI and MCP Contract](docs/cli-mcp-contract.md)
- [Installation](docs/installation.md)
- [CLI Guide](docs/cli-guide.md)
- [Agent Usage](docs/agent-usage.md)
- [Parallel Agent Access](docs/parallel-agent-access.md)
- [Browser Profiles](docs/browser-profiles.md)
- [Audienti Replacement Motions](docs/audienti-replacement-motions.md)
- [Spreadsheet-Derived Model](docs/spreadsheet-derived-model.md)
- [Product Thesis](docs/product-thesis.md)
- [First-Principles Design](docs/first-principles.md)
- [MVP](docs/mvp.md)
- [MVP Product Spec](docs/mvp-spec.md)
- [Experience and Output First](docs/experience-and-output-first.md)
- [UI Model](docs/ui-model.md)
- [Customer Discovery](docs/discovery.md)
- [Competitor Map](docs/competitors.md)

## Prototype

- Static wireframe prototype: `prototype/index.html`
- Open with a local file URL or serve it locally, for example:

```bash
python3 -m http.server 4173 --directory prototype
```

## Product frame

Exo is not:

- an AI SDR
- a CRM replacement
- a generic agent builder
- a sequencing tool

Exo is:

- a control room
- an operator system
- a GTM operating kernel
- a BYO-agent runtime layer
- a governed signal-to-action layer
- the place where agent work becomes trusted business action

## CLI Quick Start

Exo is now being built as a local CLI first. The current scaffold supports:

- `exo what-is-this`
- `exo motion add`
- `exo motion show`
- `exo motion list`
- `exo profiles add`
- `exo profiles list`
- `exo profiles show`
- `exo profiles test`
- `exo profiles remove`

### Prerequisites

- Node `24+`
- npm

### Install From Source

From the repo root:

```bash
npm install
npm link
exo --help
```

That `npm link` step matters. It creates a global `exo` shim so another Claude/Codex shell can invoke the same local checkout without reinstalling it.

When another agent is calling Exo, prefer `--json` so the result is machine-readable and can be passed to a downstream step without fragile parsing.

The first command an agent should usually call is:

```bash
exo what-is-this --json
```

That gives the agent the product identity, operating rules, current capabilities, browser-profile rules, current limitations, and docs entrypoints.

### Parallel Chat / Parallel Shell Usage

Run the command from this repo root:

```bash
cd /Users/williamflanagan/Projects/omalab/exo
exo motion list
```

Exo stores local state in:

```bash
/Users/williamflanagan/Projects/omalab/exo/.exo/exo.db
```

So if two Claude/Codex chats run `exo` from the same repo root, they will see the same local motion state.

If you want to make that explicit across multiple shells, set:

```bash
export EXO_STATE_DIR=/Users/williamflanagan/Projects/omalab/exo/.exo
```

Then every agent shell can point at the same Exo state store even if its working directory drifts.

### First Real Command

```bash
exo motion add \
  --url https://example.com/product \
  --geo "United States" \
  --icp "regulated-enterprise" \
  --industry "banking" \
  --title "Chief Risk Officer" \
  --title "VP Vendor Management"
```

### Browser Profiles

Browser-backed work is profile-sensitive. Exo now treats browser profiles as a first-class object because the wrong browser context means the wrong LinkedIn account, the wrong Sales Navigator entitlement, or no usable session at all.

Register a profile:

```bash
exo profiles add \
  --browser chrome \
  --label work-linkedin \
  --profile-directory "Profile 2" \
  --capability linkedin \
  --capability sales-navigator
```

Then inspect and re-test it:

```bash
exo profiles list
exo profiles test <profile-id>
```
