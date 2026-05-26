# MVP Product Spec

## Product statement

Exo is the control room for agentic GTM.

The MVP is a narrow operator system for one core loop:

`signal -> account brief -> proposed action -> review -> reply -> CRM commit`

But the first motion to implement sits upstream of that loop:

`offer -> signal-set -> target map -> motion plan`

That upstream motion must support explicit targeting inputs, not just open-ended summarization.

The first delivery model is headless:

- `exo` CLI for direct operator use
- `exo` MCP for Claude/Codex-driven use

Those two surfaces must expose the same product contract.

## The problem

The intended user already has access to frontier models, browser automation, enrichment tools, Sales Navigator, and a CRM.

What they do not have is:

- a reliable system of record for signal-to-action work
- a clean review surface for AI-proposed outreach and follow-up
- durable memory of what happened across accounts and contacts
- an exception-oriented control room instead of a pile of tools

The MVP exists to solve that, and nothing else.

## Design principle

This MVP should be designed experience-first and output-first.

That means:

- start from the operator's daily journey
- define what each screen must help them see and decide
- define the artifact output each step produces
- derive the minimum state model only after that

The product should not be designed from backend entities outward.

It also should not be designed as a browser shell first.
The browser is optional.
The first-class interaction model is shared across CLI and MCP.

## Delivery model

The MVP should be usable in two primary ways:

1. operator runs `exo` directly
2. Claude/Codex runs Exo tools through MCP

The same nouns, verbs, outputs, and state transitions must exist in both paths.

Only presentation should differ:

- CLI returns terminal-friendly output and optional JSON
- MCP returns structured tool results plus renderable summaries

If a capability only exists in one surface, it is not part of the stable MVP contract yet.

## Primary user

One high-agency GTM operator:

- founder doing founder-led outbound
- consultancy or agency operator
- RevOps or GTM power user
- signal-driven outbound lead

The operator is the product center.

## Secondary user

One optional reviewer or approver:

- founder
- manager
- client stakeholder

The reviewer exists to approve sensitive actions, not to run the whole system.

## Jobs to be done

### Functional jobs

- turn a product or offer URL into a usable market motion
- let the operator constrain that motion by geolocation, ICP type, industry, company type, company shape, company size, segment, and target title
- let the operator explicitly suppress accounts, domains, contacts, and do-not-contact entries before the target map is built
- monitor a defined set of accounts for meaningful change
- turn scattered raw signal into a usable account picture
- propose the best next action with evidence
- review and approve externally-facing actions
- handle replies and exceptions without losing context
- write back outcomes into CRM cleanly

### Emotional jobs

- stop feeling like the whole motion lives in tabs and memory
- trust that the system knows what happened
- know what needs judgment right now
- avoid embarrassing or duplicated actions

## Replacement objective

The MVP is not a parallel experiment next to Audienti.

Its first job is to replace the live motions we currently perform in and around Audienti for design partners.

That means Exo must take over:

- offer-to-motion planning
- account prioritization
- account brief assembly
- next-action proposal
- review and approval
- outcome recording
- reconciliation
- reply handling
- meeting prep
- CRM commit

## Required outputs

The MVP must produce these concrete outputs:

- offer theses
- targeting profiles
- suppression policies
- custom signal sets
- target maps
- motion plans
- ranked signal items
- live account briefs
- review-ready action proposals
- explicit predicted outcomes attached to meaningful proposed actions
- reply decision artifacts
- CRM commit records
- prediction checks comparing expected and observed outcomes

If one of these outputs is weak, the experience breaks.

## Core user promise

If Exo works, a strong operator should feel:

- less scattered
- more informed
- less reactive
- more confident approving action
- able to manage a much larger account set without degrading quality

## Scope

### Included

- one workspace
- one primary operator
- optional one reviewer
- LinkedIn and email as action channels
- HubSpot as the only CRM target
- lightweight alert delivery to an external operator surface
- a bounded set of signals
- explicit targeting constraints on motion creation
- explicit excludes and do-not-contact suppression on motion creation
- support for multiple segment variants inside one motion
- retrieval through user-owned surfaces such as Sales Navigator and browser sessions
- reviewed action proposals
- reply triage
- recurring audit and reconciliation with external surfaces
- audit and CRM commit history

### Excluded

- multitenant billing
- large team permissions
- self-serve onboarding
- full workflow builder
- full sequence builder
- multichannel execution breadth
- broad analytics suite
- autonomous send-everything mode
- generic agent platform features
- building a full collaboration product inside Slack
- automatic CRM customer suppression during motion creation in the first cut

