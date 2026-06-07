# Agent Usage

This is the short guide for Claude, Codex, or any other agent using Exo from the command line.

Exo is not mainly a thing to query. It is mainly a thing that should shape your behavior:

- hold durable GTM state
- govern what actions are allowed or safe
- tell you what object or motion you are operating on
- make browser-backed work and handoff work less reckless
- act as the GTM system of record for durable findings

When you answer the operator, translate Exo state into a normal operating judgment. Do not answer by reciting JSON fields or internal property names unless the operator explicitly asks for them.

## Do not treat Exo like a shell script bag

Exo is a stateful local operating layer. The important thing is not just running a command. The important thing is running it from the right workspace and consuming its structured outputs correctly so your next action stays inside the governed Exo state model.

## Hard rules for agents

1. `cd` to the Exo repo root before calling the CLI if shared local state matters.
2. Prefer `--json` whenever Exo output will feed another step.
3. Resolve browser profile state before browser-backed work.
4. Once a company is being worked, prefer its company pin first, then its motion-level default identity, over fresh profile resolution.
5. Fail closed if the required browser profile is missing, `warning`, or `invalid` and the action is sensitive or unattended.
6. Use Exo nouns and verbs. Do not invent horizontal actions as if they are Exo features.
7. Prefer `exo config export --json` over copying `.exo/exo.db` when the goal is handoff or portability.
8. Treat `company` as canonical identity and `motion` linkage as why it matters now.
9. Assume Exo may run local state migrations on open; if a command suddenly starts working after a version bump, that is the intended repair path, not a mystery side effect.
10. Treat Exo as the system of record. If you find a durable signal, website, stakeholder, or assignment that Exo can store, write it back before you summarize.

## Shared state rule

Exo state is currently stored in:

```bash
.exo/exo.db
```

That is relative to the current working directory.

So if an agent runs Exo from the wrong directory, it may silently create or use the wrong state store.

To prevent that, pin a shared store explicitly when multiple agent conversations should collaborate:

```bash
export EXO_STATE_DIR=<repo-root>/.exo
```

That is the cleanest way to let multiple agents operate in parallel without depending on identical current working directories.

## Recommended agent flow

### First orientation call

1. `exo what-is-this --json`

Use this first when the agent needs to understand:

- what Exo is
- what Exo is not
- current commands
- browser-profile rules
- current limitations
- where local state lives

This should be the default bootstrap call for a new conversation that is about operating Exo.

### Parallel agent setup

When multiple agents will operate at the same time:

1. point them at the same Exo store with `EXO_STATE_DIR` or the same repo root
2. call `exo what-is-this --json`
3. call `exo companies list --json`
4. call `exo profiles list --json`
5. call `exo profiles discover --json`
6. call `exo profiles capabilities --json`
7. call `exo motion list --json`

The current concurrency model is shared-state, parallel-read, serialized-write.

### Scheduled worker install

If you want Exo to keep draining its queue without an attended chat, install the worker that matches the runtime and host.

For macOS plus Codex, the supported unattended path is the host-local `launchd` runner:

```bash
exo agent install-routine --runtime codex --interval 15m --install
```

That now defaults to `--send-mode verify`. Verify mode is the safe first rollout, not a queue drainer. It attempts one due browser send per pass, proves `ready_to_send` when it can, stops before the final click, and leaves the Exo queue unchanged. Exo records recent verification proofs in `.exo/agent-host-state.json` so the next verify pass advances to the next due send instead of re-proving the same prospect immediately.

If a routine is already installed, re-running `install-routine` without `--send-mode` preserves the current installed mode instead of silently resetting it.

If you omit `--install`, `install-routine` is now a non-mutating preview by default. Use `--write-artifacts` only when you explicitly want the local runner files generated without loading the scheduler.

That should resolve to a `launchd` plan, write `.exo/run-agent-host.sh`, write `.exo/agent-launchd.plist`, install `~/Library/LaunchAgents/com.<user>.exo.queue-drainer.plist`, and bootstrap it with `launchctl`.

Verify it with:

```bash
launchctl print gui/$(id -u)/com.<user>.exo.queue-drainer
launchctl kickstart -k gui/$(id -u)/com.<user>.exo.queue-drainer
tail -n 100 .exo/agent.log
exo agent doctor
exo agent doctor --json
```

