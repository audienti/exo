# Browser Profiles

Browser profiles are now a first-class Exo object.

This is not a cosmetic setup concern. In practice, the wrong browser profile means:

- the wrong LinkedIn identity
- no Sales Navigator entitlement
- the wrong Gmail session
- the wrong HubSpot org
- browser automation that "works" mechanically while failing the actual business task

For Exo, that makes browser profile resolution a precondition for safe action.

The current defaults are tuned for macOS browser layouts because that is the environment we are actually operating in. Other environments can still work by passing explicit `--user-data-dir` and `--browser-command` values.

## Product rule

No browser-backed Exo action should run on a guessed browser context.

Exo needs to know:

- which browser
- which profile
- where that profile lives on disk
- what it is intended to be used for
- whether Exo can currently inspect and trust it
- when it was last tested
- what failed if it is not ready

## Current CLI

The current scaffold supports:

- `exo profiles discover`
- `exo profiles add`
- `exo profiles claim`
- `exo profiles list`
- `exo profiles show`
- `exo profiles capabilities`
- `exo profiles resolve`
- `exo profiles test`
- `exo profiles auth`
- `exo profiles remove`
- `exo companies execution show`
- `exo motion profile assign`
- `exo motion user assign`

## Discovery first

Before registration, Exo can scan the known browser roots and report candidate profiles:

```bash
exo profiles discover --json
exo profiles discover --browser chrome --json
```

This does not register anything. It reports:

- candidate browser profiles
- detected profile names
- local capability evidence
- whether a candidate is already registered in Exo

## Claim identity

Once you choose a registered profile, claim it as a business identity:

```bash
exo profiles claim <profile-id> \
  --label audienti-main \
  --owner william \
  --workspace audienti \
  --scope work \
  --account linkedin:operator-linkedin@example.com \
  --account gmail:operator-linkedin@example.com \
  --max-connection-requests 40 \
  --max-inmail-messages 20
```

That is how Exo moves from "browser mechanics" to "execution identity."
It is also where account-level weekly outreach pacing is configured.

## Weekly quotas

Exo should mirror the real Audienti control shape here instead of inventing a different one.

The durable weekly quota buckets are:

- `profile visits`
- `invitations` / connection requests
- `messages`

For LinkedIn work, `messages` is the pacing bucket that covers direct messages and InMail. Fresh InMail credits are still a separate live observation, not a static config knob.

Use:

```bash
exo profiles claim <profile-id> \
  --max-profile-visits 75 \
  --max-connection-requests 40 \
  --max-inmail-messages 20
```

You can edit those settings later by running `exo profiles claim` again on the same profile.

## Example

```bash
exo profiles add \
  --browser chrome \
  --label work-linkedin \
  --profile-directory "Profile 2" \
  --capability linkedin \
  --capability sales-navigator
```

If needed, override the defaults:

```bash
exo profiles add \
  --browser chrome \
  --label client-a \
  --user-data-dir "~/Library/Application Support/Google/Chrome" \
  --profile-directory "Profile 7" \
  --browser-command "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --capability linkedin \
  --capability sales-navigator \
  --capability gmail
```

Then:

```bash
exo profiles discover --json
exo profiles list
exo profiles capabilities --json
exo profiles resolve --capability linkedin --json
exo profiles show <profile-id>
exo profiles test <profile-id>
exo profiles auth <profile-id> --runtime codex --json
```

## Structural test vs live auth

`exo profiles test` is structural.
It checks whether the browser profile artifacts look usable on disk and whether local evidence still supports the declared capabilities.

`exo profiles auth` is live.
It uses a supported runtime:chrome adapter to verify whether the currently signed-in LinkedIn, Sales Navigator, Gmail, and HubSpot surfaces actually match the intended identity.

Use both before unattended browser-backed work:

```bash
exo profiles test <profile-id> --json
exo profiles auth <profile-id> --runtime codex --json
```

## Capabilities query

Capabilities are not just annotations. Exo now distinguishes between:

- declared capabilities
- verified capabilities

Declared capabilities are what the operator says the profile should be used for.

Verified capabilities are what Exo can currently support with local evidence from that profile.

