# Exo Go-Live Checklist

Use this when you are moving one motion or one operator workflow off Audienti and onto Exo.

## Cutover rule

Do not treat Exo like a sidecar note system.
If the motion is live in Exo, the durable state has to be written back into Exo every time work happens.

## Minimum go-live checklist

### 1. Product state

- The current local planner work is pushed and available on the branch or `main` you will actually run.
- `exo what-is-this --json` shows the operator surfaces you plan to use:
  - `exo report motion`
  - `exo inbox`
  - `exo daily`
  - `exo next`
- The shared state path is pinned with `EXO_STATE_DIR`.

### 2. Execution identity

- Create at least one Exo execution user.
- Attach the LinkedIn account you will use.
- Attach the Gmail account you will use.
- Attach any other runtime-backed account you expect to use through the active harness.
- Confirm the browser identity resolves cleanly before browser-backed work.

### 3. Motion state

- The motion you are actually working is `active`, not `draft`.
- The target companies are stored in Exo.
- The chosen prospects are stored in Exo.
- Through-lines, opening plans, and cadence state exist for the live branches you intend to work.

### 4. Contact enrichment

- Every chosen prospect has a structured `contactPoints` record, even if it only contains LinkedIn at first.
- If direct email is unknown, store the enrichment state instead of pretending the field is empty for no reason.
- Store weak, rejected, or research-only channels as structured contact points instead of losing that effort in notes.
- Use this search order:
  1. owned data
  2. Google/browser/public web
  3. direct MCPs and direct CLIs
  4. consumer Composio
  5. Zerobounce for validation only

### 5. Inbound operating loop

- The agent checks the real inbound surfaces during the day.
- The agent writes normalized observations back into Exo.
- `exo inbox`, `exo daily`, and `exo next` are treated as the operator entrypoint after new observations land.
- Do not wait for a future scraper or sync daemon before using the loop.

### 6. Writeback discipline

Every real action should end with Exo writeback:

- connection request sent
- accepted connection
- inbound request received
- DM sent
- email sent
- reply received
- follow / unfollow
- profile view if it matters to cadence
- new contact point found
- enrichment exhausted

If the writeback does not happen, the planner drifts immediately.

## First replacement mode

The safest first replacement mode is:

1. one active motion
2. one execution user
3. agent-assisted enrichment
4. agent-assisted inbound observation capture
5. Exo as the planning and state kernel

Do not wait for Kanban, analytics, or full inbound-motion content planning before replacing the day-to-day outbound operator loop.

## Recommended first run

1. Reinitialize Exo from the shared state.
2. Inspect the active motion with `exo report motion`.
3. Run `exo next`.
4. Do the governed action.
5. Write back the touch or observation.
6. Re-run `exo inbox`, `exo daily`, or `exo next`.

If that loop works cleanly for one real motion, Exo is operating as the replacement kernel even if the broader roadmap is not finished yet.
