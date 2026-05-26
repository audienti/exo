# Vision One-Page

## What Exo is

Exo is a control room for high-value outbound and account-based GTM work.
It is delivered first as a GTM operating kernel exposed through CLI and MCP.

It helps one operator answer four questions:

1. Which account needs attention right now?
2. Why does it need attention?
3. What should we do next?
4. Did that action work?

That is the product.

## What Exo is not

Exo is not:

- an AI SDR
- a CRM
- a sequencing tool
- a generic agent platform
- a workflow builder
- a replacement for frontier models

If the product starts to look like one of those, it is drifting.

## Who it is for

Exo is for one high-agency operator:

- a founder doing founder-led outbound
- a GTM or RevOps power user
- an agency or consultancy operator running pipeline for clients

This person already has AI.
What they do not have is a reliable control room.

## The core job

The job is not "automate sales."

The job is:

- turn an offer into a usable market motion
- detect meaningful change
- preserve account context
- propose the next action
- route that action through judgment
- observe what actually happened
- learn whether the prediction was right

## The core loop

Exo should do one loop well:

`signal -> brief -> proposed action -> review -> execution -> observed outcome -> learning`

Everything else is secondary.

But Exo also needs one upstream bootstrap loop:

`offer -> custom signals -> target accounts -> impacted people -> motion plan`

That bootstrap loop is the first Exo surface worth implementing.

## The operator experience

The operator should open Exo and feel:

- oriented
- focused
- less scattered
- able to decide quickly
- able to trust the system history

Exo should not feel like administration.
It should feel like mission control.

## The MVP

The MVP has five surfaces:

- `Inbox`
- `Account`
- `Review`
- `Replies`
- `History`

And one interrupt surface:

- `Alerts` in Slack or another external surface

The primary operator surfaces are:

- `exo` CLI
- `exo` MCP tools inside Claude/Codex

Browser views are optional projections of the same artifacts, not the primary contract.

## What each surface does

### Inbox

Shows what changed and what matters.

It should be fed by a defined motion plan, not by generic undirected monitoring.

### Account

Shows the live brief for one account:

- what changed
- what we believe
- what we predict
- what we should do next

### Review

Shows proposed actions waiting on judgment.

Each action should include:

- the evidence
- the draft
- the predicted outcome

### Replies

Shows inbound replies and what to do with them.

### History

Shows what happened, what was committed, and whether the prediction held up.

## The prediction frame

Exo is not just a workflow system.

It should make explicit bets:

- what action is likely to lead to what outcome
- with what confidence
- over what time horizon

Then Exo should compare prediction to reality.

That is how the system and the operator improve.

## The trust frame

Exo has to handle the fact that people act outside the product.

Operators will:

- reply in LinkedIn directly
- send emails manually
- update CRM outside the workflow

So Exo must reconcile observed reality with expected state.

If it cannot do that, it becomes fiction.

## The simplest way to explain Exo

Exo tells a GTM operator:

- given this offer, here are the signals and accounts that matter
- this account matters now
- here is why
- here is the best next move
- here is what we think will happen
- here is what actually happened

And it lets the operator or their agent do that through the same verbs in CLI and MCP.

That is the whole idea.

## What to ignore right now

Ignore for now:

- complex model infrastructure
- broad agent orchestration
- extra channels
- team permissions
- analytics sprawl
- CRM replacement thinking
- self-serve setup complexity

Those are distractions until the core loop feels sharp.

## The hard test

If a strong operator cannot use Exo for one hour and feel more effective than they do with:

- Claude
- Codex
- Sales Navigator
- HubSpot
- inboxes
- spreadsheets
- notes

then the product is not real yet.
