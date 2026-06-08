# Exo

Exo is the control room for agentic GTM.

It helps one high-agency operator supervise signals, research, drafts, replies, and CRM actions across humans and agents from a single system of record.

Agents should treat Exo that way in practice: if a research finding, signal match, website, stakeholder, or profile assignment is durable and Exo has a place to store it, write it back instead of leaving it only in prose or browser state.

## License

See [LICENSE](/Users/williamflanagan/Projects/omalab/exo/LICENSE). User and third-party content remain owned by their respective owners. Exo code, documentation, GTM methods, operating workflows, product strategy, and business materials are Copyright (c) 2026 OMALab, Inc. All rights reserved.

## Docs

- [Vision One-Page](docs/vision-one-page.md)
- [CLI and MCP Contract](docs/cli-mcp-contract.md)
- [Installation](docs/installation.md)
- [CLI Guide](docs/cli-guide.md)
- [Agent Usage](docs/agent-usage.md)
- [Plugin Marketplace](docs/plugin-marketplace.md)
- [Parallel Agent Access](docs/parallel-agent-access.md)
- [Companies](docs/companies.md)
- [Browser Profiles](docs/browser-profiles.md)
- [Config Portability](docs/config-portability.md)
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
- a durable state and governance layer for agent behavior

## CLI Quick Start

Exo is now being built as a local CLI first. The current scaffold supports:

- `exo what-is-this`
- `exo motion start`
- `exo motion add`
- `exo motion target`
- `exo motion clone`
- `exo motion update`
- `exo motion refresh`
- `exo motion show`
- `exo motion list`
- `exo motion remove`
- `exo companies add`
- `exo companies list`
- `exo companies find`
- `exo companies show`
- `exo companies update`
- `exo companies motions`
- `exo companies research-brief`
- `exo companies signal-matches add`
- `exo companies signal-matches`
- `exo companies prospects`
- `exo companies prospects add`
- `exo companies through-line`
- `exo companies through-line set`
- `exo companies opening-plan`
- `exo companies opening-plan set`
- `exo companies cadence`
- `exo companies cadence set`
- `exo profiles add`
- `exo profiles discover`
- `exo profiles list`
- `exo profiles show`
- `exo profiles capabilities`
- `exo profiles resolve`
- `exo profiles claim`
- `exo profiles test`
- `exo profiles remove`
- `exo config export`
- `exo config import`

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

Exo now applies versioned local database migrations automatically when it opens the state store. That is how schema changes should land from here on out: migrate the stored state, do not leave older `.exo` payloads to break newer commands.

When another agent is calling Exo, prefer `--json` so the result is machine-readable and can be passed to a downstream step without fragile parsing.

The first command an agent should usually call is:

```bash
exo what-is-this --json
```

That gives the agent the product identity, operating rules, current capabilities, browser-profile rules, current limitations, and docs entrypoints.

### Parallel Chat / Parallel Shell Usage

Run the command from this repo root:

```bash
cd <repo-root>
exo motion list
```

Exo stores local state in:

```bash
<repo-root>/.exo/exo.db
```

So if two Claude/Codex chats run `exo` from the same repo root, they will see the same local motion state.

If you want to make that explicit across multiple shells, set:

```bash
export EXO_STATE_DIR=<repo-root>/.exo
```

Then every agent shell can point at the same Exo state store even if its working directory drifts.

### First Real Command

```bash
exo motion start \
  --url https://example.com/product \
  --premise "This offer matters when regulated lenders enter more complex credit-decision environments." \
  --audience "Traditional FI risk owners" \
  --audience "BNPL modernization leaders" \
  --signal "company::Is there recent evidence that this company expanded into a more complex lending segment?" \
  --signal "person::Is there recent evidence that a senior risk owner was hired or promoted at this company?" \
  --geo "United States" \
  --icp "regulated-enterprise" \
  --industry "banking" \
  --title "Chief Risk Officer"
```

