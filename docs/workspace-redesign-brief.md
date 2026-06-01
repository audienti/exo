# Exo Workspace Redesign Brief

## One-line brief

Build Exo as an operator workspace, not an admin panel.

The top layer is derived operator guidance: `next`, `daily`, `inbox`, `review`.
Under that, organize the canonical model into four domains: motions, companies/prospects, execution identities, and inbound truth.
Always distinguish canonical records from derived status.
Every major panel should answer: what exists, what state it is in, whether the truth is fresh, and what action is required.

## Core constraint

Do not build the product around a flat object list such as `motions`, `users`, `companies`.
That produces a neat but wrong admin UI.

Exo is an operator surface over governed GTM state.
The first question is not "what records exist?"
The first question is "what requires judgment or action right now?"

## Product model

Exo has two different classes of information that must stay separate.

### 1. Canonical state

These are the system-of-record objects.

- motions
- companies
- prospects
- users
- accounts
- profiles
- runtime and harness connections
- observations
- cues

### 2. Derived status

These are computed operator surfaces and summaries.

- next
- daily
- inbox
- inbound review
- workspace rollups
- capacity pressure
- blockers
- readiness summaries
- stale or incomplete warnings

Design rule:
Never collapse canonical state and derived status into the same mental model.
Derived panels should explain pressure and action.
Canonical panels should explain what exists and what is stored.

## Information architecture

The top-level workspace should be organized like this:

1. Operator
2. Motions
3. Companies and Prospects
4. Execution
5. Inbound Truth
6. Workspace

## Domain definitions

### Operator

Purpose:

- what should I do next?
- what needs a decision now?
- what is blocked?
- what is stale or incomplete?
- what is due today?

This layer is derived, not canonical.
It should be composed from:

- `next`
- `daily`
- `inbox`
- `inbound review`

This is the default landing surface.
The user should open into this layer, not into a raw object browser.

### Motions

Purpose:

- motion state
- company and prospect inventory by motion
- readiness
- packet progress
- action progress
- draft progress

This is canonical GTM state plus derived readiness around that state.

### Companies and Prospects

Purpose:

- canonical company list
- canonical prospect list
- enrichment state
- through-lines
- opening plans
- cadence
- touches
- relationship context

This layer answers "what do we have?" and "how complete is each branch?"

### Execution

Purpose:

- who owns execution?
- which LinkedIn or Gmail identity is real?
- which capability is actually available?
- what is blocked by assignment?
- what is blocked by capability?

Canonical objects:

- users
- connected accounts
- browser profiles
- runtime and harness connections

This must stay separate from motions and companies.
Ownership and transport are not the same thing as GTM objects.

### Inbound Truth

Purpose:

- what surfaces were checked?
- which are partial?
- which are unchecked?
- what changed?
- what disappeared?
- what still needs reconciliation?

Canonical objects:

- sync state
- surface status
- observations
- cues
- reconciliation gaps
- deltas

This is now a first-class domain.
Do not bury it inside "activity."

### Workspace

Purpose:

- combined operator view across all domains
- the fastest working surface for decisions and action

This is not another canonical domain.
It is the composed operating surface across operator guidance, governed state, execution, and truth freshness.

## Landing page

The top of the workspace is directionally correct today: operator-first.
Keep that.

The landing screen should open with three stacked concerns:

1. `What needs my decision?`
2. `What can the agent do now?`
3. `What is blocked, stale, or incomplete?`

Do not open with explanatory prose.
Do not open with a hero.
Do not open with an object inventory.

## Navigation

Recommended left nav:

- Operator
- Motions
- Companies
- Prospects
- Execution
- Inbound Truth
- Workspace

Optional utility nav:

- Search
- Filters
- Saved views

Do not put raw implementation nouns in the primary nav unless they map to an actual operator job.

## Main panels

### Operator view

Render these sections in order:

