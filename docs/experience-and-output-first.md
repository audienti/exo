# Experience and Output First

## Core rule

Exo should be designed from:

- the operator's daily experience
- the decisions the operator needs to make
- the outputs the operator needs the system to produce

Not from:

- a generic schema
- a workflow engine
- a backend-first object hierarchy

The object model matters, but it is downstream of the experience.

## Why this is the right approach

Exo is a control room product.

That means the value is not hidden in infrastructure.
The value is visible in whether the operator can:

- orient quickly
- trust what they are seeing
- understand what matters
- act with confidence
- produce a useful output without leaving the system

If the experience fails there, the schema underneath does not save the product.

## Start from user questions

When the operator opens Exo, the product should answer five questions immediately:

1. What changed?
2. What matters?
3. What needs my judgment?
4. What does the system think we should do?
5. What already happened?

Those questions should drive the interface.

These questions may first arrive through an alerting surface, not the main app.
That does not change the rule. It means the alert must preserve enough context to let the operator decide whether to ignore, inspect, or act.

## Start from outputs

The MVP should be designed around concrete outputs, not abstract records.

The first outputs are:

### 1. Ranked signal item

What leaves the inbox:

- a clear, evidence-backed reason to care about an account right now

### 2. Live account brief

What leaves account synthesis:

- a working artifact that explains what changed, what we believe, who matters, and what to do next

### 3. Review-ready action proposal

What leaves draft generation:

- a proposed message or next action with evidence, rationale, and policy state attached

### 4. Reply decision artifact

What leaves reply triage:

- a classified response, suggested next move, and approved or assigned follow-up path

### 5. CRM commit record

What leaves the workflow:

- a durable record of what was committed back to the system of record

### 6. Reconciliation result

What leaves the audit loop:

- a clear statement of what drifted, what was repaired, and what still needs operator judgment

If Exo does not produce these outputs clearly, it is not solving the operator's problem.

## Design sequence

The MVP should be designed in this order:

1. define the default operator journey through the product
2. define the key screens in that journey
3. define the output artifact produced by each screen
4. define the actions available on each artifact
5. derive the minimum state required to support those actions

This is the correct direction of dependency.

## The operator journey

The default daily Exo loop should be:

1. open Inbox
2. triage meaningful change
3. inspect or update Account Brief
4. review proposed action
5. handle replies or exceptions
6. trust the CRM commit and history log

That is the product.

Everything else is optional until this feels sharp.

## The interrupt journey

The operator will not always begin inside Exo.

A second important journey is:

1. receive a high-signal alert in Slack, email, or another operating surface
2. understand why the alert matters
3. take a lightweight action there or jump into Exo
4. complete the deeper review or approval in the control room when needed

This journey should be designed deliberately.

## Alerting rule

Alerting is part of the experience, but it is not the whole interface.

The right pattern is:

- ambient alert outside the app
- decisive action or deeper inspection inside Exo

In some cases, a lightweight approval can happen from Slack or another surface.
But Exo must still own the state transition and history.

## The reconciliation journey

The operator will also create off-platform drift.

A third critical journey is:

1. activity happens in LinkedIn, email, CRM, or another surface outside Exo
2. Exo detects the drift through audit or external-state observation
3. Exo repairs simple state automatically when safe
4. Exo escalates ambiguous drift for operator judgment
5. the history reflects what was discovered and how it was resolved

This is part of the product experience, not just background plumbing.

## What to avoid

Do not start by asking:

- what are all the tables?
- what permissions model do we need someday?
- how many integration types should exist?
- how do we support every workflow?

Those questions will drag the team toward platform-thinking before the product experience exists.

## Practical build implication

Before building backend depth, Exo should have:

- a clear screen model
- sample operator flows
- example outputs for each flow
- testable low-fidelity screens

Then the state model should be derived from the minimum necessary support for those flows.

## Hard test

The test is not:

- "does the data model look elegant?"

The test is:

- "can a strong operator sit in Exo for an hour and feel materially more capable than they do with chat, tabs, CRM, and notes?"

That is the bar.
