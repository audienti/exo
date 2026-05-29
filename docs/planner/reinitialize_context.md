---
principles:
  - Re-read the live state before deciding what to do next.
  - Use the existing focus motion unless the state proves otherwise.
do:
  - Re-read Exo orientation and current state.
  - Inspect motions, users, and inbound surfaces before changing anything.
avoid:
  - Do not assume empty state.
  - Do not create a new motion just because the context is unclear.
writeback:
  - Persist only durable findings that were missing from state.
---
Reinitialize from the live Exo checkout and shared state for {{motionName}} or the current focus motion. Re-read the operator call, inspect the governed state that already exists, and only then choose the next path.
