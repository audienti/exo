---
principles:
  - Exo is motion-first. No motion means there is no governed GTM object to continue.
  - Start from the offer URL so Exo can detect reuse before it creates durable state.
  - Ask only for the missing premise, audience, and signal inputs needed to create the first real motion.
do:
  - Start with `exo motion intake --json` if the offer inputs are still incomplete.
  - Use `exo motion start --url https://example.com/product --premise "This offer matters when ..." --audience "Primary ICP" --signal "company::Is there recent evidence that ...?" --json` once the first inputs are ready.
  - Re-read `exo what-is-this --json` or `exo next --json` after the motion exists so the governed path can move beyond bootstrap.
avoid:
  - Do not jump into inbox, daily, or browser execution before a motion exists.
  - Do not create scratch notes or off-book state for the first offer when Exo can store it directly.
writeback:
  - Persist the first motion in Exo instead of leaving the bootstrap state implied.
  - Use the created motion as the new source of truth for downstream targeting and execution.
---
Create the first motion from the real offer, premise, audience hypothesis, and first signal. {{recommendedAction}}
