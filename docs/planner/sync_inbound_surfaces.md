---
principles:
  - Exo does not trust silence on inbound surfaces that were never checked or are too stale.
  - Sync is not a backend daemon here; it is an agent workflow that inspects live surfaces and writes the result back.
  - Record both the observations you found and the fact that you checked the surfaces.
do:
  - Inspect the enabled authoritative inbound surfaces for {{accountCapabilityList}}.
  - Prefer a quick daytime refresh when you are already in session, then widen only if the first pass is inconclusive.
  - For each real change, write a normalized observation back into Exo.
  - After each surface pass, record the sync result so Exo stops treating that surface as unseen.
  - Rerun `exo inbox`, `exo daily`, and `exo next` after the writeback lands.
avoid:
  - Do not pretend the planner is trustworthy when {{syncReason}}.
  - Do not scrape the notifications bell and call that authoritative truth.
  - Do not record a successful sync without either a real observation writeback or an explicit empty-pass sync record.
writeback:
  - Use `exo inbound observations add ...` for each meaningful inbound change you find.
  - Use `exo inbound sync record ... --status success|warning|failed` for each checked surface.
  - If the surface was empty, still record the sync run so the planner knows it was checked.
---
Run an inbound sync before trusting the planner for {{motionName}}. The current issue is that {{syncReason}}. Check the enabled authoritative {{accountCapabilityList}} surfaces first, especially {{surfaceList}}. While you inspect, write back every meaningful change with `exo inbound observations add ...`. After each checked surface, record the sync result with `exo inbound sync record ...`. When the pass is done, rerun `exo inbox`, `exo daily`, and `exo next` so Exo can recompute from fresh truth.