If you want to exercise the exact same worker path manually, use `exo agent run`. It now shells through the real host-pass runner instead of the old soft queue summary:

```bash
exo agent run --json
exo agent run --force-retrieval --max-tasks 1 --json
```

Use `--force-retrieval` when you want to prove autonomous retrieval now instead of waiting for the next stale window. That path promotes waiting `run_inbound_sync` tasks into the same selection pipeline the host runner uses, without touching waiting sends.

If you need to prove the detached send lane without sending a real message, run one verification-only pass:

```bash
exo agent run --send-mode verify --max-tasks 1 --json
```

If you want a controlled rollout after verification, install `--send-mode canary`. In canary mode, each scheduled pass will either:
- send one previously verified browser send and write it back, or
- prove one unverified send to `ready_to_send` and stop without clicking Send.

Exo now also treats stale autonomous inbound retrieval as a rollout blocker. If enabled background-truth surfaces are stale, failed, partial, or never checked, `exo agent doctor` and `install-routine` will hold `canary` and `live` promotion until retrieval truth is healthy again.

Do not jump straight to `--send-mode live`. Exo now treats `live` as a post-canary mode and expects at least one successful canary send in host state before that rollout is considered ready.

Verify mode exercises the real browser send preparation and returns a completed pass only when the governed message is loaded into a real writable composer and is ready for the final click. It does not run Exo writeback and it does not mutate outbound state.

Use `exo agent doctor` when the worker is waking up but not draining browser work. It reports the queue pressure, task-specific browser readiness, lane-specific browser backoff, and any conflicting Chrome app instances that make detached sends unsafe.

Do not treat Codex app Automations, Playwriter approval prompts, or a shell cron job that expects `OPENAI_API_KEY` as the production Exo browser-worker path. Those are different execution environments and they fail differently.

If you explicitly need a cron line instead, request it:

```bash
exo agent install-routine --runtime claude --scheduler cron --interval 30m --install
```

### Handoff or portability

When an agent needs to hand durable Exo state to another chat, machine, or alpha user:

1. `exo config export --json` for in-band structured handoff
2. or `exo config export --out ./exo-config.json` for a file-based transfer
3. on the receiving side, `exo config import ./exo-config.json`

Do not default to copying the SQLite file directly unless the task is explicitly low-level state migration.

### Browser-backed work

1. `exo profiles list --json`
2. `exo profiles discover --json`
3. `exo profiles capabilities --json`
4. `exo profiles resolve --capability <capability> --json`
5. if the path resolves through a harness connector, run `exo users harness probe <user-id> --runtime <runtime> --connector <connector> --json`
6. If needed, `exo profiles add ... --json`
7. `exo profiles claim <profile-id> --label audienti-main --workspace audienti --account linkedin:operator-linkedin@example.com --max-connection-requests 40 --max-inmail-messages 20 --json`
8. `exo profiles test <profile-id> --json`
9. `exo profiles auth <profile-id> --runtime <runtime> --json`
10. Refuse browser-backed work if the result is not trustworthy

When the agent is already doing browser-backed work on Gmail or LinkedIn, do one cheap ambient glance for unread or invite movement before leaving the surface. If you see smoke, record a cue instead of inventing truth:

```bash
exo inbound cues add <user-id> --account <account-id> --surface linkedin-messaging-inbox --kind unread_message_badge --observed-at <iso-datetime> --summary "Saw something worth checking while doing another action." --json
```

Use that when the runtime saw a badge or hint but did not actually inspect the canonical inbox or invitation surface yet.

### Browser harness preference

Exo governs browser identity. It does not choose the control harness for the session.

When the session needs live browser work:

1. resolve the identity in Exo
2. prefer the native browser-control surface of the current runtime
3. only fall back if that native surface is unavailable

Concrete preference:

- in Codex, prefer the Chrome skill / native Chrome connector for Chrome-backed authenticated work
- in Claude, prefer the native browser-use/browser-control surface available in that runtime
- do not default to Playwriter just because it exists

For harness-backed work in Codex, Exo can now inspect the local Codex config and tell you whether stored connectors like `gmail`, `chrome`, or named MCP servers are actually enabled:

```bash
exo users harness probe <user-id> --runtime codex --json
exo users harness probe <user-id> --runtime codex --connector gmail --writeback --json
```

Treat that as transport preflight, not as proof of live auth inside the provider.

