---
principles:
  - If claimable company-research packets already exist, use them before inventing new backlog.
  - A claimed packet is a work reservation, not just a label.
  - Company research should produce durable signal and account identity state inside Exo.
do:
  - Inspect `exo motion packets <motion-id> --json` to see which companies are claimable right now.
  - Open the first packet contract with `exo motion packet-brief {{firstClaimableCompanyResearchPacketMotionId}} --packet {{firstClaimableCompanyResearchPacketId}}` before you start, so the worker sees the exact scope and writeback path.
  - Claim the packet explicitly with `exo companies queue claim <company-id> --motion <motion-id> --worker <label>`.
  - Research the company against the motion signals, then write signal matches and durable company identity back into Exo.
  - Complete the packet with `exo companies queue complete <company-id> --motion <motion-id> --worker <label> --next-status researched`.
avoid:
  - Do not research a queued company without claiming it first.
  - Do not let another worker write to the same company account while this packet is active.
  - Do not leave research findings in scratch notes or browser tabs.
  - Do not mark the packet complete until the account is actually advanced to researched state.
writeback:
  - Persist company website and LinkedIn identity if they are found.
  - Persist the strongest motion-specific signal matches you would actually use in outreach.
  - Complete the claimed packet so the next packet class can surface.
---
Close the outbound deficit for {{userLabel}} by claiming the already-available company-research packets in active motion backlog. There are currently {{claimableCompanyResearchPacketCount}} claimable company-research packet(s). Claim them explicitly, research the companies against the motion thesis, write the durable account state back into Exo, and then complete those packets so the backlog can advance into prospect selection.