1. Next move
2. Need decision
3. Agent queue
4. Blocked
5. Stale or incomplete
6. Today's agenda

Each section should be compact, scannable, and action-first.

### Motions view

Render these sections:

1. Motion list with state and readiness
2. Selected motion summary
3. Company inventory in motion
4. Prospect inventory in motion
5. Branch readiness
6. Packet, action, and draft progress
7. Motion-specific blockers

### Companies and Prospects view

Render these sections:

1. Company list
2. Prospect list
3. Enrichment status
4. Through-line and opening-plan completeness
5. Cadence state
6. Touch history and current branch state

### Execution view

Render these sections:

1. Users
2. Assigned companies
3. Connected accounts
4. Browser profiles
5. Harness and runtime connections
6. Capability coverage
7. Assignment-blocked vs capability-blocked work

### Inbound Truth view

Render these sections:

1. Surface health
2. Freshness and last checked
3. Observations
4. Deltas and disappeared items
5. Itemization gaps
6. Reconciliation needed

## Card hierarchy

Cards should be functional, not narrative.

Each major card should answer, in this order:

1. What object or subject is this?
2. What state is it in?
3. Is the truth fresh?
4. What action is required?

Preferred card shape:

- title
- compact state chips
- one-line summary
- one-line action or no-action state
- optional metadata row

Avoid long explanatory paragraphs under every card.

## Status system

Use one consistent status language across the workspace.

### Record state

Examples:

- draft
- active
- paused
- archived
- ready
- waiting
- blocked

### Truth status

Examples:

- checked
- partial
- unchecked
- failed
- quiet

### Action status

Examples:

- due now
- needs decision
- waiting
- blocked by assignment
- blocked by capability
- reconciliation needed

Design rule:
Do not overload one chip to mean all three things.
State, truth, and action are separate dimensions.

## Noise reduction rules

The current workspace over-explains.
The redesign should cut explanation and make the surface more operational.

Rules:

- prefer labels over paragraphs
- prefer direct action text over commentary
- show counts only when they help a decision
- do not explain obvious computed numbers inline
- do not surface "things we did not do" unless they create operator risk
- do not narrate the system to the user
- default collapsed detail should be low-noise

Bad:

- large explanatory blocks about why a count exists
- generic summaries with no action
- repeated prose under every panel
- panels that mostly restate that data is missing

Good:

- `4 need decision`
- `2 blocked by assignment`
- `Profile Views: partial`
- `Parm Uppal: reconcile invite outcome`

## Empty, partial, and error states

Every major panel should have explicit low-noise handling for missing or degraded truth.

### Empty

Use when nothing exists.

Examples:

- no motions yet
- no prospects selected
- no observations recorded

### Partial

Use when truth is incomplete but not absent.

Examples:

- sync succeeded with warnings
- visible count exceeds itemized observations
- some surfaces checked, others not

### Error

Use when the system cannot currently trust the surface.

Examples:

- sync failed
- profile unavailable
- capability missing
- reconciliation required before action

Design rule:
Empty is not the same as partial.
Partial is not the same as failed.

## What Claude should not build

Do not build:

- a generic CRUD admin
- a dashboard mosaic of equal-weight cards
- a raw object browser as the homepage
- a "platform overview" hero with decorative copy
- a single status system that mixes readiness, freshness, and action
- a truth layer hidden behind activity logs
- a motion view that ignores execution identity and truth freshness

## Visual direction

This is an operator console, not a marketing site.

The UI should feel:

- dense but legible
- calm
- explicit
- controlled
- fast to scan

It should not feel:

- celebratory
- verbose
- ornamental
- like a BI dashboard
- like a record-management backend

## Success criteria

A redesign is correct if, within a few seconds, an operator can answer:

- what do I need to decide now?
- what can the agent do without me?
- what is blocked?
- what state is canonical?
- is the truth fresh enough to trust?

If the redesign makes those answers slower in exchange for tidier object browsing, it failed.

