# Daily

Exo daily is the planner surface over:
- prospect cadence
- inbound observations
- the next move that is actually justified now

It is not a scraper.
It is not a feed.
It is not a background scheduler.

It is the operator agenda for:
- what is due now
- what is still waiting
- what inbound movement overrode the old plan

## Current scope

Today Exo daily works from stored state:
- ready prospect cadence
- normalized inbound observations
- inbound review decisions and itemization gaps
- company-to-user assignment
- profile-level connection-request quotas for deficit math when they are configured

That means the agent still has to:
- inspect live surfaces
- write back the observations
- then ask Exo for the updated agenda

## Commands

```bash
exo daily --user <user-id>
exo daily --user <user-id> --json
exo daily --user <user-id> --motion <motion-id> --json
```

## Current behavior

Exo daily currently distinguishes:
- reply priority
- action priority
- wait priority
- due now
- waiting until
- overridden by inbound
- advanced by inbound
- outbound-capacity configuration gaps
- daily connection-request deficits

Examples:
- a live reply overrides the old follow-up branch and turns the next move into a reply
- a connection acceptance advances the branch into the first post-accept direct message
- a future due date stays waiting until the planned time
- a missing LinkedIn invitation quota becomes a configuration task
- a daily invitation shortfall becomes a concrete send/build target instead of vague inventory advice

Each daily item now also carries doc-backed planner guidance from `docs/planner/`:
- a task prompt for the agent
- do/avoid rules
- writeback expectations
- the source guidance document path for editing

## Not implemented yet

Exo daily still does not:
- retrieve LinkedIn or email state by itself
- do automatic multi-surface reconciliation beyond stored observations
- enforce full multi-surface send capacity beyond stored LinkedIn invitation deficit math
- drive unattended execution

Those belong to the next inbound and execution slices.
