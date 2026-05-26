# Exo

Exo is the control room for agentic GTM.

It helps one high-agency operator supervise signals, research, drafts, replies, and CRM actions across humans and agents from a single system of record.

## Docs

- [Vision One-Page](docs/vision-one-page.md)
- [CLI and MCP Contract](docs/cli-mcp-contract.md)
- [Installation](docs/installation.md)
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

- `exo define-motion`
- `exo show-motion`
- `exo list-motions`

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

### Parallel Chat / Parallel Shell Usage

Run the command from this repo root:

```bash
cd /Users/williamflanagan/Projects/omalab/exo
exo list-motions
```

Exo stores local state in:

```bash
/Users/williamflanagan/Projects/omalab/exo/.exo/exo.db
```

So if two Claude/Codex chats run `exo` from the same repo root, they will see the same local motion state.

### First Real Command

```bash
exo define-motion \
  --url https://example.com/product \
  --geo "United States" \
  --icp "regulated-enterprise" \
  --industry "banking" \
  --title "Chief Risk Officer" \
  --title "VP Vendor Management"
```
