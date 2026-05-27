---
affordances:
  - Try a visible top-level Connect affordance first.
  - If Connect is hidden, check the profile overflow or More menu before treating the path as missing.
fallbacks:
  - If the visible profile path is flaky, use the direct invite flow for the stored profile identity instead of re-scanning the whole page.
  - Treat Add a note as an optional branch, not as proof that the invite path itself is unavailable.
successProofs:
  - The primary call-to-action changes from Connect to Message or an equivalent post-invite state.
  - A visible Pending control or equivalent pending-request state appears on the profile.
failureSignatures:
  - The page never exposes a real connect affordance after the normal profile and overflow branches.
  - The invite dialog opens but the send control is missing or stays disabled.
  - The platform returns an explicit rejection that is about the action itself, not about missing UI.
cleanup:
  - Leave the browser on the verified prospect profile or another clean handoff state after send confirmation.
---

# Connection Request

These are ranked LinkedIn execution hints, not a rigid selector recipe.

Use them to shorten the normal case:

1. visible connect path
2. overflow or more-menu connect path
3. direct invite flow

If none of those produce a real connect path, treat that as a platform-state problem or identity problem, not as a reason to hallucinate another branch.
