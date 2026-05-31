# User-Centered Execution Ownership Design

## Status

Drafted from operator review on 2026-05-31. This spec defines the ownership and resolution contract for execution work in Exo. It does not implement it.

## Problem

Exo already has motions, companies, execution users, browser profiles, connected accounts, planner surfaces, and execution-resolution helpers. The product risk is not missing nouns. The risk is semantic drift:

- motions can start to look like the unit of work
- browser profiles can start to look like ownership
- planner surfaces can start to guess context instead of proving it
- operator surfaces can lead with generated motion names instead of the premise that justifies the work

That produces fake clarity. Exo needs one execution model that every planner, assignment, and transport surface consumes.

## Goals

- Make the execution user the real unit of work.
- Keep motions as strategy objects, not execution objects.
- Keep canonical companies as the durable ownership target.
- Make context resolution strict, legible, and non-heuristic.
- Remove pointless ceremony when only one execution user exists without hiding the active context.
- Lead operator-facing surfaces with the premise, not the generated motion name.

## Non-Goals

- Redesign all CLI verbs from scratch.
- Add a new browser-control system.
- Add new live retrieval channels.
- Introduce branch-level ownership exceptions.

## Approaches Considered

### 1. Hard global company owner

One canonical company has one execution user everywhere. Motions can suggest the initial owner, but the canonical company owner is the durable assignment.

Pros:

- simplest operator model
- keeps planner work user-centered
- eliminates branch-level ownership ambiguity

Cons:

- reassignment affects every motion that references the company

### 2. Per-company-in-motion owner

Each company branch inside each motion owns its own execution assignment.

Pros:

- more local flexibility

Cons:

- ownership becomes harder to reason about
- planner trust degrades fast

### 3. Global owner with branch overrides

Canonical company ownership exists, but branches can diverge.

Pros:

- feels flexible

Cons:

- exceptions become the real model
- resolution logic rots quickly

## Recommendation

Use a hard global company owner.

The model is:

- motion owns strategy
- canonical company owns execution assignment
- execution user owns capacity and action rights
- profiles and accounts are execution surfaces attached to the user

This keeps Exo honest about what work actually is: users do work against companies using motion context.

## Core Model

### Object roles

- `motion`: a signal container built around a premise, audience hypotheses, and targeting logic
- `company`: the canonical execution target
- `user`: the unit of work
- `profile` or connected `account`: a capability surface reachable through a user

Motions justify work. Users do work. Companies hold durable execution assignment.

### Ownership model

- A canonical company has exactly one execution user at a time.
- That ownership is global across all motions that reference the company.
- A motion may define a default execution user.
- The motion default is a seeding/default mechanism, not a competing ownership layer.
- Wrong-user execution is hard-blocked.
- Ownership changes only through explicit reassignment.

### Assignment rules

1. If a company already has a canonical owner, that owner wins everywhere.
2. If a company is unowned and a motion has a default execution user, the company may inherit that user for execution resolution without silently converting that inherited state into a canonical company owner record.
3. If a company is unowned and the motion has no default user, the company remains unowned and Exo records an `assignment_gap`.
4. If the operator later assigns the company explicitly, the explicit company assignment becomes authoritative everywhere.

## Resolution Contract

Exo should resolve execution in this order:

1. canonical company owner
2. motion default execution user
3. unassigned

That result is the only valid ownership resolution path for planner and execution surfaces.

Profiles remain secondary. They may inform transport selection, but they do not outrank user ownership and they do not create a parallel ownership model.

## Planner Behavior

Planner behavior should be user-first, not motion-first.

- `exo daily` is fundamentally a user queue.
- `exo next` is fundamentally the next move for a user.
- Planner surfaces should rank work across the companies owned by the resolved user.
- Motion context can still shape why a branch matters, but it is not the primary execution unit.

### Required behavior

- `exo daily --user <user-id>` remains the primary explicit operating surface.
- `exo next --user <user-id>` returns the strongest governed move for that user across owned companies.
- If no executable work exists, Exo returns a truthful idle or gap state instead of inventing motion work.
- Unowned companies are not executable work. They are assignment gaps.
- Companies owned by another user are not normal planner items for the current user.

## Context Resolution and UX

Exo should reduce typing only when the resolution is trivial. It must never reduce legibility.

### Singleton-user convenience rule

If exactly one execution user exists in state:

- planner and read surfaces may auto-resolve that user
- the resolved user must still be shown explicitly in the output

