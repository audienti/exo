---
principles:
  - Ready branches blocked only by missing execution ownership are not an inventory problem.
  - Pin the company to one governed execution user before seeding more targets or writing more drafts.
  - Re-run the planner immediately after assignment so the ready branch moves into executable inventory.
do:
  - Use `exo companies user assign <company-id> --user <user-id> --reason "Make ready outbound branches executable" --json` on each blocked ready company.
  - Start with `{{firstAssignmentBlockedCompanyName}}` if you only have time to clear one blocker first.
  - Re-run `exo daily --user {{userId}} --json` after the assignment and confirm the ready branch count moved from blocked to executable.
avoid:
  - Do not seed more targets while already-prepared branches are blocked only by missing assignment.
  - Do not treat a missing company pin as a prospect-quality or message-quality problem.
writeback:
  - Persist the company-to-user assignment in Exo before you continue execution.
  - Keep the same execution user and browser identity for the whole company after you pin it.
---
Ready LinkedIn branches already exist, but they are blocked on missing execution ownership. Pin the blocked ready companies to {{userLabel}} first so Exo can turn the stored through-lines, opening plans, and cadence into live executable work today.
