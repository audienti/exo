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

- `exo profiles add`
- `exo profiles list`
- `exo profiles show`
- `exo profiles test`
- `exo profiles remove`

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
exo profiles list
exo profiles show <profile-id>
exo profiles test <profile-id>
```

## What `profiles test` currently verifies

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