This applies to planner and read surfaces such as:

- `daily`
- `next`
- `inbox`
- inbound review

This does not erase assignment gaps or ownership rules.

### Ambiguity rule

If context is ambiguous, Exo fails for clarification.

- No heuristic guessing.
- No silent reassignment.
- No "probably meant this" behavior.

If more than one execution user exists and the user is not explicit on a user-scoped surface, Exo should fail and show candidate users.

If a command depends on company or motion context and that context is ambiguous, Exo should fail before execution.

### Visible context block

Relevant operator-facing surfaces should show:

- `Execution User`
- `Company`
- `Premise`
- `Assignment Source`
- `Capability`
- `Resolution Status`

This is how singleton convenience avoids becoming hidden state.

## Premise-First Operator Surfaces

Generated motion names are storage handles, not meaningful operator labels.

Operator-facing surfaces should:

- lead with the premise or a compact premise summary
- hide the motion name by default
- show motion name or id only when needed for command copy, debugging, or disambiguation

This applies to:

- `daily`
- `next`
- execution views
- assignment-gap views
- other operator-facing planner surfaces

The operator should see the reason for the work, not `plum-orange-gazelle`.

## Command Semantics

This spec should preserve the existing command family where possible and tighten its meaning.

### Motion default assignment

`exo motion user assign <motion-id> --user <user-id> --reason "..."`

- sets the motion default execution user
- does not create a second competing ownership layer
- serves as the seeding identity for unowned companies entering the motion

### Canonical company ownership

`exo companies user assign <company-id> --user <user-id> --reason "..."`

- sets or changes the authoritative company owner
- governs execution across all motions referencing that company

### Canonical execution explanation

`exo companies execution show <company-id> [--motion <motion-id>] --capability <capability> --json`

This is the canonical resolution surface. It should expose:

- resolved execution user
- assignment source: `company-user`, `motion-default-user`, or `unassigned`
- resolved capability/account path for that user
- blocking reason when execution is not possible

### Off-owner execution

Any command that implies concrete execution or execution planning must check ownership first. Wrong-user execution should hard-fail and name the owning user.

## Failure States

Exo may allow partially configured strategy state. It must not pretend partially configured execution state is runnable.

Required failure classes:

- `assignment_gap`: no company owner and no motion default user
- `wrong_user`: acting user does not own the company
- `capability_gap`: owning user exists but lacks the required execution path for the requested capability
- `ambiguous_context`: user, company, or motion context is not uniquely resolvable

Behavior rules:

- assignment gaps appear as management problems, not executable tasks
- capability gaps do not silently fall back to another user
- ambiguity fails before execution
- reassignment is an explicit governance event

## Implementation Boundary

This should be implemented as one central policy contract with many consumers, not as scattered command-specific shortcuts.

### Existing seams to harden

- `src/core/assign-motion-user.js`
- `src/core/assign-company-user.js`
- `src/core/resolve-scoped-execution-assignment.js`
- `src/core/build-company-execution-view.js`
- `src/core/build-daily-view.js`
- `src/core/build-next-view.js`
- planner, inbox, and inbound review surfaces that currently resolve user context

### Refactor direction

- keep `assign-motion-user` as the motion-default setter
- keep `assign-company-user` as the canonical ownership setter
- simplify `resolve-scoped-execution-assignment` around user ownership first
- demote profile assignment to derived transport guidance rather than first-class ownership fallback
- route planner and execution surfaces through one strict resolution algorithm

## Acceptance Criteria

1. Company owner beats motion default everywhere.
2. Motion default only seeds unowned companies.
3. Unowned company plus no motion default yields `assignment_gap`.
4. Planner/read surfaces auto-resolve a singleton execution user and show that context explicitly.
5. Planner/read surfaces fail on omitted user context when multiple execution users exist.
6. Company/action surfaces fail on ambiguous company or motion context.
7. Wrong-user execution hard-fails.
8. Missing capability on the owning user yields `capability_gap`, not silent fallback.
9. Premise is the primary operator-facing label; motion name is hidden by default.
10. `companies execution show` becomes the trusted explanation surface for resolution output.

## Tradeoff

The hard-global-company-owner model sacrifices some branch-level flexibility. That is intentional. Exo is supposed to be a governance layer. Simpler, stricter ownership is more valuable than local exception-handling freedom that the planner cannot reliably explain.
