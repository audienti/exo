---
principles:
  - User-scoped planner surfaces need a governed execution identity before they can mean anything.
  - Connector-backed execution is the default path. Browser profiles are fallback transport, not the first answer.
  - Keep execution setup inside Exo so later live work resolves against stored identity instead of guesswork.
do:
  - Add an execution user with `exo users add --label operator-main --owner operator --json` if none exists yet.
  - Probe the current runtime with `exo users harness probe <user-id> --runtime codex --json` before inventing a transport path.
  - Map discovered runtime accounts with `exo users accounts map-runtime <user-id> --runtime codex --apply --json` or add the governed account explicitly.
avoid:
  - Do not use {{surfaceName}} as if Exo already knows who is doing the work.
  - Do not guess browser identity or connected-account coverage from old notes or ambient machine state.
  - Do not treat missing execution setup as a cadence or inbox problem.
writeback:
  - Persist the execution user and connected-account mapping in Exo before you continue.
  - Re-run the blocked planner surface after writeback and confirm it resolves to a real governed queue.
---
Register the execution path before using {{surfaceName}}. {{recommendedAction}}
