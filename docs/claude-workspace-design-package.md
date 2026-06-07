# Exo Workspace Design Package for Claude

Use this when you want Claude to redesign the Exo workspace UI without changing the product model.

## Copy-paste prompt

```text
Design Exo as an operator workspace, not a report and not an admin panel.

The current workspace opens with too much narration and too many report-style cards.
The redesign should make the root feel like a working app: list-first, action-first, low-noise, and easy to scan.

The root should focus on:
- decision lists that are easy to execute visually
- seeing all prospects in a motion
- clicking through to LinkedIn profiles and company pages
- separating what the operator must decide from what the agent can do in the background

Do not collapse canonical records and derived status into the same thing.
Do not design around a flat object inventory like motions, users, companies.
Do not build a dashboard mosaic or report page.

Use the attached Exo workspace design package as the source of truth for:
- information architecture
- root layout
- component hierarchy
- status chips
- list row design
- empty/partial/error handling
- data constraints and unsupported fields

Return:
1. a root workspace redesign
2. left nav
3. main panel structure
4. row-level component specs for decisions, prospects, companies, execution, and truth
5. desktop and mobile behavior
6. explicit notes on how canonical state and derived status stay separate
```

## What the redesign is solving

The current workspace is directionally right in one way and wrong in another.

Right:

- it already starts from operator pressure
- it already exposes decisions and queue state
- it already exposes truth freshness

Wrong:

- it still reads like a report
- it still uses too many cards and too much explanation
- it still hides the real working surface inside summary panels
- prospects do not read like an app-grade list
- company and profile links are not front-and-center enough

The redesign should make the root feel like a product someone works from, not an exported workspace memo.

## Core product model

Exo has to keep canonical state separate from derived status.

### Canonical state

- motions
- companies
- prospects
- users
- connected accounts
- browser profiles
- observations
- cues
- reconciliation deltas

### Derived status

- next
- daily
- inbox
- inbound review
- workspace summaries
- blocked-ready
- stale or incomplete
- capacity pressure

Design rule:

Do not visually merge these into one generic status layer.

## Root information architecture

The root should be list-first.

Recommended top-level nav:

- Operator
- Motions
- Companies
- Prospects
- Execution
- Inbound Truth
- Workspace

Recommended root workspace sections:

1. Need decision
2. Agent queue
3. Motion prospects
4. Companies
5. Execution
6. Truth surfaces

The first screen should answer:

- what needs my decision right now?
- what can the agent do without me?
- which prospects are live or ready?
- which companies are in play?
- what execution identity is real?
- is the truth fresh enough to trust?

## Root layout requirements

The root should feel like an app shell, not a report page.

### At the top

Keep this compact:

- workspace title
- generated time
- focus motion
- a few useful counts only if they drive action

Do not use a hero block.
Do not open with prose.
Do not explain how the workspace was generated.

### Primary surface

The primary surface should be rows and grouped lists, not stacked narrative cards.

Recommended shape:

- left rail or top nav for domains
- main pane with executable lists
- secondary pane only for compact truth or queue context

### Root priority

The visual order should be:

1. operator decisions
2. live or ready prospects
3. agent-executable queue
4. company and execution context
5. truth freshness and reconciliation

## Required list-first surfaces

### 1. Need decision

This should be a real decision inbox.

Sub-groups should be visually distinct:

- accept or decline inbound connection requests
- reply-needed items
- reconciliation-needed items

Each row should support:

- avatar or avatar fallback
- person name
- title
- company
- state chip
- observed or changed time
- primary action buttons
- direct profile link
- direct source-surface link

This should feel like triage, not a card gallery.

### 2. Motion prospects

This is the most important canonical working list on the root after decisions.

The prospect surface should be grouped by motion.
Inside each motion, prospects should look like list rows, not cards.

Each prospect row should support:

- avatar
- name
- title
- company
- motion context
- branch state
- truth or readiness chips
- next action
- link to LinkedIn profile
- link to company page
- link to company website when available
- live-signal link when available

The operator should be able to scan one motion and understand:

- who exists
- who is ready
- who is waiting
- who is blocked
- who has live engagement
- who needs enrichment

### 3. Companies

Companies should also render as rows, not summary tiles.

Each company row should support:

- logo or logo fallback
- company name
- motion
- queue status
- prospect count
- signal count
- execution identity state
- direct LinkedIn company link when available
- direct website link when available

### 4. Execution

This is not the same as motions or companies.

Show:

- execution user label
- connected account handle
- capability
- preferred or non-preferred
- surface counts
- blocked by assignment or blocked by capability when relevant

Important constraint:

Exo does not currently expose canonical public LinkedIn profile URLs for execution users or accounts.
Do not invent them.
If you show account-level links, they must be honest surface links such as inbox or invite manager, not fabricated identity links.

### 5. Truth surfaces

This should be explicit and compact.

Each truth row should support:

- account or capability label
- surface label
- truth status
- actionability
- last run status
- last checked or freshness
- item count
- recommended action

This is a first-class domain, not a footnote.

## Data and interaction constraints