## Reconciliation scope

The MVP must assume state drift will happen.

Sources of drift include:

- operator actions taken directly in LinkedIn
- operator actions taken directly in email
- inbound replies or reactions not initiated from Exo
- CRM changes made outside Exo

The MVP should support a recurring audit and reconciliation loop for:

- LinkedIn
- email
- HubSpot

The purpose is to:

- observe the current external state
- compare it to Exo's expected state
- repair straightforward mismatches automatically
- flag ambiguous mismatches for operator review

Simple examples:

- Exo thinks no reply was received, but LinkedIn shows a reply
- Exo thinks a proposal is still pending, but the operator already sent the message manually
- Exo thinks a contact is untouched, but HubSpot shows a logged interaction

The correct product term here is not just "sync."
It is reconciliation.

## Signal scope

Signals can enter the system in two ways:

- defined up front as part of an offer-driven motion plan
- observed later during execution and reconciliation

The MVP should support both.

The MVP should support only a few signal classes:

- company event
- hiring change
- role change or champion movement
- revisit or activity signal
- manual strategic account watch

Signals must always carry:

- source
- timestamp
- evidence snapshot or excerpt
- confidence or relevance score
- account association

Signals should also preserve which motion segment or targeting branch they belong to when relevant.

## Retrieval scope

The MVP should assume a bring-your-own-retrieval model.

That means Exo can rely on:

- the operator's Sales Navigator account
- the operator's browser session
- the operator's saved lead or account views

Claude/Codex can use those surfaces through the harness to:

- query target accounts
- resolve people by title
- verify profile details
- collect evidence snippets

Exo should store the structured result, not try to replace the retrieval surface itself.

## Targeting scope

The upstream motion planner must allow the operator to specify:

- geolocations
- ICP types
- industries or sub-industries
- company types
- company shapes
- company size bands
- target titles
- target role families
- named segment variants
- exclusions
- do-not-contact suppressions

Examples:

- `USA, Canada, Australia`
- `North America` or `EMEA`
- `regulated enterprise` or `mid-market fintech`
- `traditional banks`
- `BNPL providers`
- `PE-backed consolidators`
- `mid-market lenders`
- `CRO, CMO, VP Sales Development`
- `exclude named customer accounts`
- `exclude existing do-not-contact contacts`

This is required because the same offer can produce different target maps and different stakeholder logic by segment.

## Suppression scope

The MVP should support explicit suppression before targets are generated.

That means:

- excluded account names
- excluded domains
- excluded contacts
- do-not-contact lists

The purpose is simple:

- do not build targets we already know are off-limits
- do not waste operator time reviewing obvious non-starters
- do not let the system manufacture outreach risk at the top of the workflow

Future feature:

- check the CRM during motion creation and suppress companies or contacts that are already customers
- optionally suppress open opportunities, active accounts, or recently closed-lost accounts based on CRM rules

## Proposed action scope

An action proposal is the main unit of work.

Each proposal should contain:

- target account
- target contact
- triggering signal or reason
- evidence summary
- suggested action type
- draft content when applicable
- predicted outcome
- confidence level
- time horizon
- risk or policy state
- requested reviewer decision

Supported action types in MVP:

- create LinkedIn message draft
- create email draft
- suggest follow-up
- suggest no action
- suggest human takeover

## Alerting scope

The MVP should support one interrupt surface outside the main Exo app.

Recommended first choice:

- Slack

The purpose of alerting is to bring the operator to a meaningful decision faster.

The MVP alert types should be limited to:

- high-priority new signal
- action proposal waiting on review
- important inbound reply
- workflow failure or blocked state

Each alert should include:

- why it matters
- what object it refers to
- what action is needed
- a direct path into Exo

Optional lightweight actions from the alert surface:

- acknowledge
- snooze
- open in Exo
- approve simple action
- assign for human takeover

The main rule is that Exo remains the system of record even when the action starts elsewhere.

## Prediction and learning scope

The MVP should make prediction explicit.

For every meaningful proposed action, Exo should state:

- what it expects to happen
- why it expects that
- how confident it is
- what time window matters

Then, after execution or non-execution, Exo should compare:

- predicted outcome
- observed outcome

The goal is not fake precision.
The goal is legible judgment and visible calibration.

## State model

The MVP should only require these objects:

