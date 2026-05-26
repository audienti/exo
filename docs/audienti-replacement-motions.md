# Audienti Replacement Motions

## Position

Exo does not need to replace Audienti as a product shell first.

It needs to replace the motions that matter now for live design partners:

- define an offer-driven market motion
- identify the right accounts
- decide the next move
- produce the outreach or follow-up artifact
- keep state aligned with reality
- turn replies into meetings

That is the replacement target.

## Hard rule

Every Exo motion should map to work we currently do in Audienti or around Audienti.

If a motion does not help book meetings or preserve account truth, it should not be in the MVP.

## Motion 1: Define the offer-driven motion plan

### Why it matters

This is the upstream motion that created the Audienti crisis.

The operator starts with:

- a product
- an offer
- a product URL

And needs Exo to derive:

- the externally verifiable signals that imply need
- the target companies that match those signals
- the people most likely to care
- the initial action logic for each cluster

### Audienti equivalent

- predictive targeting
- custom signal generation
- company list building
- stakeholder targeting
- manual prompt chaining that becomes a campaign plan

### Exo output

- `offer thesis`
- `signal-set`
- `target map`
- `motion plan`

### CLI / MCP

- `exo define-motion --url <product-url>`
- `exo refresh-motion <motion>`
- `exo show-motion <motion>`
- `exo.define_motion`
- `exo.refresh_motion`
- `exo.show_motion`

## Motion 2: Prioritize accounts that need action now

### Why it matters

The operator needs to know where to spend attention today.

### Audienti equivalent

- finder and signal work
- prospect and queue prioritization
- manual review of account movement

### Exo output

- ranked inbox of accounts and contacts needing attention
- short why-now explanation
- linked evidence

### CLI / MCP

- `exo inbox`
- `exo.inbox`

## Motion 3: Build or refresh the live account brief

### Why it matters

The operator should not reconstruct context from tabs, chat history, and CRM notes.

### Audienti equivalent

- prospect context
- company + person research
- writer context assembly
- queue detail review

### Exo output

- live account brief
- what changed
- who matters
- what has already happened
- what Exo believes
- what Exo predicts
- recommended next move

### CLI / MCP

- `exo brief <account>`
- `exo.brief`

## Motion 4: Propose the next action

### Why it matters

The core job is not message generation.
It is selecting the right next move.

### Audienti equivalent

- planner output
- writer draft generation
- suggested outreach stage decisions

### Exo output

- next-action proposal
- draft content when relevant
- evidence summary
- predicted outcome
- confidence and time horizon
- risk or no-action recommendation

### CLI / MCP

- `exo propose <account>`
- `exo.propose`

## Motion 5: Review and approve externally-facing action

### Why it matters

The human should govern the move before it becomes a live business action.

### Audienti equivalent

- queue review
- draft editing
- manual operator judgment before send

### Exo output

- approved proposal
- edited proposal
- rejected proposal
- deferred proposal
- human takeover assignment

### CLI / MCP

- `exo approve <proposal>`
- `exo reject <proposal>`
- `exo.approve`
- `exo.reject`

## Motion 6: Record execution and observed outcome

### Why it matters

Exo must know what actually happened.
Otherwise prediction and learning are fiction.

### Audienti equivalent

- sent-state tracking
- inbox action updates
- outcome tracking

### Exo output

- execution event
- observed outcome
- prediction check

### CLI / MCP

- `exo record-outcome <proposal>`
- `exo.record_outcome`

## Motion 7: Reconcile off-platform reality

### Why it matters

Operators will act directly in LinkedIn, email, or CRM.
Exo must recover the truth.

### Audienti equivalent

- sync
- inbox audits
- state repair after direct operator actions

### Exo output

- reconciliation report
- detected drift
- repaired drift
- unresolved drift requiring judgment

### CLI / MCP

- `exo reconcile <account>`
- `exo.reconcile`

## Motion 8: Prepare reply handling and meeting conversion

### Why it matters

The objective is not merely to get a reply.
The objective is to move toward a meeting.

### Audienti equivalent

- inbox follow actions
- manual follow-up handling
- message sequencing around engaged prospects

### Exo output

- reply classification
- next-step recommendation
- suggested response
- meeting ask recommendation
- owner takeover when needed

### CLI / MCP

- `exo replies`
- `exo reply <thread>`
- `exo.replies`
- `exo.reply`

## Motion 9: Produce a meeting prep pack and CRM commit

### Why it matters

Once a conversation turns into a meeting, the operator needs a clean handoff artifact and clean system writeback.

### Audienti equivalent

- manual CRM note updates
- operator memory
- ad hoc prep for live conversations

### Exo output

- meeting prep pack
- CRM-ready summary
- committed CRM record

### CLI / MCP

- `exo prep-meeting <account>`
- `exo commit-crm <object>`
- `exo.prep_meeting`
- `exo.commit_crm`

## Replacement sequence

Exo should replace Audienti in this order:

1. `define-motion`
2. `inbox`
3. `brief`
4. `propose`
5. `approve`
6. `record-outcome`
7. `reconcile`
8. `reply`
9. `prep-meeting`
10. `commit-crm`

That sequence mirrors the booked-meeting motion more honestly than trying to rebuild the old shell.

## Success test

Exo has replaced the motion if William can do the following for a live design partner account using Claude/Codex plus Exo:

- define a new motion from an offer URL
- get a useful signal-set and target map
- identify the next account worth attention
- see the account truth quickly
- request a proposed move
- review the move and prediction
- execute or mark it handled
- recover from off-path replies or manual actions
- prepare and log the meeting handoff

If that works, Exo is real.
If not, it is still doctrine.
