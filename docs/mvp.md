# MVP

## Core promise

For one operator running outbound or account-based pipeline work:

- watch a defined account list
- surface real signal
- assemble account context
- propose next action
- route that proposal through review
- track what happened
- write back the outcome

If Exo can do that cleanly, the product is real.

## Narrow scope

### Users

- 1 primary operator
- optional 1 reviewer / approver

### Channels

- LinkedIn
- email

### CRM

- HubSpot only

### Signal classes

- company events
- hiring changes
- role changes / champion movement
- account revisit or activity signals
- manually-added strategic accounts

## MVP surfaces

### 1. Signal Inbox

Purpose:

- show what changed
- collapse duplicates
- attach evidence
- rank likely relevance

Actions:

- ignore
- snooze
- escalate
- create or update account brief
- request draft

### 2. Account Brief

Purpose:

- one shared object per account
- company context
- recent signals
- relevant people
- prior touches
- current hypothesis
- suggested next move

Actions:

- update hypothesis
- attach notes
- request outreach draft
- mark not now

### 3. Review Queue

Purpose:

- proposed outbound actions waiting on judgment
- approvals become the unit of work

Each item should show:

- target
- triggering signal
- supporting evidence
- draft action
- risk and policy status
- recommended send path

Actions:

- approve
- edit
- reject
- defer
- assign human takeover

### 4. Reply Triage

Purpose:

- classify replies and reactions
- propose next move
- create CRM-ready update

Actions:

- accept recommendation
- rewrite response
- mark unsubscribe / wrong person / objection / positive
- create follow-up task

### 5. CRM Commit Log

Purpose:

- show what was written back
- preserve audit trail
- keep shared state trustworthy

## First-class objects

- `account`
- `contact`
- `signal`
- `evidence`
- `brief`
- `proposed_action`
- `approval`
- `outcome`

## What can stay manual in v1

- signal tuning
- source selection
- edge-case research
- prompt updates
- exception handling
- data cleanup

The test is not full autonomy.

The test is whether the operator becomes dramatically more effective.

## Success criteria

- one operator can manage 100-250 target accounts without losing state
- time from signal to review-ready action drops sharply
- reply handling stops living across inboxes, notes, and chat threads
- every customer-facing action has visible evidence and approval history
- HubSpot updates happen as part of the work, not in cleanup mode later

## Explicitly not MVP

- self-serve onboarding
- multi-tenant billing complexity
- Salesforce parity
- giant settings panels
- a general workflow builder
- broad analytics suite
- autonomous send-everything mode

