---
principles:
  - Selected prospects are still backlog, not ready execution.
  - One selected prospect should travel as one coherent packet through research, enrichment, through-line, opening-plan, and cadence work.
  - A prospect packet is not done just because a name was chosen; it is done when the branch is genuinely ready or intentionally suppressed.
do:
  - Open the first packet contract with `exo motion packet-brief {{firstClaimableProspectResearchPacketMotionId}} --packet {{firstClaimableProspectResearchPacketId}}` before you start, so the worker sees the exact scope and writeback path.
  - Claim the selected prospect packet before splitting work across agents.
  - Keep role truth, trigger window, identity tells, live signal, contact enrichment, through-line, opening plan, and cadence work together on the same prospect.
  - If the branch becomes genuinely ready, make sure the stored through-line, opening plan, and cadence state reflect that before completing the packet.
  - If the branch should stop, complete it into suppressed or exhausted state explicitly.
avoid:
  - Do not split one prospect into five microtasks that all touch the same record independently.
  - Do not complete the packet while leaving durable findings outside Exo.
  - Do not mark a branch ready unless the stored artifacts actually support execution.
writeback:
  - Persist all new prospect research and enrichment into the same Exo prospect record.
  - Complete the packet only after the prospect state reflects the real result: ready, suppressed, or still selected for another pass.
---
Claim the selected prospect packets for {{motionName}} and carry each one through the real prospect work as one coherent unit. Use `exo companies prospects claim` to take ownership, keep all durable findings on that single prospect record, and complete the packet only after the branch is truly ready or intentionally stopped.
