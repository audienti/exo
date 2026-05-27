---
affordances:
  - Try a visible Follow control on the profile first.
  - If Follow only exists in an overflow menu, treat that as the normal secondary branch.
fallbacks:
  - If LinkedIn returns an explicit inability-to-follow error once, stop using Follow as the warmup path for this prospect and pivot to the planned first touch.
successProofs:
  - The control changes to Following or another persistent followed state.
failureSignatures:
  - The control snaps back to Follow after the click.
  - LinkedIn shows an explicit rejection such as 'unable to follow'.
cleanup:
  - Do not keep retrying Follow blindly once the platform has already rejected it.
---

# Follow

Follow is a warmup option, not a sacred first move.

If the platform rejects it explicitly, that is a meaningful outcome. Record it and move on.
