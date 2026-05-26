# Spreadsheet-Derived Model

## Position

The three trackers are not temporary working files.

They are the clearest evidence of the current operating model Exo must replace:

- [knitit-target-tracker.xlsx](/Users/williamflanagan/Downloads/knitit-target-tracker.xlsx)
- [actico-target-tracker.xlsx](/Users/williamflanagan/Downloads/actico-target-tracker.xlsx)
- [actico-bnpl-tracker.xlsx](/Users/williamflanagan/Downloads/actico-bnpl-tracker.xlsx)

All three share the same 47-column row shape.

That means there is already a de facto schema.
Exo should not invent a new workflow from scratch.
It should normalize and operationalize the one these trackers already express.

## What the trackers prove

### 1. The row is the current unit of execution

Each row currently bundles:

- targeting
- account selection
- stakeholder selection
- personalization angle
- engagement plan
- draft sequence
- execution history
- outcome state
- next action

That is too much for one flat record, but it is exactly what Exo must support.

### 2. A motion produces tiered work, not one homogeneous list

The work is already grouped into tiers:

- `Tier 1 — Deep personalized`
- `Tier 2 — Deep personalized`
- `Tier 3 — Compact`
- `Tier 4 — Director level` / `Tier 4 + Director`
- companion sheets like `VMO Companions`

This means Exo needs first-class support for:

- personalization depth
- research depth
- companion stakeholders
- different execution logic by tier

### 3. A motion can have multiple segments inside it

The Actico trackers make this explicit:

- the core tracker has segment codes like `A`, `B`, `C`
- the BNPL tracker has combinations like `A+B`, `B+C`, `A+B+C`

That means one offer can legitimately branch into multiple market or industry segments.
Exo should represent those as segment variants inside a motion, not as accidental text in a spreadsheet cell.

### 4. The sequence is already standardized

Every row assumes a sequence shape:

- engagement plan
- connection request
- InMail
- email 1
- email 2

plus execution tracking:

- sent dates
- accepted / replied flags
- meeting booked
- meeting date
- deal stage

Exo should treat this as a structured action plan and outcome ledger, not as a freeform note.

### 5. Verification and next action are core, not optional

The trackers include:

- `Verification Flag`
- `LinkedIn Activity Level`
- `Notes`
- `Next Action`
- `Next Action Date`

This proves the current motion is not "generate a list and blast it."
It is a governed operator workflow with explicit research gaps, verification, and queued follow-up.

## The shared 47-column schema

The current trackers consistently include fields like:

- identity and targeting:
  - `#`
  - `Tier`
  - `Region`
  - `Country`
  - `Segment`
  - `Company`
  - `Named Contact`
  - `Title`
  - `Tier Level (Exec/Director)`

- evidence and retrieval:
  - `LinkedIn URL`
  - `Mutual Connection`
  - `Hook / Personalization Angle`
  - `Verification Flag`
  - `LinkedIn Activity Level`

- plan:
  - `Engagement Plan`
  - `Engage 1/2/3 Date`
  - `Engage 1/2/3 Type`
  - `Engage 1/2/3 Post/Content`
  - `Connection Request Text`
  - `InMail Text`
  - `Email 1 Text`
  - `Email 2 Text`

- execution and outcomes:
  - `Conn Req Sent Date`
  - `Conn Status`
  - `Conn Accepted Date`
  - `InMail Sent Date`
  - `InMail Response`
  - `InMail Reply Date`
  - `Email 1 Sent Date`
  - `Email 1 Replied`
  - `Email 1 Reply Date`
  - `Email 2 Sent Date`
  - `Email 2 Replied`
  - `Email 2 Reply Date`
  - `Meeting Booked`
  - `Meeting Date`
  - `Deal Stage`

- operator control:
  - `Status`
  - `Notes`
  - `Next Action`
  - `Next Action Date`

This is the real starting point for Exo.

## How Exo should normalize it

The spreadsheet row should become multiple linked Exo objects.

### 1. `motion`

What the spreadsheet currently spreads across workbook name, sheet name, tier, region, country, and segment.

Should contain:

- offer
- targeting profile
- suppression policy
- segment variants
- tier policy

### 2. `target_account`

What the spreadsheet currently stores as:

- company
- region
- country
- segment
- tier

Should contain:

- account identity
- segment membership
- evidence for inclusion
- current state

### 3. `stakeholder`

What the spreadsheet currently stores as:

- named contact
- title
- LinkedIn URL
- mutual connection
- activity level

Should contain:

- current title and profile reference
- stakeholder role in the motion
- verification state
- relationship surface

### 4. `through_line`

What the spreadsheet currently stores as:

- hook / personalization angle
- engagement plan

Should contain:

- angle
- persona register
- evidence basis
- prediction
- anti-patterns / what not to say

### 5. `sequence_plan`

What the spreadsheet currently stores as:

- connection request text
- InMail text
- email 1 text
- email 2 text
- engagement steps

Should contain:

- ordered actions
- draft artifacts
- dependencies
- expected outcomes

### 6. `execution_log`

What the spreadsheet currently stores as:

- all sent dates
- reply dates
- meeting booked
- meeting date
- deal stage

Should contain:

- executed action events
- observed outcomes
- prediction checks
- meeting conversion status

### 7. `operator_queue_item`

What the spreadsheet currently stores as:

- status
- notes
- next action
- next action date

Should contain:

- open operator task
- due date
- blocking condition
- review or verification requirement

## What this means for CLI/MCP

The CLI and MCP should not try to reproduce a spreadsheet cell-for-cell.

They should reproduce the operator motions the spreadsheet is currently encoding:

- define the motion
- build the target map
- verify or enrich stakeholders
- inspect the through-line
- generate or revise the sequence plan
- record execution
- record outcomes
- queue the next operator action

## What the spreadsheets say the first Exo commands really are

The trackers imply these early commands:

- `exo define-motion`
- `exo build-target-map`
- `exo show-target <account>`
- `exo verify-stakeholder <person>`
- `exo draft-sequence <target>`
- `exo record-send <action>`
- `exo record-reply <action>`
- `exo book-meeting <target>`
- `exo queue`

The current docs already cover the broader contract.
This file is the bridge between the existing spreadsheets and that contract.

## Bottom line

The spreadsheets prove that Exo is not a hypothetical future UI.

Exo is the normalization of a workflow you already run manually:

- motion definition
- tiered target selection
- stakeholder research
- hyperpersonalized sequence planning
- execution tracking
- meeting conversion
- next-action control

That is the product.