That URL-first motion start does the minimum governed intake:

- fetch a lightweight preview of what is being promoted
- check whether one or more motions already exist for the same URL
- force a continue / clone / new decision instead of silently duplicating state

The motion object now starts with:

- a short human-friendly `name`
- a `premise`
- one or more `audience hypotheses`
- motion-specific `signals`
- targeting and suppression inputs

Signals are not global defaults. They are custom to the motion and should be talkable: question plus observation method plus match rule.

If the URL already exists, choose the path explicitly:

```bash
exo motion start --url https://example.com/product --existing continue --json
exo motion start --url https://example.com/product --existing clone --from <motion-id> --audience "Secondary ICP" --json
```

### Company Research

Once a company is in Exo, use the governed research brief instead of improvising the research path:

```bash
exo companies research-brief <company-id> --json
```

That brief tells the agent to:

- confirm and store the canonical company website
- check the company site first for first-party news and product evidence
- check Google and recent web/news results against the motion's signal questions
- prefer recent evidence that still works as a live why-now
- choose a tight stakeholder set, starting with the best-fit owner instead of stopping on title mismatch
- persist the chosen people and first outreach plan back into Exo

When a signal match is found, persist it on the motion-owned target account so the writer can use it later:

```bash
exo companies signal-matches add <company-id> \
  --motion <motion-id> \
  --signal <signal-id> \
  --summary "Expanded merchant checkout coverage through new POS integration" \
  --source-url https://example.com/news \
  --observed-at 2026-05-01T00:00:00.000Z \
  --confidence high \
  --json
```

Inspect stored matches with:

```bash
exo companies signal-matches show <company-id> --motion <motion-id> --json
```

Do not treat that as a dumping ground. Persist only the strongest recent signals, and synthesize the stored line so it is concise and impactful enough that the writer can reuse it directly.

## Motion targeting loop

Once a motion exists, use the targeting loop to see whether the motion is still blocked on setup, still gathering targets, or ready to launch:

```bash
exo motion target <motion-id> --json
```

That evaluates:

- motion preflight: offer URL, premise, audience hypotheses, signals
- browser gate: whether a trusted profile exists for the required capability
- company loop: canonical identity, signal matches, prospects, through-lines, opening plans, cadence

It stops at `targeting-ready`. Exo does not draft messages and it does not send anything.

When the agent has enough evidence to choose prospects, persist them:

```bash
exo companies prospects add <company-id> \
  --motion <motion-id> \
  --name "Minh Le" \
  --title "Head of Risk" \
  --buying-committee-role primary_business_owner \
  --decision-authority influences \
  --email minh@example.com \
  --profile-viewed-at 2026-05-26T16:00:00.000Z \
  --signal-match <signal-match-id> \
  --active-channel linkedin \
  --activity-type own-post \
  --live-signal-summary "Recent post on merchant-risk growth suggests active LinkedIn use." \
  --live-signal-url https://www.linkedin.com/posts/example \
  --engagement-rationale "Recent public posting is positive evidence this channel is live enough for legitimate engagement." \
  --why-relevant "Best-fit owner for the decisioning-complexity story" \
  --json
```

Inspect the chosen people with:

```bash
exo companies prospects show <company-id> --motion <motion-id> --json
```

Then persist the prospect-specific through-line and opening plan that tie those people to the stored signal matches:

```bash
exo companies through-line set <company-id> \
  --motion <motion-id> \
  --prospect <prospect-id> \
  --signal-match <signal-match-id> \
  --specific-to-them "Specific to them" \
  --shared-problem "Shared problem" \
  --why-now "Recent data-sharing and merchant-surface expansion increase decisioning complexity" \
  --legitimate-wedge "Give the risk owner a concrete reason to clarify ownership and current priorities rather than answer a generic pitch" \
  --compression-line "One-sentence compression line" \
  --json
```

