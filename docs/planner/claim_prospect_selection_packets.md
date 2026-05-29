---
principles:
  - Once an account is researched, the next governed unit of work is stakeholder selection, not more vague "inventory building."
  - Prospect selection should stay tight to the motion's stakeholder target count.
  - Claimed prospect-selection packets must survive writeback until they are explicitly completed.
do:
  - Inspect `exo motion packets <motion-id> --json` to see which researched accounts have claimable prospect-selection packets.
  - Claim the packet explicitly with `exo companies queue claim <company-id> --motion <motion-id> --worker <label>`.
  - Add the best-fit prospects to the motion-owned target account with `exo companies prospects add ...`.
  - Complete the packet with `exo companies queue complete <company-id> --motion <motion-id> --worker <label>` after the chosen prospect set is in Exo.
avoid:
  - Do not keep selecting people outside Exo.
  - Do not overfill the account beyond the motion's stakeholder target count.
  - Do not complete the packet before the selected prospect set is durable.
writeback:
  - Persist the chosen prospects on the motion-owned target account.
  - Include the strongest why-relevant reasoning and any direct channel fallbacks you already know.
  - Complete the packet so the backlog can advance into planning and ready-branch work.
---
Close the outbound deficit for {{userLabel}} by claiming the already-available prospect-selection packets in researched accounts. There are currently {{claimableProspectSelectionPacketCount}} claimable prospect-selection packet(s). Claim them explicitly, choose the best-fit stakeholders for each researched company, write those people back into Exo, and then complete those packets so the backlog can advance toward ready connection-request branches.
