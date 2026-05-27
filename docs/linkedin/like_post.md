---
affordances:
  - Work from the stored recent-post context when it still looks fresh and legitimate.
fallbacks:
  - If the recent post is stale or the context has drifted, skip the like instead of forcing a fake warmup.
successProofs:
  - The reaction state visibly toggles on the intended post.
failureSignatures:
  - The stored post is no longer present or no longer contextually useful for warmup.
---

# Like Post

This is only useful when the post is still real enough to make the interaction feel natural.