For Gmail-backed inbound truth, the first built-in live path now exists:

```bash
exo inbound sync gmail-live <user-id> --account <account-id> --apply --refresh --json
```

Use that only when the Gmail account resolves through either a supported `runtime:gmail` harness connection such as `codex:gmail` or `claude:gmail`, or the shared-state browser model: a browser-profile-backed Gmail account with a trusted Chrome profile plus a supported `runtime:chrome` harness such as `codex:chrome` or `claude:chrome`. It runs live inspection through the resolved runtime, then lands the result through the same governed Exo sync-writeback path as manual captures.

For LinkedIn-backed inbound truth, the first built-in quick-mode live path now exists:

```bash
exo users harness probe <user-id> --runtime codex --connector chrome --json
exo inbound sync linkedin-live <user-id> --account <account-id> --runtime codex --apply --refresh --json
```

Use that only when the LinkedIn account resolves through a browser-profile-backed account with a trusted Chrome profile and the user also has a supported `runtime:chrome` harness connection such as `codex:chrome` or `claude:chrome`. It runs live inspection through the resolved runtime, then lands the result through the same governed Exo sync-writeback path as manual LinkedIn captures.

When both Gmail and LinkedIn truth need to land together, prefer the orchestrated pass:

```bash
exo inbound sync live <user-id> --apply --refresh --json
```

That command composes the enabled live-supported accounts for `quick` mode and applies one governed writeback instead of splitting the pass into separate commands.

### Working-hours-aware sync pressure

Inbound sync pressure is no longer just a freshness timer. It is also gated by the execution user's working-hours policy.

Inspect or set it with:

```bash
exo users working-hours show <user-id> --json
exo users working-hours set <user-id> --timezone America/New_York --weekday mon --weekday tue --weekday wed --weekday thu --weekday fri --start 07:00 --end 18:00 --json
```

Planner behavior:

- fresh ambient cue during an open window: sync is due now
- fresh ambient cue outside the window: queue sync for the next open window
- cues are suspicion, not truth
- a governed sync resolves matching open cues automatically

If no native browser-control surface is available in the current session, say that explicitly before choosing any fallback path.

### Motion setup

1. `exo motion start ... --json`
2. If the result is `decision-required`, choose `continue`, `clone`, or `new` explicitly instead of guessing
3. Persist the returned `motion.id`
4. `exo motion show <motion-id> --json` when the full stored object is needed later
5. `exo motion target <motion-id> --json` when you need one governed answer about targeting readiness
6. `exo motion user assign <motion-id> --user <user-id> --json` when one execution identity should govern the whole motion by default

The motion setup call should usually define:

- `offer URL`
- `premise`
- one or more `audience hypotheses`
- motion-specific `signals`
- targeting and suppression inputs

Agents should not assume a motion can be meaningfully retrieved or ranked if the premise is still missing and no signals have been defined.
Agents should also not silently create a new motion when the same offer URL already exists in Exo.

### Company registry

1. `exo companies list --json`
2. `exo companies find <term> --json`
3. if needed, `exo companies add ... --json`
4. `exo companies motions <company-id> --json` to see motion linkage
5. `exo companies update <company-id> --website-url https://example.com --json` when canonical company-site identity becomes clear
6. `exo companies research-brief <company-id> --json` before live account research
7. `exo companies signal-matches add <company-id> --signal <signal-id> --summary "Stored reason to talk" --json` when a real signal is found
8. `exo companies signal-matches show <company-id> --json` before writing or follow-up planning
9. `exo companies prospects add <company-id> --name "Person Name" --title "Director Title" --email person@example.com --profile-viewed-at <iso-datetime> --live-signal-summary "Recent post shows channel activity" --why-relevant "Why this person matters now" --json` after choosing the people of record
10. `exo companies prospects show <company-id> --json` before writing or follow-up planning
11. `exo companies cadence set <company-id> --prospect <prospect-id> --current-step connection-request --next-action "Send the first touch" --json` before execution or drafting
12. `exo companies profile assign <company-id> --profile <profile-id> --json` when engagement starts
13. `exo companies profile show <company-id> --json` to inspect the pinned identity

If the same identity should govern the whole motion before company-level overrides exist, use:

- `exo motion user assign <motion-id> --user <user-id> --json`
- `exo motion profile assign <motion-id> --profile <profile-id> --json`
- `exo companies execution show <company-id> --motion <motion-id> --capability linkedin --json`