Claude should design around what Exo actually has today.

### Available for decision rows

Decision items can already expose:

- `subject`
- `state`
- `options`
- `actorTitle`
- `actorCompanyName`
- `actorProfileUrl`
- `sourceUrl`
- `links[]`
- `actions[]`

Example live decision row:

```json
{
  "subject": "Princess Vinice Bolipata",
  "state": "needs_decision",
  "options": ["accept", "decline"],
  "actorTitle": "Growth Specialist at Audienti",
  "actorCompanyName": "Audienti",
  "actorProfileUrl": "https://www.linkedin.com/in/princess-vinice-bolipata-b131a8398/",
  "sourceUrl": "https://www.linkedin.com/mynetwork/invitation-manager/received/"
}
```

### Available for prospect rows

Prospect rows can already expose:

- `motionName`
- `companyName`
- `websiteUrl`
- `linkedinCompanyUrl`
- `companyLogoUrl`
- `name`
- `title`
- `linkedinProfileUrl`
- `avatarUrl`
- `queueStatus`
- `cadenceStatus`
- `contactEnrichmentState.status`
- `engagementLane`
- `dailyItem`
- `nextAction`
- `liveSignal.url`

Example live prospect row:

```json
{
  "motionName": "plum-orange-gazelle",
  "companyName": "Wiz",
  "websiteUrl": "https://www.wiz.io",
  "linkedinCompanyUrl": "https://www.linkedin.com/company/wizsecurity",
  "name": "Brian Spoljarick",
  "title": "AVP - AMER Growth",
  "linkedinProfileUrl": "https://www.linkedin.com/in/brian-spoljarick-90357320",
  "queueStatus": "ready",
  "contactEnrichmentState": { "status": "pending" },
  "engagementLane": { "key": "sent-pending", "label": "Sent / pending" },
  "nextAction": "Verify Brian live in the browser and send the first LinkedIn connection request once launch is approved."
}
```

### Available for company rows

Company rows can already expose:

- `motionName`
- `companyName`
- `websiteUrl`
- `linkedinCompanyUrl`
- `logoUrl`
- `queueStatus`
- `prospectCount`
- `signalMatchCount`
- `executionIdentity.status`

Example live company row:

```json
{
  "motionName": "plum-orange-gazelle",
  "companyName": "Wiz",
  "websiteUrl": "https://www.wiz.io",
  "linkedinCompanyUrl": "https://www.linkedin.com/company/wizsecurity",
  "queueStatus": "ready",
  "prospectCount": 2,
  "signalMatchCount": 4,
  "executionIdentity": { "status": "pinned-ready" }
}
```

### Available for execution and truth rows

Execution and truth rows can already expose:

- `capability`
- `handle`
- `preferred`
- `sourceType`
- `actionableSurfaceCount`
- `uncheckedSurfaceCount`
- `surfaces[]`

Surface rows can already expose:

- `label`
- `lastRunStatus`
- `lastItemCount`
- `recommendedAction`
- `meta.tone`
- `meta.chips`
- `meta.freshnessLabel`

Important limitation:

Execution accounts do not currently expose canonical public LinkedIn profile URLs.
Do not design a dependency on that data existing.

## Interaction contract

Claude should distinguish between:

### Real interactive actions already supported in Exo workspace serve mode

- refresh
- mark accepted
- mark declined
- some assignment and packet actions already exposed by workspace state actions

### Real external links already available

- LinkedIn prospect profiles
- LinkedIn company pages
- company websites
- source-surface URLs such as invites or messaging

### Not yet automatic

- clicking LinkedIn accept or decline directly from Exo
- sending connection requests from the workspace itself
- replying in LinkedIn from the workspace itself
- fabricating identity-specific execution-account profile links

The design should not blur these boundaries.

## Status system

Use three separate dimensions.

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

Do not compress all of these into one generic pill.

## Visual direction

This should look like an operator product.

It should feel:

- list-first
- dense but readable
- app-like
- calm
- direct
- low-noise

It should not feel:

- like a report
- like a dashboard card wall
- like a CRUD admin
- like a BI tool
- like a narrated status memo

## Things Claude should explicitly avoid

- large explanatory paragraphs in the root workspace
- opening with a hero or summary essay
- equal-weight cards for every domain
- hiding prospects behind motion summaries
- hiding truth inside a generic activity area
- requiring unsupported execution-user profile URLs
- using counts where row-level work is what matters
- collapsing canonical objects and derived status into the same panel

## Deliverables expected back from Claude

Ask Claude to return:

1. left nav
2. root workspace layout
3. desktop and mobile structure
4. row spec for decision items
5. row spec for prospect items
6. row spec for company items
7. row spec for execution items
8. row spec for truth-surface items
9. status chip system
10. empty, partial, and failed states
11. notes on which surfaces are canonical vs derived

## Useful local references

- Current interactive workspace: `http://127.0.0.1:4312/`
- Current renderer: `<repo-root>/prototype/build-motion-workspace.mjs`
- Existing IA brief: `<repo-root>/docs/workspace-redesign-brief.md`
