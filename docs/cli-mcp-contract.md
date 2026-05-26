# CLI and MCP Contract

## Position

Exo should be headless first.

The first real Exo product is not a browser app.
It is:

- `exo` as a CLI for operators
- `exo` as an MCP server for Claude, Codex, and similar harnesses

Those are not two different products.
They are two projections of the same operating kernel.

## Hard rule

The CLI and MCP surfaces must feel like the same product.

That means:

- the same nouns
- the same verbs
- the same output objects
- the same workflow semantics
- the same state transitions

The shell can differ.
The product contract cannot.

## What changes between CLI and MCP

Only presentation changes.

### CLI

- human-readable terminal output
- optional `--json`
- fast operator usage
- scripting and cron-friendly

### MCP

- structured tool input/output
- agent-readable schemas
- same artifacts returned as JSON plus renderable text
- safe for Claude/Codex tool invocation

## What does not change

These must be identical across both surfaces:

- account identity
- signal identity
- proposal identity
- prediction object
- outcome object
- reconciliation event
- approval semantics
- CRM commit semantics

If an action behaves differently in CLI vs MCP, the product is drifting.

## Product nouns

The MVP nouns should be:

- `offer`
- `targeting-profile`
- `suppression-policy`
- `signal-set`
- `target-map`
- `motion-plan`
- `account`
- `contact`
- `signal`
- `brief`
- `proposal`
- `prediction`
- `outcome`
- `reconciliation`
- `crm-commit`
- `meeting-pack`

These are the real Exo objects.
Everything else is implementation detail.

## Product verbs

The MVP verbs should be:

- `define-motion`
- `refresh-motion`
- `inbox`
- `brief`
- `propose`
- `approve`
- `reject`
- `record-outcome`
- `reconcile`
- `history`
- `prep-meeting`
- `commit-crm`

These are not just commands.
They are the GTM motions Exo exists to own.

## One-to-one mapping

Every public CLI command should have a matching MCP tool.

Examples:

- `exo define-motion --url <product-url> --geo ... --icp ... --industry ... --company-shape ... --titles ... --segment ... --exclude-account ... --exclude-domain ... --dnc-file ...` <-> `exo.define_motion`
- `exo refresh-motion <motion>` <-> `exo.refresh_motion`
- `exo inbox` <-> `exo.inbox`
- `exo brief <account>` <-> `exo.brief`
- `exo propose <account>` <-> `exo.propose`
- `exo approve <proposal>` <-> `exo.approve`
- `exo record-outcome <proposal>` <-> `exo.record_outcome`
- `exo reconcile <account>` <-> `exo.reconcile`
- `exo prep-meeting <account>` <-> `exo.prep_meeting`
- `exo commit-crm <object>` <-> `exo.commit_crm`

The input format can differ.
The business meaning must not.

## Output contract

Each command or tool should return:

1. a structured object
2. a short summary
3. a renderable artifact when useful

Examples:

- `define-motion` returns an offer-driven motion plan with ICP profile, geolocation filters, company-type and company-shape filters, suppression policy, custom signals, grouped accounts, target people, segment variants, and recommended action logic
- `inbox` returns a ranked list of accounts needing attention
- `brief` returns an account brief artifact
- `propose` returns a next-action proposal with prediction
- `reconcile` returns drift findings and repair actions
- `prep-meeting` returns a meeting prep pack

The CLI should render these directly.
The MCP surface should hand them to Claude/Codex as structured results.

## What Exo should not expose

Do not expose horizontal tool actions as Exo product actions.

Avoid making Exo tools like:

- `search_web`
- `browse_linkedin`
- `open_browser`
- `call_llm`
- `send_keystrokes`

Those belong to the harness.

Exo should expose only GTM-native actions and objects.

## Delivery model

The intended runtime is:

- customer pays for Claude/Codex/Gemini
- customer pays for tokens
- customer owns the harness/runtime
- customer owns the retrieval surfaces such as Sales Navigator and browser sessions
- Exo provides GTM state, actions, and outputs

So Exo must be useful even when the model provider changes.

If Exo only works with one provider's UI or one provider's memory model, it is too thin.

The same rule applies to data retrieval:

- Exo should define what data is needed
- Claude/Codex should use the customer's existing retrieval surfaces to gather it
- Exo should store the resulting structured objects and evidence

That keeps Exo out of the expensive proprietary-data business.

## MVP success test

The contract is good if all of the following are true:

- William can define a new offer-driven motion from a product URL using `exo`
- William can constrain that motion by geolocation, ICP type, industry, company type, company shape, company size, segment, stakeholder title, and explicit suppression rules
- William can drive the motion directly from `exo`
- Claude can drive the same motion through MCP
- both paths produce the same account truth
- both paths preserve the same proposal/prediction/outcome history
- Exo can replace real Audienti motions without requiring a browser-first app shell