### Company research

The governed research loop for a motion-linked company is:

1. confirm or find the canonical company website and store it in Exo
2. inspect the company site first, especially newsroom, press, merchant, product, and company pages
3. search Google and recent web/news results against the motion's signal questions
4. keep only evidence recent enough to use naturally in outreach
5. choose a tight stakeholder set instead of stopping at one exact title match
6. persist the chosen people and first outreach plan back into Exo

When you find a usable signal, do not leave it as a browser-side note. Persist it into Exo with:

- signal id
- short writer-ready summary
- source URL
- observed date
- confidence
- optional person name/title when the match is person-scoped

That stored signal-match layer is what later writing should read from.

Important filter:

- do not persist every interesting fact as a signal match
- only store the few strongest signals that are recent, specific, and usable in writing
- synthesize the stored signal line into something concise and impactful enough that the writer can reuse it directly without summarizing again

## Action Execution

Exo now has a canonical action catalog and a prospect-scoped action brief layer.

Use:

1. `exo actions list --json`
2. `exo actions show <action-key> --json`
3. `exo actions result --action <action-key> --result <result-key> --company <company-id> --prospect <prospect-id> --json`
4. `exo motion actions <motion-id> --prospect <prospect-id> --json`
5. `exo motion action-brief <motion-id> --prospect <prospect-id> --action <action-key> --json`

This is the correct execution loop:

1. inspect which canonical actions exist
2. inspect which actions are actually available for the current prospect
3. pull one action brief
4. if the action needs copy, pull `exo motion draft-brief ...` for the mapped draft surface
5. have the chat write the copy from that stored context
6. pull `exo companies execution show <company-id> --capability <capability> --json` and honor the resolved transport order and recovery hints
7. perform the action in the native browser harness
8. immediately write back what really happened with `exo actions result ...`

Important execution rule:

- action briefs now inject editable repo docs like `docs/linkedin/connection_request.md`
- treat those as ranked hints and proof checks, not as one universal UI recipe
- use them to shorten the normal path, then fall back cleanly when the live UI drifts

Important distinction:

- `action type` is the governed business move
- `draft surface` is the writing stage

Example:

- `send_direct_message` may map to:
  - `post_accept_message`
  - `follow_up_direct_message`
  - `inbound_reply`

Do not collapse those concepts.

Practical rule:

- prefer signal evidence from roughly the last 180 days
- use 181-365 day evidence only when the change is clearly still active
- do not use older than 365 day evidence as the primary why-now trigger

Practical stakeholder rule:

- start with exact target-title matches when they exist
- if they do not, move to the closest best-fit owner whose function matches the signal and premise
- keep the chosen set tight and inside the motion's stakeholder count
- store one likely primary owner plus only the strongest adjacent stakeholders or sponsors
- persist the first outreach plan using stored signal matches as the why-now spine
- persist the most likely legitimate reply path for the primary stakeholder, not just a channel choice

## Current profile semantics

Browser profiles are first-class because the wrong local browser context means:

- the wrong LinkedIn identity
- no Sales Navigator entitlement
- the wrong Gmail session
- the wrong HubSpot org

Agents should treat profile resolution as execution identity, not local preference.

The claimed profile is also where weekly outreach pacing lives. In Exo this mirrors the Audienti shape:

- `profile visits`
- `connection requests` / `invitations`
- `messages`

For LinkedIn work, `messages` covers direct messages and InMail. Fresh InMail credits are still a separate live observation, not a static config value.

The important distinction is:

- `capabilities` are declared intent
- `verifiedCapabilities` are what Exo can currently back with local evidence

Agents should prefer `verifiedCapabilities` and `profiles resolve` when deciding which browser identity to use.

Once a company has a pinned profile, agents should prefer:

- `exo companies profile show <company-id> --json`
- `exo profiles resolve --capability <capability> --company <company-id> --json`

That is the current stickiness model for keeping outreach on one identity.

## Current limitations

Exo does not yet prove live SaaS authentication from the CLI. A `ready` profile means the local browser context appears structurally usable. It does not yet prove that LinkedIn or Sales Navigator is logged in and entitled.

That means agents should still be conservative:

- use `profiles test` as a gate
- prefer explicit profile assignment once motions support it
- avoid unattended browser work when profile trust is unresolved