- `offer`
- `targeting_profile`
- `suppression_policy`
- `signal_set`
- `target_map`
- `motion_plan`
- `account`
- `contact`
- `signal`
- `evidence`
- `brief`
- `proposed_action`
- `approval`
- `prediction`
- `outcome`
- `crm_commit`
- `reconciliation_event`
- `drift_alert`

This is the canonical product state.

Everything else should be treated as projection or implementation detail.

## Workflow contract

### 0. Offer-to-motion planning

Input:

- product URL or offer definition
- optional targeting constraints

Targeting constraints can include:

- geolocation
- ICP type
- industry
- company type
- company shape
- company size
- title targets
- segment definitions
- exclusions

Suppression constraints can include:

- excluded account list
- excluded domain list
- excluded contact list
- do-not-contact list

Output:

- offer thesis
- targeting profile
- custom signal-set
- grouped target map
- motion plan

This is the bootstrap layer for the rest of the workflow.

### 1. Signal intake

Input:

- system-detected or manually-added signal

Output:

- ranked signal item attached to an account

### 2. Brief assembly

Input:

- account plus related signals, contacts, and history

Output:

- updated account brief with current hypothesis and suggested next move

### 3. Action proposal

Input:

- account brief plus operator request or automated recommendation

Output:

- proposed action with evidence and optional draft content
- predicted outcome with confidence and time horizon

### 4. Review

Input:

- proposed action

Output:

- approved
- edited and approved
- rejected
- deferred
- routed to human takeover

The review must include the prediction, not just the draft.

### 5. Reply triage

Input:

- inbound reply or reaction

Output:

- classified response
- suggested next move
- CRM-ready update

### 6. CRM commit

Input:

- accepted outcome or approved action result

Output:

- durable writeback record

### 7. Reconciliation

Input:

- observed external activity or state snapshot

Output:

- repaired state
- or drift flagged for operator judgment

### 8. Prediction check

Input:

- explicit prediction plus later observed outcome

Output:

- confirmed prediction
- missed prediction
- mixed result
- operator-visible learning signal

## Product rules

### Rule 1: evidence before action

No proposed action without visible evidence.

### Rule 2: approval is the core unit of work

The interface should bias toward reviewing and deciding, not toward composing from scratch.

### Rule 3: the system should surface exceptions, not raw exhaust

The operator should see what changed and what matters, not a firehose.

### Rule 4: state must be durable

The system should know what happened without relying on the operator's memory or scattered notes.

### Rule 5: CRM writeback is part of the workflow, not cleanup

If CRM updates are deferred indefinitely, the product is failing.

### Rule 6: outputs are the product surface

The operator should interact with useful artifacts, not generic records.

### Rule 7: state follows the experience

Add state only when it is required to support a visible operator workflow or output.

### Rule 8: alerting is for interruption, not habitation

Slack or another external surface may start the interaction.
It should not become the place where the whole product lives.

### Rule 9: expected state is not enough

Exo must track both intended state and observed external state.

### Rule 10: reconciliation is part of trust

If Exo cannot recover from off-platform activity, it stops being a trustworthy control room.

### Rule 11: every meaningful recommendation should carry a prediction

If Exo cannot say what it expects to happen, it has not formed a strong enough judgment.

### Rule 12: completed work must feed improvement

Exo should compare predicted outcomes against observed outcomes so the operator can learn and the system can improve.

## MVP success criteria

The MVP is successful if:

- one operator can manage 100-250 accounts without losing state
- time from signal to review-ready action is materially shorter
- externally-facing actions have evidence and approval history
- reply handling happens in a single control-room workflow
- HubSpot updates happen as part of the motion
- off-platform activity is detected and reconciled reliably enough that the operator does not need a separate manual audit habit
- meaningful predictions are visible before action and checked after completion

## Failure modes to watch

- signal inbox becomes noisy and unreadable
- account brief turns into a bloated CRM page
- review queue becomes a glorified draft folder
- reply triage is disconnected from prior account context
- CRM commit is unreliable or hidden
- the operator still needs external notes to reconstruct what happened
- off-platform actions create silent drift that Exo never notices
- Exo recommends actions but never shows whether its predictions held up

## Sharp non-goals

Do not let the MVP slide into:

- "let's just add more channels"
- "let's make the writer better"
- "let's make it autonomous"
- "let's build admin and permissions first"
- "let's add more dashboards"

Those are all ways to fall back into the dead frame.
