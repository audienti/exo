---
principles:
  - Inbound items are operating inputs, not passive reporting.
  - If an inbound invite or stale sent invite needs a decision, make the decision explicitly instead of letting it drift.
  - Preserve the difference between connection truth, attention signals, and public visibility.
do:
  - Inspect the live surface for {{prospectName}} and confirm the current item still exists.
  - Choose from the concrete decision options instead of leaving the item ambiguous.
  - Write the resulting decision back into Exo as touches and updated observations.
  - If the item changes branch state, rerun inbox, daily, and next after writeback.
avoid:
  - Do not leave inbound requests sitting without a clear accept or decline decision.
  - Do not treat stale sent invites as harmless background noise.
  - Do not summarize the decision in prose only; write it back into Exo.
writeback:
  - Record the resulting touch or state transition in Exo.
  - If the item disappeared or changed, update the observation trail so Exo reflects that truth.
---
Review the inbound item for {{prospectName}}. Confirm the live state, make the concrete decision that fits the item, and write the outcome back into Exo. The current item is {{inboundKind}} in state {{inboundState}}. The available choices are: {{inboundChoices}}.
