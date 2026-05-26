# UI Model

## Design principle

Exo should not feel like a CRM.
Exo should not feel like a chatbot.
Exo should not feel like a sequence builder.

Exo should feel like a live control room.
That control room should be expressible through:

- a CLI
- MCP tool use inside Claude/Codex
- optional browser projections

The operator should open it and immediately understand:

- what changed
- what matters
- what needs judgment
- what is blocked
- what already happened

## Experience goal

The operator experience should feel like:

- entering a live control room
- orienting in seconds
- moving from change detection to decision
- producing a usable output at every step

The UI exists to help the operator create and approve outputs, not to browse records.

## Interface model

The MVP should not assume the browser is the primary home.

The UI model is:

- one shared product contract
- multiple interface projections

### Primary projections

- `exo` CLI for direct operator use
- `exo` MCP tools for Claude/Codex-driven use

### Secondary projections

- browser views
- Slack alerts

The CLI and MCP should feel like the same product from a UI perspective:

- same verbs
- same nouns
- same artifacts
- same state transitions

Only rendering changes.

## Primary outputs by screen

- `Inbox` produces a ranked, decision-ready signal item
- `Account` produces a live working brief with an active prediction
- `Review` produces an approved, edited, rejected, or escalated action proposal with an explicit expected outcome
- `Replies` produces a classified reply and next-step decision
- `History` produces confidence in what was committed, what happened, and whether predictions held up
- `Alerts` produce timely interruption when something needs judgment outside the main app

## Navigation model

The MVP should have a very small navigation surface:

- `Inbox`
- `Accounts`
- `Review`
- `Replies`
- `History`

Optional utility surfaces:

- `Search`
- `Settings`

Operator-adjacent surfaces:

- `Alerts` delivered into Slack or another external surface

Do not start with a giant left rail full of setup concepts.

## Home state

The default landing view should be `Inbox`.

Why:

- the control room starts with change detection
- the operator needs to orient to new information first
- it anchors the product around signal and decision, not configuration

This does not mean the operator always enters through the web app.
They may first be pulled in by an external alert.

## External alert surface

### Purpose

Interrupt the operator only when meaningful attention is required.

### Recommended first surface

- Slack

### Alert card contents

Each alert should contain:

- object type
- company or contact
- short why-this-matters line
- urgency
- requested action
- direct link back to Exo

### Allowed lightweight actions

- acknowledge
- snooze
- open in Exo
- approve a simple proposal
- assign human takeover

### Design note

The alert surface should feel like a thin control extension, not a second product.
It should route attention efficiently, not duplicate the whole interface.

## Screen 1: Inbox

### Purpose

Show the operator the ranked set of meaningful changes requiring attention.

### Layout

Two-pane layout:

- left column: inbox list
- right panel: selected signal detail

### Inbox row contents

Each row should show:

- company name
- signal type
- short why-it-matters summary
- freshness
- current status
- whether a brief or action already exists

### Detail panel contents

- evidence snippet
- linked account
- related contact if any
- prior state summary
- suggested next step

### Primary actions

- ignore
- snooze
- add to watch
- update brief
- request action proposal

### Output

- a triaged signal turned into a watch decision, a brief update, or an action request

### Design note

The inbox is not a feed.
It is a triage surface.

## Screen 2: Account

### Purpose

Show one account as a mission panel, not a database record.

### Layout

Three zones:

- header
- central brief
- right-side action rail

### Header

- company
- current account status
- primary hypothesis
- recent material changes
- reconciliation health

### Central brief

Sections:

- what changed
- what we believe
- what we predict
- who matters
- prior touches
- risks and objections
- suggested next move

### Right action rail

- request draft
- mark not now
- create human task
- open pending proposal
- review drift if present

### Output

- a usable account brief with a current hypothesis and a next-step recommendation

### Design note

This page should read like a live working brief.
If it starts to look like Salesforce account detail, the product has drifted.

## Screen 3: Review Queue

### Purpose

Make approvals the main unit of work.

