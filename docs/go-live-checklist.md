# Exo Go-Live Checklist

Use this when you are moving one motion or one operator workflow onto Exo as the primary system of record.

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
- Prospect context and cadence state exist for the live branches you intend to work.

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

### 5.5. Background worker

- Install the scheduled queue drainer before you call the motion live.
- On macOS with Codex, the supported path is the host-local `launchd` runner, not Codex app Automations and not a shell cron line that depends on `OPENAI_API_KEY`.
- `exo agent install-routine --runtime codex --interval 15m --install` should write:
  - `.exo/agent-routine.md`
  - `.exo/run-agent-host.sh`
  - `.exo/agent-launchd.plist`
  - `~/Library/LaunchAgents/com.<user>.exo.queue-drainer.plist`
- That default install should land in `--send-mode verify`, so the background worker proves retrieval, drafting, and send-readiness without clicking Send or writing back a send result.
- If a routine is already installed, re-running `install-routine` without `--send-mode` should preserve the current installed mode instead of silently resetting it.
- If you omit `--install`, treat `install-routine` as a non-mutating preview. Use `--write-artifacts` only if you explicitly need the local runner files without loading the scheduler.
- In `--send-mode verify`, each scheduled pass attempts one due browser send, stops before the final click, and records that verification proof in host state so the next canary pass advances to the next due send instead of repeating the same one immediately.
- After the verify passes look clean, switch to `--send-mode canary` if you want cautious live drain. In `canary`, each pass sends at most one previously verified browser send. If the next due send has no fresh proof, the pass proves it to `ready_to_send` and stops there.
- Do not promote into `canary` or `live` while enabled autonomous inbound retrieval is stale, failed, partial, or never checked. `exo agent doctor` now blocks rollout until background truth is healthy.
- Do not switch straight to `--send-mode live`. Exo now expects at least one successful canary send before live rollout is considered ready.
- Verify the worker is loaded with `launchctl print gui/$(id -u)/com.<user>.exo.queue-drainer`.
- Kick one immediate pass with `launchctl kickstart -k gui/$(id -u)/com.<user>.exo.queue-drainer`.
- Before trusting the send lane, run one verification-only pass with `EXO_AGENT_SEND_DRY_RUN=1 EXO_AGENT_MAX_TASKS=1 node scripts/run-agent-host-pass.js` and make sure it can reach `ready_to_send` without mutating state.
- Inspect `.exo/agent.log`, `.exo/agent-launchd.out.log`, and `.exo/agent-launchd.err.log` after the first run.
- Run `exo agent doctor --json` and make sure its browser task readiness matches the machine state you expect.
- If the scheduled worker cannot write Exo state or cannot bind the intended browser/session path, Exo is not live yet.

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
3. Verify the background queue drainer is installed and healthy.
4. Run `exo next`.
5. Do the governed action.
6. Write back the touch or observation.
7. Re-run `exo inbox`, `exo daily`, or `exo next`.

If that loop works cleanly for one real motion, Exo is operating as the replacement kernel even if the broader roadmap is not finished yet.
