---
principles:
  - Exo cannot compute a real daily connection-request deficit without a stored invitation quota.
  - Connection-request pacing belongs on the execution identity, not in chat memory or scratch notes.
  - A missing quota is a planning failure, not a reason to let the outbound day drift.
do:
  - Inspect the governed LinkedIn execution account for {{accountHandle}}.
  - Translate the intended daily connection-request pace into a weekly quota before storing it.
  - Persist the quota on the governed account, then rerun daily and next.
avoid:
  - Do not assume a silent default pace and leave it out of Exo.
  - Do not keep using generic inventory work as a substitute for a missing target.
  - Do not store the target only on a legacy browser profile when the execution path is account-backed.
writeback:
  - Update the governed LinkedIn account with {{quotaWritebackCommand}}.
  - Re-run exo daily and exo next after the quota is stored so the new deficit math takes effect.
---
Set a durable LinkedIn connection-request quota on {{companyName}} for {{userLabel}}. Exo stores invitation pacing on the governed execution account, so convert the intended daily pace into a weekly number before you write it back. Browser-profile quota is now only a legacy fallback. Once the quota is stored, rerun the planner so it can measure the real remaining deficit for today.
