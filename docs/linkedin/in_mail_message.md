---
affordances:
  - Use the profile-level Message or InMail affordance only after confirming entitlement in the live browser.
fallbacks:
  - If entitlement is absent, stop and move to the governed fallback channel instead of improvising another private touch.
successProofs:
  - The composer exposes the expected subject and body fields and accepts send.
failureSignatures:
  - The live profile does not expose an InMail path.
  - The runtime profile is connected but the account lacks usable entitlement.
---

# InMail

Exo can govern the context. It cannot prove entitlement ahead of time.

That entitlement check is still a live browser step.