The supported capability types are:

- `generic-web`
- `linkedin`
- `sales-navigator`
- `gmail`
- `hubspot`

Agents should query that directly instead of scraping `profiles show`.

Use:

```bash
exo profiles capabilities
exo profiles capabilities --json
exo profiles capabilities <profile-id>
exo profiles resolve --capability linkedin --json
```

That gives two useful views:

- per-profile declared vs verified capability state
- capability-to-profile coverage across the whole registry using verified capabilities
- a concrete answer to "which browser and which profile should I use?"

## Sticky engagement identity

Discovery and verification are not enough on their own.

Once a company is being worked, Exo should keep using one pinned identity consistently. The current first cut is company-level stickiness, with motion-level defaults when the company itself is not pinned:

```bash
exo companies profile assign <company-id> --profile <profile-id> --reason "Use one identity consistently"
exo companies profile show <company-id> --json
exo profiles resolve --capability linkedin --company <company-id> --json
exo motion user assign <motion-id> --user <user-id> --reason "Keep one execution identity for this motion" --json
exo companies execution show <company-id> --motion <motion-id> --capability linkedin --json
```

If a company has a pinned profile, `profiles resolve` should honor that assignment instead of drifting to another otherwise-valid browser identity.
If a company is still unpinned but the motion has a default execution identity, `companies execution show --motion` should honor that motion default before falling back to a global browser profile.

## Identity is not transport

`profiles resolve` answers:

- which browser
- which profile
- which company-pinned identity

It does **not** fully answer:

- which runtime transport to use first
- when to prefer the native Chrome surface over a relay
- how to recover when the browser-control path fails in a known way

For that, use:

```bash
exo companies execution show <company-id> --capability linkedin --json
```

That surface is where Exo should carry durable recovery rules such as:

- prefer native Chrome control first for Chrome-backed authenticated work
- do not start an unqualified Playwriter or relay session when multiple profiles or extensions are attached
- if a fallback relay is necessary, bind it explicitly to the resolved company profile
- if the local relay is stale, clear it once and retry instead of looping blind
- if LinkedIn invite UI hangs, break the send into observed steps and verify the resulting state before recording success

Those are product-level failure classes, not one operator's folklore. The reusable classes are:

- profile-selection ambiguity
- stale transport listener
- wrong signed-in account
- UI hang without state change
- connector unavailable

## What Exo verifies today

Exo verifies claimed capabilities when a profile is:

- added
- re-tested
- imported from config

## What `profiles test` currently verifies structurally

The first cut is local and non-invasive. It checks:

- user data directory exists
- profile path exists
- browser executable path exists
- `Local State` file exists
- `Preferences` file exists
- `Cookies` database exists
- `History` database exists
- whether the profile root appears locked/live

It also attempts to resolve the human profile name from Chrome-style metadata.

This is enough to detect a large class of overnight-run failures before work begins.

## What capability verification currently means

Capability verification is still local and evidence-based.

Today Exo treats:

- `generic-web` as structurally verified when the profile artifacts exist
- `linkedin` as verified from local LinkedIn cookie or history evidence
- `sales-navigator` as verified from local history evidence for LinkedIn Sales pages
- `gmail` as verified from local Google Mail cookie or history evidence
- `hubspot` as verified from local HubSpot cookie or history evidence

That is enough to stop agents from blindly assuming a profile can do something just because an operator typed the label.

## What it does not verify yet

It does not yet prove:

- live LinkedIn auth
- live Sales Navigator entitlement
- live Gmail access
- live HubSpot org access

Those need browser-action probes later.

## Why this matters for scheduled work

Overnight or unattended runs should fail closed if:

- no browser profile is attached
- the attached profile has never been tested
- the last test failed
- the resolved browser profile is ambiguous

That is the direction Exo should move:

- motion uses a declared profile
- profile has a status
- browser-backed actions gate on that status

## Near-term follow-ons

The next profile-aware steps after this registry should be:

1. Attach a profile to a motion or workspace.
2. Refuse browser-backed actions without a ready profile.
3. Add profile-specific browser probes for LinkedIn and Sales Navigator.
4. Add a doctor/audit command for unattended runs.
