---
principles:
  - When the upstream motion queue is empty, the operator needs an explicit seeding path instead of generic pressure language.
  - If the operator already knows likely accounts or people, direct motion seeding is faster and safer than pretending discovery must always come first.
  - Seeded targets still belong inside normal Exo motion state, queue state, and prospect state.
do:
  - Use `exo motion seed <motion-id> --company ...` when you already know the account and need to create backlog immediately.
  - Use `exo motion seed <motion-id> --person-name ... --person-title ... --why-relevant ...` when you already know the person and want Exo to resolve or create the company context first.
  - If the company is known but still needs research, seed it company-first and queue it for research.
  - If the person is known and defensible already, seed them directly into the motion-owned target account so later through-line, opening-plan, and cadence work has a governed object to act on.
avoid:
  - Do not leave known targets outside Exo just because discovery backlog is empty.
  - Do not create ad hoc notes or spreadsheets when Exo can store the company and person directly.
  - Do not seed random names just to satisfy the daily deficit; stay inside the active motion thesis.
writeback:
  - Persist seeded companies and people into Exo immediately.
  - After seeding, move the target forward through research, prospect selection, through-line, opening-plan, cadence, and touch writeback as normal.
---
When the motion queue is empty but the outbound deficit is real, seed targets directly into the active motion instead of waiting for discovery theater. For {{motionName}}, use `exo motion seed` to add the next known companies or people so the planner has real governed backlog to convert into ready branches.
