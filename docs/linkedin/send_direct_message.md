---
affordances:
  - Work from an accepted connection thread or an existing inbound thread, not from the cold profile shell.
  - Match the message surface to the actual conversation stage before drafting or sending.
successProofs:
  - The message appears inside the correct thread under the intended sending identity.
failureSignatures:
  - No accepted connection or governed inbound thread exists yet.
  - The browser opens the wrong thread stage for the intended touch.
---

# Send Direct Message

This is not one surface. It branches by conversation stage:

- first DM after acceptance
- follow-up DM
- inbound reply

Treat the thread state as the governing fact.