### Layout

Stacked card list with a detail drawer or split panel.

### Queue card contents

- target account and contact
- proposed action type
- triggering signal
- evidence strength
- predicted outcome
- confidence
- policy state
- draft preview

### Detail view contents

- full draft
- evidence trail
- prior contact history
- rationale
- prediction and time horizon
- CRM impact preview

### Primary actions

- approve
- edit and approve
- reject
- defer
- assign human takeover

### Output

- an approved, edited, rejected, deferred, or escalated action proposal

### Design note

This is the heart of the product.
It must feel faster and safer than doing the same work across chat, docs, and CRM.
Some simple approvals may originate from an alert surface, but the queue remains the canonical review environment.
If the operator cannot see what Exo expects to happen, the review is incomplete.

## Screen 4: Replies

### Purpose

Handle inbound reactions and replies with full context.

### Layout

Queue on the left, classification and response workspace on the right.

### Reply row contents

- account
- contact
- last inbound message
- sentiment or classification guess
- urgency

### Workspace contents

- reply thread
- account summary
- recommended classification
- suggested next action
- proposed response
- prediction check when relevant
- CRM update preview

### Primary actions

- accept classification
- change classification
- send to human takeover
- approve suggested response
- create follow-up task
- commit CRM update

### Output

- a classified reply plus an accepted next-step decision

### Design note

This is where the product proves it is not just pre-send automation.
Urgent reply alerts may start outside the app, but the deep context should resolve here.

## Screen 5: History

### Purpose

Provide confidence that the system knows what happened.

### Layout

Chronological ledger with filters.

### Event types

- signal created
- brief updated
- action proposed
- action approved
- action rejected
- prediction recorded
- prediction checked
- reply received
- outcome recorded
- CRM commit written
- reconciliation run completed
- drift detected
- drift repaired

### Primary value

- debugging
- trust
- auditability
- continuity

### Output

- a durable view of the committed system history

### Design note

This does not need to be pretty.
It needs to be reliable.

## Prediction presentation

The MVP does not need a standalone learning dashboard.

It does need visible prediction language where judgment happens:

- account view shows the active prediction
- review view shows expected outcome and confidence
- history shows whether the prediction held up after completion

The operator should be able to answer:

- what did Exo think would happen?
- what actually happened?
- was the prediction directionally useful?

## Reconciliation presentation

The MVP does not need a separate giant reconciliation dashboard.

It does need visible reconciliation state in the right places:

- account-level sync health
- reply or action items marked when observed state differs from expected state
- history entries showing drift detection and repair
- alerts for high-confidence important drift

The operator should be able to answer:

- are we aligned with observed reality?
- what drifted?
- what was repaired automatically?
- what still needs my judgment?

## Object-view relationship

The UI should map directly to the canonical objects:

- Inbox centers `signal`
- Account centers `brief`
- Review centers `proposed_action` and `approval`
- Replies center `outcome`
- History centers `crm_commit` and event log

That mapping should stay clean.

## Interaction model

Exo should bias toward these verbs:

- review
- approve
- reject
- escalate
- update
- commit

It should avoid centering on these verbs:

- configure
- build workflow
- create sequence
- author campaign

Those belong to the old frame.

## What the MVP should look like visually

High level:

- dense but calm
- operator-focused
- minimal chrome
- strong information hierarchy
- obvious state transitions

It should feel closer to:

- a mission control console
- a moderation queue
- a trading workstation for decisions

It should feel less like:

- a marketing automation dashboard
- a CRM settings page
- a chatbot wrapped in panels

The external alert surface should feel like:

- a high-signal interrupt layer
- concise
- contextual
- obviously subordinate to the main control room

## MVP visual boundaries

Do not add:

- a giant dashboard homepage
- decorative analytics for vanity
- excessive setup flows
- dozens of tabs inside each object
- multiple competing ways to do the same thing

The UI wins if the operator can sit down and immediately know:

- what needs attention
- why
- what the system wants to do
- what they need to decide
