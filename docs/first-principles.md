# First-Principles Design

## Purpose

This document defines Exo from first principles.

It is not a feature list.
It is not a roadmap.
It is the set of constraints that should shape the MVP before implementation details start distorting the product.

## Principle 1: The product begins with change in the world

Exo does not begin with campaigns, sequences, or workflows.

It begins with:

- a new signal
- a change in account state
- a reply
- a shift in relevance
- a decision that now needs to be made

If the product starts from setup instead of change, the frame has already gone wrong.

## Principle 2: Operator attention is the scarce resource

Models are getting cheaper.
Research is getting cheaper.
Drafting is getting cheaper.

The scarce thing is operator attention.

Exo must conserve it by:

- filtering noise
- ranking relevance
- surfacing only meaningful decisions
- preserving enough context to avoid rework

## Principle 3: The unit of value is a better decision

The product does not win by producing more data.
It wins by helping the operator make better decisions faster.

The most important decisions in the MVP are:

- ignore or pay attention
- update the brief or not
- approve, edit, reject, or defer the proposed action
- respond, escalate, or hand off the reply
- commit the outcome to the system of record

If a screen does not help the operator make one of those decisions, it is probably unnecessary.

## Principle 4: Outputs matter more than records

The operator does not wake up wanting clean objects.

The operator wants useful outputs:

- a ranked signal worth caring about
- a usable account brief
- a review-ready proposed action
- a classified reply with a next step
- a trusted CRM commit
- a visible comparison between prediction and outcome

Records exist to support those outputs.
They are not the product surface.

## Principle 5: Evidence comes before inference, inference before action

The sequence must be:

1. observed evidence
2. interpretation or hypothesis
3. prediction
4. proposed action
5. reviewed action
6. committed outcome
7. comparison against reality

If Exo skips evidence and jumps straight to action, it becomes AI theater.

Every meaningful action should carry an explicit prediction.
When the work completes, Exo should compare the predicted outcome to the observed outcome and expose that comparison so judgment can improve.

## Principle 6: Approval is the center of the workflow

Exo is not a drafting tool.
Exo is not a composition studio.

It is a control room.

That means the highest-leverage user action is not writing from scratch.
It is:

- approving
- editing and approving
- rejecting
- deferring
- escalating

The product should make those actions feel obvious and fast.

## Principle 7: The system should be exception-driven

Routine work should disappear into the background.

The operator should be pulled toward:

- anomalies
- meaningful change
- proposals waiting on judgment
- replies that need classification or handoff
- state conflicts

If the product requires the operator to scan raw exhaust all day, it has failed.

## Principle 8: Shared context must survive tool boundaries

The current problem is not lack of intelligence.
The problem is fragmentation.

Exo must preserve:

- why an account matters
- what happened recently
- what was proposed
- what was approved
- what the reply meant
- what got written back

The operator should not have to reconstruct that from chat logs, tabs, and memory.

## Principle 9: Drift is normal, reconciliation is mandatory

Exo should assume that important work will happen outside Exo.

Examples:

- the operator replies directly in LinkedIn
- the operator sends a manual email
- the contact replies in another surface
- CRM state changes outside the Exo workflow

That means the system cannot rely only on intended actions.
It must also observe actual state and reconcile differences.

Exo needs a recurring audit and reconciliation loop that can:

- inspect external communication surfaces
- detect divergence from expected state
- pull the system back into alignment
- preserve a history of what was discovered and repaired

If Exo cannot recover from off-platform activity, trust collapses.

## Principle 10: The interface should feel like mission control, not administration

The product should feel like:

- triage
- supervision
- decision
- handoff
- verification

It should not feel like:

- configuration
- setup
- database browsing
- workflow plumbing

If the first emotional response is "I need to learn the system," the design is already drifting.

## Principle 11: Control can travel, authority stays in Exo

The operator will not always be sitting inside the Exo web app.

They may be in:

- Slack
- email
- calendar
- mobile
- another operating surface

That is fine.

Exo should be able to alert and route lightweight decisions into those surfaces.

But the authority structure should remain anchored in Exo:

- Exo is the source of truth
- Exo owns the state transition
- Exo records the history
- Exo remains the deep surface for inspection and intervention

The mistake would be to confuse notification surfaces with the product itself.

## Principle 12: Start narrow and deep

The MVP should solve one loop well:

`signal -> brief -> proposed action -> review -> reply -> CRM commit`

That is enough.

Do not widen early into:

- more channels
- more CRMs
- bigger teams
- broader signal classes
- heavier analytics

Breadth is a tax on sharpness.

## Principle 13: State is derived from experience, not the other way around

The system still needs a strong state model.
But the state model should be derived from:

- what the operator must see
- what the operator must decide
- what output must be produced

Not from abstract backend neatness.

The correct dependency order is:

1. operator journey
2. screen purpose
3. output artifact
4. available decisions
5. minimum required state

## Principle 14: Trust beats automation volume

An operator will keep using Exo if it is trustworthy.

Trust comes from:

- visible evidence
- durable history
- clear state transitions
- predictable review flow
- reliable CRM commit

Trust does not come from saying the word "autonomous" a lot.
It also comes from showing whether Exo's predictions were actually useful.

## Principle 15: Alerts should be sparse, ranked, and actionable

An alert should exist only when one of these is true:

- something materially changed
- a decision is waiting on judgment
- a reply or exception needs prompt handling
- a workflow is blocked or failed

Alerts should not be:

- a duplicate activity stream
- vanity notifications
- generic "something happened" pings

The operator should be able to trust that an Exo alert means attention is warranted.

## Design test

Every proposed feature should be tested against these questions:

1. Does this help the operator orient faster?
2. Does this improve a real decision?
3. Does this produce a useful output?
4. Does this reduce fragmentation or just add more surface area?
5. Does this make the system more trustworthy?

If the answer is mostly no, the feature should wait.

## Product consequence

From these principles, the MVP should be built around five surfaces:

- Inbox
- Account
- Review
- Replies
- History

Those are not arbitrary.
They map to the natural decisions and outputs of the operator's day.

## Hard conclusion

Exo should not be designed as a tool that "does outbound."

It should be designed as a system that:

- detects change
- preserves context
- makes explicit predictions
- proposes action
- routes judgment
- compares predicted outcomes to actual outcomes
- helps the operator learn and improve
- records outcomes

That is the first-principles shape of the product.
