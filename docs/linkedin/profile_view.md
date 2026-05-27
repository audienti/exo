---
affordances:
  - Open the stored profile URL directly when it is available.
  - Treat the profile page itself as the verification target, not search results or feed context.
successProofs:
  - The stored prospect identity is visible on the profile page under the intended signed-in account.
failureSignatures:
  - The stored profile URL resolves to the wrong signed-in identity, a login wall, or a missing profile.
cleanup:
  - If this is only a warmup or verification step, leave the tab in a clean profile state for the next move.
---

# Profile View

This exists to reduce wasted browsing.

The point is not to "look around LinkedIn." The point is to verify:

- correct prospect
- correct signed-in identity
- clean handoff state for the next action
