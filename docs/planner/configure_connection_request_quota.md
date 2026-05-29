---
principles:
  - Exo cannot compute a real daily connection-request deficit without a stored invitation quota.
  - Connection-request pacing belongs on the execution identity, not in chat memory or scratch notes.
  - A missing quota is a planning failure, not a reason to let the outbound day drift.
do:
  - Inspect the claimed LinkedIn execution profile for {{accountHandle}}.
  - Translate the intended daily connection-request pace into a weekly quota before storing it.
  - Persist the quota on the claimed browser profile, then rerun daily and next.
avoid:
  - Do not assume a silent default pace and leave it out of Exo.
  - Do not keep using generic inventory work as a substitute for a missing target.
  - Do not store the target anywhere except the claimed execution profile.
writeback:
  - Update the claimed profile with exo profiles claim {{profileId}} --max-connection-requests <weekly-count> --json.
  - Re-run exo daily and exo next after the quota is stored so the new deficit math takes effect.
---
Set a durable LinkedIn connection-request quota on {{profileLabel}} for {{userLabel}}. Exo stores invitation pacing as a weekly quota on the claimed browser profile, so convert the intended daily pace into a weekly number before you write it back. Once the quota is stored, rerun the planner so it can stop guessing and start measuring the real remaining deficit for today.
