---
principles:
  - Thin outbound inventory is a production problem, not a note to handle later.
  - When the governed backlog cannot fill the motion's prospect floor, the agent should discover more companies instead of waiting for manual seeding.
  - Discovery only counts when the new companies are stored inside Exo and can flow into normal research packets.
do:
  - Use the motion premise, target profile, and signal questions to find new companies on the public web.
  - Land each strong-fit company into the motion with `exo motion discover`.
  - Queue the discovered companies for research so the next packet lane can claim them immediately.
  - Treat the requested company count as a floor, not a ceiling. If the same search sweep exposes more strong-fit matches, land them in the same pass.
  - Prefer fewer strong matches over bloated weak-fit backlog.
avoid:
  - Do not wait for the operator to hand-enter obvious backlog when the motion already exposes enough signal structure to search.
  - Do not add random logos just to inflate counts.
  - Do not jump to stakeholder or cadence work before the companies exist in Exo.
writeback:
  - Persist every discovered company into Exo through the governed `motion discover` path.
  - Store canonical website and LinkedIn company identity when you can support them.
---
The active motion needs more upstream company discovery. Use the motion premise, target profile, and signal questions to find additional companies on the public web, then land them into Exo with `exo motion discover` so the queue can turn them into real research packets. The goal is governed backlog, not activity theater.
