---
principles:
  - Sync counts are not enough when real items exist behind them.
  - Exo cannot help the operator review concrete objects unless the agent writes those objects back individually.
  - Itemization gaps are execution failures, not cosmetic reporting gaps.
do:
  - Reopen {{surfaceLabel}} and inspect each concrete item on the surface.
  - Write every real item back into Exo as its own observation.
  - Preserve actor, summary, observed time, and any linked motion, company, or prospect context you can resolve.
  - Rerun inbound review after itemization so the operator gets a real decision queue.
avoid:
  - Do not leave a surface at count-only state when it has real reviewable objects.
  - Do not collapse multiple real items into one vague summary.
  - Do not trust the sync count as a substitute for item-level truth.
writeback:
  - Add one observation per real item you find on the surface.
  - If the sync count was wrong, update the surface run state to match what was actually there.
---
{{surfaceLabel}} reported {{itemCount}} item(s) during sync, but no concrete observations were written back. Reopen that surface, capture each real item individually, and write them into Exo so the operator can actually review and act on them.
