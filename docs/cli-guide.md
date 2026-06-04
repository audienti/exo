# CLI Guide

This is the practical guide for a human operator using Exo from the shell.

Exo is not a general browser automation tool. It is a GTM operating kernel with a CLI projection. That means the commands are about Exo objects and motions, not keystrokes or websites.

## Core operating rules

1. Run Exo from the same repo root when you want multiple shells or agent chats to share state.
2. Use `--json` when a downstream tool or agent needs structured output.
3. Treat browser profiles as a prerequisite for browser-backed work.
4. Do not let Exo guess which browser identity to use.
5. Treat config export/import as part of the normal operating model, not emergency cleanup.
6. Keep the noun consistent: use `exo companies ...`, not a mixed `company` / `companies` surface.

## Local state

Exo stores workspace-local state in:

```bash
.exo/exo.db
```

That path is resolved from the current working directory.

If you want several shells or agent chats to share one Exo store even when their working directories differ, set:

```bash
export EXO_STATE_DIR=/Users/williamflanagan/Projects/omalab/exo/.exo
```

## First operator flow

### 0. Ask Exo what it is

```bash
exo what-is-this
```

Or for agent-readable output:

```bash
exo what-is-this --json
```

### 1. Register the browser profile you expect to use

Discover local candidates first:

```bash
exo profiles discover --json
```

Then register the right one:

```bash
exo profiles add \
  --browser chrome \
  --label work-linkedin \
  --profile-directory "Profile 2" \
  --capability linkedin \
  --capability sales-navigator
```

Then claim the identity:

```bash
exo profiles claim <profile-id> \
  --label audienti-main \
  --owner william \
  --workspace audienti \
  --scope work \
  --account linkedin:wflanagan@audienti.com \
  --max-connection-requests 40 \
  --max-inmail-messages 20
```

Then verify it:

```bash
exo profiles list
exo profiles capabilities
exo profiles resolve --capability linkedin
exo profiles test <profile-id>
```

The important distinction is:

- declared capabilities are what you say the profile is for
- verified capabilities are what Exo can currently support with local evidence from that profile

For browser-backed work, rely on verified capability coverage and `exo profiles resolve`, not just the declared labels.

The claimed profile is also where weekly outreach pacing lives. In Exo, that mirrors the Audienti buckets:

- `profile visits`
- `connection requests` / `invitations`
- `messages`

### 2. Start a motion from the offer URL

```bash
exo motion start \
  --url https://example.com/product \
  --premise "This offer matters when regulated lenders enter more complex credit-decision environments." \
  --audience "Traditional FI risk owners" \
  --audience "BNPL modernization leaders" \
  --signal "company::Is there recent evidence that this company expanded into a more complex lending segment?" \
  --signal "person::Is there recent evidence that a senior risk owner was hired or promoted at this company?" \
  --geo "United States" \
  --icp regulated-enterprise \
  --industry banking,lending \
  --title "Chief Risk Officer"
```

Use `motion start` as the default path because it checks whether Exo already has motions for the same URL before it creates anything new.

If the URL already exists, choose the branch explicitly:

```bash
exo motion start --url https://example.com/product --existing continue --json
exo motion start --url https://example.com/product --existing clone --from <motion-id> --audience "BNPL modernization leaders" --json
```

The important distinction is:

- `name` is the short human-friendly label for the motion
- `premise` is the prediction you are testing
- `audience hypotheses` are the candidate ICP / role surfaces that might resonate
- `signals` are motion-specific questions plus observation methods

Exo now auto-generates a short motion codename like `boring-absurd-meerkat`. If you want to override it, pass `--name`.

If a motion is getting richer, move it into a config file instead of stuffing more shell flags into one command:

```bash
exo motion add --config ./actico.motion.json --json
```

Example motion seed:

```json
{
  "url": "https://example.com/product",
  "premise": {
    "statement": "This offer matters when regulated lenders enter more complex credit-decision environments."
  },
  "audienceHypotheses": [
    {
      "name": "Traditional FI risk owners",
      "companyCriteria": ["Regulated lenders", "Incumbent financial institutions"],
      "roleCriteria": ["Chief Risk Officer", "VP Risk"],
      "confidence": "moderate"
    },
    "BNPL modernization leaders"
  ],
  "signals": [
    {
      "scope": "company",
      "question": "Is there recent evidence that this company expanded into a more complex lending segment?",
      "whyItMatters": "Segment expansion usually increases policy and decisioning complexity.",
      "matchRule": "Match when site language, hiring, or news shows a move into more complex credit products.",
      "observationMethods": [
        {
          "surface": "google",
          "query": "site:company.com installment lending OR complex credit products"
        }
      ]
    },
    "person::Is there recent evidence that a senior risk owner was hired or promoted at this company?"
  ],
  "targetingProfile": {
    "geolocations": ["United States"],
    "industries": ["banking", "lending"],
    "targetTitles": ["Chief Risk Officer"]
  }
}
```

### 3. Inspect the stored motion and targeting loop

```bash
exo motion list
exo motion show <motion-id>
exo motion target <motion-id> --json
```

`exo motion target` is the governed readiness check. It walks the motion through:

- motion preflight
- browser gate
- company targeting
- prospect readiness
- cadence

It stops at `targeting-ready`. Exo does not write the message and it does not send the touch.

### 4. Add or inspect canonical companies

```bash
exo companies add --name Chainguard --domain chainguard.dev
exo companies list
exo companies find chainguard
exo companies motions <company-id>
exo companies research-brief <company-id> --json
exo companies signal-matches add <company-id> --signal <signal-id> --summary "Stored reason to talk" --json
exo companies prospects add <company-id> --name "Person Name" --title "Director Title" --email person@example.com --profile-viewed-at <iso-datetime> --live-signal-summary "Recent post shows channel activity" --why-relevant "Why this person matters now" --json
exo companies cadence set <company-id> --prospect <prospect-id> --current-step connection-request --next-action "Send the first touch" --json
exo companies profile assign <company-id> --profile <profile-id> --reason "Use one identity consistently"
exo companies profile show <company-id>
```

### 5. Export or import config when you need portability

```bash
exo config export --out ./exo-config.json
exo config import ./exo-config.json
```

## Output modes

### Human mode

Plain terminal output:

```bash
exo profiles list
exo motion show <motion-id>
```

### Agent mode

Structured output:

```bash
exo profiles list --json
exo motion show <motion-id> --json
exo motion add --url https://example.com/product --json
```

## Parallel agent access

Multiple agents can operate against the same Exo store at the same time.

The current model is:

- shared local SQLite state
- parallel reads
- serialized writes
- short object-level commands

That is enough for multiple parallel CLI invocations as long as they are all pointed at the same Exo store and they are not trying to hold long-lived write work open.

## Browser profile status

The current status meanings are:

- `ready`: profile looks usable for browser-backed work
- `warning`: profile exists, but Exo found non-fatal trust issues
- `invalid`: profile should not be used until repaired

The CLI currently checks local browser artifacts, not live SaaS auth. That is enough to catch many wrong-profile failures early, but it does not yet prove live LinkedIn or Sales Navigator access.

## Current command set

- `exo motion start`
- `exo motion add`
- `exo motion target`
- `exo motion clone`
- `exo motion update`
- `exo motion refresh`
- `exo motion list`
- `exo motion show`
- `exo motion remove`
- `exo companies add`
- `exo companies list`
- `exo companies find`
- `exo companies show`
- `exo companies motions`
- `exo profiles add`
- `exo profiles discover`
- `exo profiles claim`
- `exo profiles list`
- `exo profiles show`
- `exo profiles capabilities`
- `exo profiles resolve`
- `exo profiles test`
- `exo profiles remove`
- `exo config export`
- `exo config import`

## What is not built yet

The current CLI does not yet:

- attach a browser profile to a motion
- populate companies automatically from target retrieval
- probe live LinkedIn or Sales Navigator access
- build the real target map from browser retrieval
- drive browser actions through MCP

That is still ahead.
