# First Motion: Offer to Motion Plan

## Position

The first Exo motion is not inbox triage.

That is downstream.

The first Exo motion is:

`offer -> custom signals -> target accounts -> impacted people -> action logic`

This is the motion that triggered the Audienti crisis.
It is also the first Exo surface worth building.

## Why this is first

The operator starts with a product, offer, or URL.

They need Exo to answer:

1. What problems does this offer actually solve?
2. What externally verifiable signals suggest a company has that problem now?
3. Which companies match those signals?
4. Which people inside those companies are most affected?
5. What is the correct opening motion for each cluster?

That is not "generate a message."
That is define the market motion.

## Inputs

The MVP should accept:

- product or offer URL
- optional offer notes
- optional geolocation constraints
- optional ICP profile
- optional industry or sub-industry constraints
- optional company-type constraints
- optional company-shape constraints
- optional company-size constraints
- optional named target titles or role families
- optional segment definitions
- optional account exclusions
- optional domain exclusions
- optional do-not-contact lists
- optional suppression rules

Examples:

- `focus on USA, Canada, Australia`
- `focus on North America, APAC, or EMEA`
- `only banks and lenders`
- `split traditional FI vs BNPL`
- `prioritize CRO, VP Sales Development, VP Marketing`
- `only mid-market fintechs above 500 employees`
- `focus on PE-backed rollups, regulated incumbents, or API-first growth companies`
- `exclude existing named accounts`
- `exclude @customer.com domains`
- `respect do-not-contact records before building the list`

This is not optional polish.
The operator must be able to shape the motion intentionally.

At minimum, the first motion should support explicit suppression from day one:

- excluded accounts
- excluded domains
- excluded people
- do-not-contact records

Future feature:

- query the CRM and suppress companies or contacts that are already customers before they enter the target map

## Step 1: Offer understanding

Exo should derive from the URL:

- what the product is
- what business problem it solves
- what change it creates
- what kinds of organizations are likely to care
- what kinds of people are likely to feel the pain

This should not become generic website summarization.

The output should be a working `offer thesis`:

- problem thesis
- buyer impact thesis
- likely trigger thesis
- likely role thesis
- likely segment thesis

## Step 2: Custom signal definition

Exo should then generate the top custom externally verifiable signals that suggest need.

These signals should be:

- specific
- externally observable
- plausibly recent
- tied to the problem, not generic growth fluff

Examples of signal classes:

- hiring pattern
- regulatory event
- business-model shift
- system change
- operating-model complexity
- expansion into a harder segment
- leadership change in a relevant function

The output should be a `signal-set`.

## Step 3: Target map generation

Given the signal-set, Exo should generate a ranked `target map`.

That means:

- target companies
- target segments
- grouped by why they match
- grouped by motion angle where useful
- linked to evidence for the match

This should not be a raw list.

It should be organized into meaningful clusters, because the outreach logic depends on the cluster.

The target map should be able to support multiple segment tracks inside one motion.

Example:

- `traditional financial institutions`
- `buy now pay later providers`

Each segment can share the same offer while requiring different signals, different stakeholders, and different opening logic.

This is also the main retrieval seam.

In practice, Exo should be able to direct Claude/Codex to use the operator's existing tools to gather this data, especially:

- LinkedIn Sales Navigator
- the operator's browser session
- the operator's saved searches and lead lists

The important distinction is:

- Exo defines what to look for
- the harness uses the user's paid tools and sessions to go get it
- Exo stores the resulting target map and evidence

## Step 4: Impacted people

For each target account or cluster, Exo should identify:

- the most likely affected roles
- explicitly requested titles if the operator supplied them
- the likely owner
- adjacent stakeholders
- why each role should care

The output should be the beginnings of a stakeholder map, not just a CSV of names.

If the operator supplied title constraints, Exo should honor them.
If not, Exo should infer the likely stakeholder set.

This step should also be able to use the operator's Sales Navigator interface to:

- resolve likely people by title or role family
- verify current titles
- capture profile evidence
- collect likely owner and adjacent stakeholder candidates

## Step 5: Action logic

Given the offer thesis, signal-set, target map, and role map, Exo should produce a `motion plan`.

The motion plan should include:

- segment-specific motion variants
- outreach angle by cluster
- recommended first move
- follow-up logic
- what should not be said
- when human takeover is likely needed
- what outcome Exo predicts for the first move

That means one motion can legitimately contain multiple branches.

Example:

- one branch for `traditional FI`
- one branch for `BNPL`
- one branch for `risk/compliance stakeholders`
- another for `commercial modernization stakeholders`

This is the first real campaign-like artifact.

It is better described as a `motion plan` than a campaign, because the important thing is logic and sequencing, not just blast configuration.

## Outputs

The first motion should produce four durable artifacts:

1. `offer thesis`
2. `signal-set`
3. `target map`
4. `motion plan`

Those artifacts should preserve the targeting assumptions that created them:

- geolocation filters
- ICP profile
- industry filters
- company-type filters
- company-shape filters
- title filters
- segment definitions
- explicit exclusions
- do-not-contact suppressions

Those artifacts then feed the execution loop:

`motion plan -> proposals -> approvals -> execution -> outcomes -> reconciliation -> learning`

## CLI / MCP

This motion should be exposed identically in CLI and MCP.

### CLI

```bash
exo define-motion --url https://example.com/product --geo "USA,Canada" --industry "banking,lending" --titles "CRO,VP Sales Development"
exo define-motion --url https://example.com/product --geo "EMEA" --icp "regulated-enterprise" --company-shape "multi-brand,high-compliance"
exo define-motion --url https://example.com/product --segment "traditional-fi" --segment "bnpl"
exo define-motion --url https://example.com/product --exclude-account "Known Customer Co" --exclude-domain "customer.com" --dnc-file ./dnc.csv
exo refresh-motion motion_123
exo show-motion motion_123
```

### MCP

- `exo.define_motion`
- `exo.refresh_motion`
- `exo.show_motion`

## State objects added by this motion

The current Exo model needs four upstream objects:

- `offer`
- `signal-set`
- `target-map`
- `motion-plan`

And each motion should preserve its `targeting profile`:

- geolocations
- ICP types
- industries
- company types
- company shapes
- company sizes
- title targets
- segment variants
- explicit excludes
- do-not-contact suppressions

Without those, Exo starts too late in the workflow and misses the actual leverage point.

## What comes after

Once a motion plan exists, Claude/Codex should be able to execute against it through the same Exo contract:

- pull the next account from the target map
- open the brief
- propose the next move
- execute in sequence
- record outcomes
- reconcile drift
- update the motion as reality teaches it

So the first Exo motion is not the entire product.
It is the bootstrap layer that makes the rest of the product worth using.

## Retrieval model

The first Exo motion should assume a BYO-tool retrieval model.

That means:

- the user already pays for Sales Navigator
- the user already has a logged-in browser session
- Claude/Codex can operate that session through the existing harness
- Exo does not need to own a separate proprietary prospect database to be useful

This is one of the main economic advantages of the Exo architecture.
