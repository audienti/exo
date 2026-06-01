# Companies

Company is now a first-class Exo noun.

That does not mean Exo is becoming a CRM. It means the product finally has a canonical place to store:

- a company identity
- a domain
- optional company URLs
- motion links
- light operator notes

Without that, every future target list gets trapped inside a motion payload and the same company has to be rediscovered repeatedly.

## Current CLI

- `exo companies add`
- `exo companies list`
- `exo companies find`
- `exo companies show`
- `exo companies update`
- `exo companies motions`
- `exo companies research-brief`
- `exo companies signal-matches add`
- `exo companies signal-matches`
- `exo companies prospects`
- `exo companies prospects add`
- `exo companies through-line`
- `exo companies through-line set`
- `exo companies opening-plan`
- `exo companies opening-plan set`
- `exo companies cadence`
- `exo companies cadence set`

## Naming rule

The CLI keeps the noun consistent:

- `exo companies list`
- `exo companies find <term>`
- `exo companies show <company-id>`
- `exo companies motions <company-id>`

Do not split between `exo company ...` and `exo companies ...`. That would recreate the earlier naming mistake.

## What a company is right now

The current `company` object is the canonical entity.

It stores:

- `name`
- `domain`
- `websiteUrl`
- `linkedinCompanyUrl`
- `tags`
- `notes`
- `motionIds`

This is intentionally lighter than the eventual account brief or motion-account model.

What `exo companies show` now does:

- returns the canonical company object
- rolls up the linked motion set for that company
- groups duplicated prospect records into one company-level people view when identity is strong enough
- shows recent signals and touches across linked motions

That rollup is a view, not a second storage layer. The underlying signal, prospect, plan, cadence, and touch records still live on the motion-owned target account.

## Important distinction

Today:

- `company` is canonical identity
- `motionIds` tell you which motions currently care about it

Today the richer motion-specific layer now exists in a first real form on the motion-owned target account:

- per-motion signal matches
- chosen stakeholders
- first outreach plan

The company view now reads across those motion-owned branches so the operator can see one company-level history, but the writes still land on the motion-owned target account.

Automatic target ranking and full target-map generation are still ahead.

## Manual add path

Because motion retrieval is not built yet, the current company flow supports manual strategic accounts:

```bash
exo companies add \
  --name Chainguard \
  --domain chainguard.dev \
  --motion <motion-id> \
  --tag enterprise-security
```

Then:

```bash
exo companies list
exo companies find chainguard
exo companies show <company-id>
exo companies motions <company-id>
```

## Why this is the right next step

The prospect-finding motion eventually needs:

1. canonical company identity
2. motion-specific inclusion logic
3. stakeholder resolution on that company
4. account-level evidence and ranking

This company registry establishes step 1 cleanly instead of hiding companies inside motion blobs forever.

## Research brief

Use:

```bash
exo companies research-brief <company-id> --json
```

This is the governed bridge between:

- a motion with premise, audience hypotheses, and signals
- a canonical company
- live account research in the browser

The brief tells the agent to:

- confirm and store the canonical website
- search the company site first for first-party evidence
- search Google and recent web/news against the motion's signal questions
- keep signal matches recent enough to use in outreach
- choose a tight stakeholder set
- push to the best-fit owner when the org chart does not offer a perfect title match
- persist the chosen people and first outreach plan back into Exo

## Signal matches

When research finds a real reason-to-talk, store it:

```bash
exo companies signal-matches add <company-id> \
  --motion <motion-id> \
  --signal <signal-id> \
  --summary "Expanded merchant acceptance through new POS integration" \
  --source-url https://example.com/news \
  --observed-at 2026-05-01T00:00:00.000Z \
  --confidence high \
  --json
```

Inspect what is already stored:

```bash
exo companies signal-matches show <company-id> --motion <motion-id> --json
```

Important rule:

- signal matches are stored on the motion-owned target-account state, not on the canonical company object
- only store the strongest writer-usable signals, not every research scrap
- the stored signal line should be synthesized, concise, and impactful enough for the writer to reuse directly

That is because the same company can match different signals in different motions.

## Prospects

When the agent has enough evidence to choose people, store them on the motion-owned target account:

```bash
exo companies prospects add <company-id> \
  --motion <motion-id> \
  --name "Minh Le" \
  --title "Head of Risk" \
  --buying-committee-role primary_business_owner \
  --decision-authority influences \
  --email minh@example.com \
  --profile-viewed-at 2026-05-26T16:00:00.000Z \
  --signal-match <signal-match-id> \
  --active-channel linkedin \
  --activity-type own-post \
  --live-signal-summary "Recent post on merchant-risk growth suggests active LinkedIn use." \
  --live-signal-url https://www.linkedin.com/posts/example \
  --engagement-rationale "Recent public posting is positive evidence this channel is live enough for legitimate engagement." \
  --why-relevant "Best-fit owner for the decisioning-complexity story" \
  --json
```

Inspect the chosen people with:

```bash
exo companies prospects show <company-id> --motion <motion-id> --json
```

Important rule:

- prospects are motion-specific, not canonical-company data
- the motion's stakeholder count is enforced here as the first-pass prospect cap
- store why the person matters now, not just title and URL
- recent post activity is positive evidence the channel is active, so store the strongest usable hook when it exists
- store direct email when you can so the motion has a fallback when LinkedIn is blocked or produces no reply

## Through-line and opening plan

Once the signal matches and people are good enough, store the prospect-specific through-line and first opening plan:

```bash
exo companies through-line set <company-id> \
  --motion <motion-id> \
  --prospect <prospect-id> \
  --signal-match <signal-match-id> \
  --specific-to-them "Specific to them" \
  --shared-problem "Shared problem" \
  --why-now "Recent data-sharing and merchant-surface expansion increase decisioning complexity" \
  --legitimate-wedge "Give the likely owner a concrete reason to clarify ownership or priority rather than answer a generic pitch" \
  --compression-line "One-sentence compression line" \
  --json
```

```bash
exo companies opening-plan set <company-id> \
  --motion <motion-id> \
  --prospect <prospect-id> \
  --signal-match <signal-match-id> \
  --why-now "Recent data-sharing and merchant-surface expansion increase decisioning complexity" \
  --angle "Controlled expansion needs tighter risk and decisioning control" \
  --reply-path "Give the likely owner a concrete reason to clarify ownership or priority rather than answer a generic pitch" \
  --primary-channel connection-request \
  --fallback-channel email \
  --fallback-trigger "Use email if LinkedIn is blocked or there is no reply after the first LinkedIn touch." \
  --preflight-action "View the prospect profile" \
  --preflight-action "Engage the most recent relevant LinkedIn post only if the interaction is natural" \
  --first-move "LinkedIn connect plus short note" \
  --first-message-goal "Confirm ownership of risk and decisioning modernization" \
  --json
```

Read the stored plan with:

```bash
exo companies opening-plan show <company-id> --motion <motion-id> --prospect <prospect-id> --json
```

Important rule:

- the through-line and opening plan are prospect-specific
- they should be tied to stored signal matches
- they should store the most likely legitimate reply path, given the evidence, to get this person to answer
- Exo stores the plan and cadence; the agent still writes the actual message
- it should name the primary channel and the fallback path when LinkedIn is unavailable or cold
- it should store any preflight actions like profile view or a legitimate recent-post engagement
- it should stay concise enough to drive writing and execution directly
