---
principles:
  - A channel target creates a real deficit, not a vague aspiration.
  - Pending connection requests from prior work do not satisfy today's send requirement.
  - The planner should separate ready-to-send branches from inventory that still has to be manufactured.
do:
  - Use already-ready connection-request branches first.
  - If the ready branch count is too small, research and build enough additional branches to close the shortfall.
  - Keep the work inside assigned active motions and execution-safe companies.
avoid:
  - Do not treat yesterday's pending invites as today's completed target.
  - Do not open random branches just to hit a number.
  - Do not leave newly built ready branches outside Exo.
writeback:
  - Record every sent connection request as a touch in Exo.
  - Persist any new companies, prospects, through-lines, opening plans, and cadence branches you create to close the deficit.
---
Close today's LinkedIn invitation deficit for {{userLabel}}. The target is {{dailyInvitationTarget}} connection request(s) today. {{sentTodayCount}} have been sent today, {{pendingInvitationCount}} are already pending from earlier work, {{readyConnectionRequestCount}} more branch(es) are ready right now, and {{remainingInvitationCount}} invitations still need to be filled today. Current queue pressure: discovered companies {{discoveredCompanyCount}}, manually queued research companies {{queuedResearchCompanyCount}}, researched companies {{researchedCompanyCount}}, selected prospects {{selectedProspectCount}}, and queue-ready prospects {{readyProspectCount}}. If ready branches exist, send them first. If inventory is short by {{inventoryShortfallCount}}, work the earliest blocked queue stage that will create additional connection-request-ready branches before the day ends.
