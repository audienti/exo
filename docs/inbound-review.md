# Inbound Review

Exo inbound review is the management surface over inbound state.

It exists because a quiet inbox is not enough.
After a sync, the operator needs to know:

- which surfaces were actually checked
- which ones were quiet
- which concrete items need a decision
- which sent invites are old enough to review for withdrawal
- which surfaces counted items but did not write back the actual objects

## What inbound review does

Inbound review combines:

- enabled surface state from inbound sync
- normalized inbound observations
- motion, company, and prospect context when it exists

It answers:

- do I have inbound invites to accept or decline
- do I have stale sent invites to withdraw
- do I have live replies to answer
- do I have attention signals to review
- did the agent fail to itemize a surface even though sync saw items there

## What inbound review does not do

Inbound review does not:

- scrape LinkedIn or Gmail by itself
- replace `exo daily`
- replace `exo next`
- invent concrete item rows when the sync only wrote counts and no observations

If sync says a surface had items but there are no matching observations, inbound review now calls that out as an itemization gap.

## CLI

```bash
exo inbound review <user-id>
exo inbound review <user-id> --capability linkedin --json
exo inbound review <user-id> --account <account-id> --json
```

## Design rule

Use:

- `exo inbox` for the ranked delta/triage feed
- `exo inbound review` for the management question: what is sitting on each inbound surface right now and what needs a decision
- `exo daily` for the broader operator agenda
