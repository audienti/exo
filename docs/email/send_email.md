---
affordances:
  - Use the stored verified email address only.
  - Treat email as a governed fallback or parallel channel, not as a guessed contact path.
successProofs:
  - The composer opens with the intended sender account and the stored recipient address.
failureSignatures:
  - No verified email is stored for the prospect.
  - The runtime opens the wrong sending account for the intended user.
---

# Send Email

Email is only legitimate here when the address is already governed and the sending identity is the intended one.
