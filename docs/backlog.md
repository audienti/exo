# Backlog

This file holds candidate work that is intentionally off the active issue board for now.

## Compose Attachments

Status: backlog

Why this is here:
- Exo already has an editable compose and queue flow for governed sends.
- Attachments are still missing, but they are additive rather than the blocker for the current operator loop.

Use case:
- attach a file or image to a governed outbound email
- preserve attachment metadata on the draft and the final sent touch
- keep the attachment tied to the motion, prospect, and sending path that used it

Open questions:
- should attachments be local-file only first, or also support generated assets
- where should attachment metadata live in Exo state
- which send surfaces need attachment support first
- how should attachment proof and writeback show up in the timeline
