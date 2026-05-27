---
affordances:
  - Reply only inside a real existing public thread that is already in play.
fallbacks:
  - If the thread context is gone or has moved, stop instead of creating synthetic comment context.
successProofs:
  - The reply nests inside the intended thread under the correct identity.
failureSignatures:
  - The underlying comment thread is missing or no longer writable.
---

# Reply to Comment

This is thread-dependent.

Do not invent the thread. Use it only when the thread already exists and still matters.