```bash
exo companies opening-plan set <company-id> \
  --motion <motion-id> \
  --prospect <prospect-id> \
  --signal-match <signal-match-id> \
  --why-now "Recent data-sharing and merchant-surface expansion increase decisioning complexity" \
  --angle "Controlled expansion needs tighter risk and decisioning control" \
  --reply-path "Give the risk owner a concrete reason to clarify ownership and current priorities rather than answer a generic pitch" \
  --primary-channel connection-request \
  --fallback-channel email \
  --fallback-trigger "Use email if LinkedIn is blocked or there is no reply after the first LinkedIn touch." \
  --preflight-action "View the prospect profile" \
  --preflight-action "Engage the most recent relevant LinkedIn post only if the interaction is natural" \
  --first-move "LinkedIn connect plus short note" \
  --first-message-goal "Confirm ownership of risk and decisioning modernization" \
  --json
```

Recent public activity is not just filler. If an individual has a legitimate recent post or comment trail, treat that as positive evidence the channel is active. Store the strongest recent hook on the stakeholder, use it to warm the approach when it genuinely fits, and keep direct email as the fallback when LinkedIn is blocked or produces no reply.

Read the stored plan with:

```bash
exo companies opening-plan show <company-id> --motion <motion-id> --prospect <prospect-id> --json
```

The opening plan should not just say what channel to use. It should store the most likely legitimate reply path, given the evidence, to get this person to answer. Exo stores the plan and cadence; the agent still writes the actual message.

When the website is missing or needs correction, persist it:

```bash
exo companies update <company-id> --website-url https://www.example.com --json
```

Exo auto-generates a short codename like `boring-absurd-meerkat`. If you want to override it, pass `--name`.

When flags get cramped, use a structured seed file instead:

```bash
exo motion add --config ./actico.motion.json --json
```

### Browser Profiles

Browser-backed work is profile-sensitive. Exo now treats browser profiles as a first-class object because the wrong browser context means the wrong LinkedIn account, the wrong Sales Navigator entitlement, or no usable session at all.

Discover candidates first:

```bash
exo profiles discover --json
```

Claim the business identity after registration:

```bash
exo profiles claim <profile-id> \
  --label audienti-main \
  --owner william \
  --workspace audienti \
  --scope work \
  --account linkedin:operator-linkedin@example.com \
  --account gmail:operator-linkedin@example.com \
  --max-connection-requests 40 \
  --max-inmail-messages 20
```

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
exo profiles capabilities --json
exo profiles resolve --capability linkedin --json
exo profiles test <profile-id>
```

Important distinction:

- declared capabilities are what the operator says the profile is for
- verified capabilities are what Exo can currently support with local evidence from that profile

Exo now verifies claimed capabilities when a profile is added, re-tested, or imported. That verification is still conservative: it uses local browser artifacts like `Cookies` and `History`, not live SaaS session probes.

The claimed profile is also where weekly outreach pacing lives. Exo mirrors the real Audienti quota shape here:

- `profile visits`
- `connection requests` / `invitations`
- `messages`

For LinkedIn work, `messages` is the pacing bucket that covers direct messages and InMail. Fresh InMail credits are still a separate live observation, not a static config knob.

Important execution rule:

- Exo resolves identity and governance
- the current agent runtime should prefer its native browser-control harness
- do not default to Playwriter for Chrome-backed work if the session already has a native Chrome/browser control surface

### Companies

Company is now a first-class Exo noun:

```bash
exo companies add --name Chainguard --domain chainguard.dev
exo companies list
exo companies find chainguard
exo companies show <company-id>
exo companies motions <company-id>
exo companies profile assign <company-id> --profile <profile-id> --reason "Use one identity consistently"
exo companies profile show <company-id>
```

### Config Export / Import

Exo configuration is now portable:

```bash
exo config export --out ./exo-config.json
exo config import ./exo-config.json
```

That bundle includes:

- motions
- companies
- browser profiles

Browser profiles are re-tested on import so stale local trust does not silently travel with the file.
