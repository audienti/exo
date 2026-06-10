# Normalized Core & Parallel Execution Plan

- **Status:** locked — Codex converged 2026-06-10; conditional-approval fixes folded in
- **Date:** 2026-06-10
- **Target release:** 0.3.0 (breaking schema change; database reinitialization required)
- **Scope:** local-only. No Supabase, no sync, no cloud hub, no async storage interface.
- **Reference codebase:** `v10` (Rails, `~/Projects/omalab/v10`) — its profile/identity
  system encodes years of LinkedIn resolution and multi-channel enrichment lessons;
  `v10:` file references below point there.

## Why now

Four verified problems share one root cause — execution state (prospects, touches, drafts,
cadence) lives inside the motion `payload_json` blob:

1. **Lost-update race, reachable today.** `updateMotion` is a whole-blob rewrite with
   `WHERE id = ?` and no version check (`src/db/database.js:97`). The lane scheduler
   (commit `0ca1218`) runs a transport worker and a research worker concurrently by
   design; both mutate the same motion rows (sends record touches, research writes
   drafts). `docs/parallel-agent-access.md` additionally advertises parallel operator
   shells. Nothing guards the read-modify-write cycle — last write silently wins.
2. **Reads have write side effects.** `findMotionById`/`listMotions` repair-and-persist
   on read (`src/db/database.js:124-158`), so concurrent "read-only" view building can
   resurrect stale state mid-race.
3. **Repair machinery treats symptoms.** Three of the last ten commits hardened repair
   infrastructure. Hand-maintained aggregates over schema-validated blobs with no
   integrity constraints keep producing invalid shapes; constraints prevent them.
4. **In-memory joins a database should do.** `build-agent-queue.js` (1,988 lines) and
   `build-operator-view.js` (1,428 lines) re-hydrate ~700KB of blob per pass to answer
   "what is due?" Cross-motion questions ("every prospect with a pending draft") require
   parsing every motion.

**Why the no-migration window matters:** exo is pre-production. We can reinitialize the
database today. That means the schema lands in **final form** — including global person
identity, which would otherwise require risky dedupe/merge tooling against live data —
with zero backfill code, zero dual-write period, zero round-trip migration tests.
This is the cheapest this change will ever be.

## Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Reinitialize, don't migrate — clean break.** Delete `.exo/exo.db*`; tables recreate on first command. No blob-explosion code, no staged hybrid model, no interim dual-store phase is ever written or carried. Discarded execution state (due tasks, inbound observations, cues) is **intentionally disposable**: observations/cues rebuild via resumable sync, pipeline branches via normal motion execution. The cutover runbook records the operator's explicit go decision. | Pre-production; operator-approved wipe; migration code is a permanent tax for a one-time event |
| D2 | **Schema ships in final form now**, including `people` (global person identity), `activity_events` (permanent log), promoted cadence/queue columns. | "Easier to write now than migrate later" |
| D3 | **Keep sync `node:sqlite`.** No async storage interface. | No cloud backend planned; async-ifying 53+ call sites is churn with zero local payoff |
| D4 | **Reads keep the legacy view shape** via hydration (`listMotionViews()` assembles `targetMap` from rows). View builders and ~90 test files keep working day one; hot paths convert to SQL incrementally. | Bounds the blast radius of a kernel rewrite |
| D5 | **Writes go relational immediately.** No interim `mutateMotion` lock stopgap — we go straight to row/event writes + optimistic versioning. | Nothing built twice |
| D6 | **Events are permanent.** `activity_events` has no cascade delete; history survives motion removal and keys to person identity. | The "permanent activity log" requirement |
| D7 | **Out of scope:** Supabase/hub/sync, `--json` envelope standardization, handler thinning, multi-workspace columns. | Separate tracks; workspace boundary = the `.exo` directory itself |
| D8 | The plan also closes the **agent-runtime coordination gaps** found in review: missing lane locks in the scheduled path, missing merged pass summary, and the P0 TDZ crash. | Same workstream family; parallelism is unsafe without them |

## Target data model

### Entity relationships

Three global, first-class entities — **companies**, **people**, and **motions** — and
the link tables that relate them:

```
  companies ──────< motion_accounts >────── motions
      │                    │                   │
      │                    └────< prospects >──┘
      │                              │
      │                              ▼
      └────< employments >──────── people ────< contact_points
                                     │
                                     ▼
                       activity_events  (permanent log; soft refs to
                                         person/prospect/motion/company/user)

  prospect_drafts >── prospects        signal_matches >── motion_accounts
```

- **`companies`** — one row per real-world organization, independent of any motion
  (this table already exists; it gets final-form treatment below). Identified by
  domain / LinkedIn company URL; deduped at insert (find-or-create), not by motion.
- **`people`** — one row per human, independent of any company or motion.
- **`employments`** — the explicit person ↔ company relationship: *"this person works
  (or worked) at this company, with this title."* Written when a prospect is added,
  updated by enrichment/sync as roles change. This is what makes "who do we know at
  company X?" and job-change detection answerable across motions.
- **`motion_accounts`** — the company ↔ motion relationship: *"this motion targets
  this company."* Replaces the hand-maintained `company.motionIds[]` array.
- **`prospects`** — the motion-scoped *targeting assignment*: this motion engages this
  person **under** this account. Its `company_id` is targeting context ("which account
  this branch belongs to"), distinct from `employments` ("where they work") — normally
  the same company, but the distinction matters when a person changes jobs mid-motion:
  the employment row updates while the assignment stays put for history.
- **`activity_events`** — permanent record of what happened, keyed to person identity
  so history survives motions, assignments, and job changes.

Tables kept as-is: `users`, `browser_profiles`, `inbound_observations`, `inbound_cues`
(`inbound_observations` is the house pattern this plan generalizes: typed query columns +
`dedupe_key UNIQUE` + `payload_json` + indexes). One additive change: nullable
`person_id` column on `inbound_observations`, populated when sync resolves a prospect.

### Schema (consolidated baseline, final form)

`migrations.js` is rewritten as a **consolidated baseline** (version 1 = full schema
below). A guard detects a pre-0.3.0 ledger and exits with "reinitialize required"
instead of attempting repair.

```sql
-- EXISTING table, final form. One row per real-world organization, global across
-- motions. linkedin_company_url is promoted to a column (identity/matching key
-- alongside domain). payload keeps logos, notes, tags, engagement assignments.
-- motionIds[] is REMOVED from payload (membership lives in motion_accounts).
-- Dedupe is find-or-create at insert (by domain, then LinkedIn URL) — no UNIQUE
-- constraint on domain, since subsidiaries/brands can legitimately share one.
companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  search_name TEXT NOT NULL,
  domain TEXT,
  linkedin_company_url TEXT,
  website_url TEXT,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
)
CREATE INDEX companies_by_domain ON companies(domain);
CREATE INDEX companies_by_linkedin ON companies(linkedin_company_url);

-- Motion-core only: premise, offer, audiences, signals, cadence policy.
-- targetMap is GONE from payload_json. version enables optimistic concurrency.
motions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  source_url TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
)

-- Membership link that replaces company.motionIds[] <-> targetMap two-way bookkeeping.
-- execution_user_id is the queue-facing EXECUTION SCOPE: which user works this
-- account in this motion (NULL = unassigned, not selectable for execution work).
-- Written by the assignment flows (the operator-facing company engagement
-- assignment resolves onto this column when an account joins a motion). The agent
-- queue's due scan is prospects JOIN motion_accounts on this column — an explicit,
-- indexed join boundary; the queue NEVER rehydrates motion payloads for scoping.
-- Connector-account selection (which LinkedIn/Gmail identity sends) stays a
-- user-level concern resolved at execution time, not a queue-scan concern.
motion_accounts (
  id TEXT PRIMARY KEY,
  motion_id TEXT NOT NULL REFERENCES motions(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id),
  execution_user_id TEXT REFERENCES users(id),
  queue_status TEXT NOT NULL CHECK (queue_status IN
    ('discovered','queued_for_research','researched','selected','ready',
     'suppressed','exhausted')),
  packet_claimed_by TEXT, packet_claimed_at TEXT,      -- atomic claim columns
  last_research_at TEXT,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,                           -- notes, derived state
  UNIQUE (motion_id, company_id)
)
CREATE INDEX motion_accounts_by_user ON motion_accounts(execution_user_id);

-- Research evidence, append-mostly. Prospects soft-reference these by id.
signal_matches (
  id TEXT PRIMARY KEY,
  motion_account_id TEXT NOT NULL REFERENCES motion_accounts(id) ON DELETE CASCADE,
  motion_id TEXT NOT NULL, company_id TEXT NOT NULL,    -- denormalized for query
  observed_at TEXT, created_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL
)

-- Global person identity. One row per human; survives motions and job changes.
-- No title column: a title is a fact about an employment, not a person.
-- TWO LinkedIn keys, both real (see "Person identity resolution" below):
--   linkedin_member_id — the stable internal id (ACoAA...); case-PRESERVED.
--     Sales Navigator URLs and Unipile API payloads carry this one.
--   linkedin_public_id — the vanity slug from /in/<slug>; lowercased. User-editable,
--     so it can change; regular profile URLs carry this one.
people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  linkedin_member_id TEXT,                              -- strongest match key
  linkedin_public_id TEXT,
  primary_email TEXT,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL                            -- profile snapshots, enrichment
)
CREATE UNIQUE INDEX people_by_member_id ON people(linkedin_member_id)
  WHERE linkedin_member_id IS NOT NULL;
CREATE UNIQUE INDEX people_by_linkedin ON people(linkedin_public_id)
  WHERE linkedin_public_id IS NOT NULL;
-- UNIQUE per CRM norms (HubSpot/Marketo dedupe on email): a normalized email
-- address identifies one mailbox, and in B2B one mailbox is one person. The
-- resolver is the mediator — role/shared mailboxes (info@, sales@, …) are never
-- written here, weakly-attributed enricher emails go to review before claiming
-- the column, and a collision with disagreeing other keys surfaces as a conflict
-- instead of a constraint crash. The index is the backstop, not the policy.
CREATE UNIQUE INDEX people_by_email ON people(primary_email)
  WHERE primary_email IS NOT NULL;

-- Person-scoped contact points (kind: linkedin_profile, email, phone, ...).
-- Identity matching at insert resolves through this table. Review and dedupe
-- queries depend on match_status/confidence/source, so they are first-class
-- columns, not payload fields.
contact_points (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,                                  -- normalized
  verification_status TEXT NOT NULL CHECK (verification_status IN
    ('verified','observed','inferred','rejected','unknown')),
  match_status TEXT NOT NULL CHECK (match_status IN
    ('same_person_verified','same_person_probable','same_person_possible',
     'rejected')),
  confidence REAL,
  source TEXT,                                          -- which enricher/sync observed it
  observed_at TEXT,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,                           -- evidence detail, provenance
  UNIQUE (kind, value)
)
CREATE INDEX contact_points_review ON contact_points(match_status)
  WHERE match_status IN ('same_person_possible', 'same_person_probable');

-- The explicit person <-> company relationship: works/worked at, with what title.
-- Written on prospect add (person works at the targeted account); updated by
-- enrichment, sync, and job-change detection. One row per (person, company);
-- is_current + dates track transitions. Multiple current rows per person are
-- allowed (advisors, fractional roles). "Primary" employment is a selection RULE,
-- not a column (ported from v10's employment normalizer,
-- v10:app/services/profiles/linkedin_employment_normalizer.rb): current >
-- full-time > non-advisory (advisor|board|fractional|consultant de-prioritized) >
-- most recent start. Parsing gotcha ported with it: a bare-year caption ("2020")
-- is NOT a current role; only explicit current flags, "Present", or a missing
-- end date are.
employments (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id),
  title TEXT,
  is_current INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,                                 -- linkedin_profile | enrichment |
                                                        -- operator | inbound
  observed_at TEXT,                                     -- first observed
  ended_observed_at TEXT,                               -- observed ended (job change)
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,                           -- seniority/tenure evidence
  UNIQUE (person_id, company_id)
)
CREATE INDEX employments_by_company ON employments(company_id, is_current);
CREATE INDEX employments_by_person ON employments(person_id, is_current);

-- The motion-contextual assignment (today's embedded "prospect").
-- company_id is TARGETING context (which account this branch belongs to) — the
-- person's actual employer lives in employments; normally the same company, but
-- a mid-motion job change updates the employment while the assignment keeps its
-- history. Hot scheduler fields are promoted columns; judgment/research stays
-- in payload. Hydrated prospect.title resolves from the (person, company)
-- employment row.
prospects (
  id TEXT PRIMARY KEY,
  motion_id TEXT NOT NULL REFERENCES motions(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  motion_account_id TEXT NOT NULL REFERENCES motion_accounts(id) ON DELETE CASCADE,
  queue_status TEXT NOT NULL CHECK (queue_status IN
    ('discovered','queued_for_research','researched','selected','ready',
     'suppressed','exhausted','held_cross_motion')),
  cadence_status TEXT NOT NULL CHECK (cadence_status IN ('pending','ready')),
  cadence_current_step TEXT,
  cadence_next_action_due_at TEXT,
  cadence_last_touch_at TEXT,
  cadence_last_touch_outcome TEXT,
  packet_claimed_by TEXT, packet_claimed_at TEXT,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,                           -- whyRelevant, roleTruth, fit,
                                                        -- snapshots, signalMatchIds, notes
  UNIQUE (motion_id, person_id)
)
CREATE INDEX prospects_due ON prospects(cadence_status, cadence_next_action_due_at);
CREATE INDEX prospects_by_motion ON prospects(motion_id, queue_status);
CREATE INDEX prospects_by_company ON prospects(company_id);
CREATE INDEX prospects_by_person ON prospects(person_id);

-- Permanent append-only log: touches, timeline notes, system events.
-- NO cascade: history outlives motions and assignments. At least one of
-- person_id/prospect_id/motion_id required (enforced in kernel code).
activity_events (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('touch','timeline_note','system')),
  person_id TEXT, prospect_id TEXT, motion_id TEXT, company_id TEXT, user_id TEXT,
  surface TEXT,
  direction TEXT CHECK (direction IS NULL OR direction IN
    ('outbound','inbound','system')),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN
    ('pending','sent','accepted','ignored','opened-no-reply','replied',
     'blocked','nurture')),
  occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL                            -- summary, subject, body, urls, notes
)
CREATE INDEX activity_by_person ON activity_events(person_id, occurred_at DESC);
CREATE INDEX activity_by_prospect ON activity_events(prospect_id, occurred_at DESC);
CREATE INDEX activity_by_motion ON activity_events(motion_id, occurred_at DESC);
CREATE INDEX activity_by_user_time ON activity_events(user_id, occurred_at DESC);

-- Mutable status machine (drafting -> ready -> queued -> approved -> sent | discarded).
-- Approval/authorship are COLUMNS, not payload: send gating is a product contract
-- that reads them directly (today via build-agent-queue + draft-policy on the
-- embedded flags) — "approved means sendable" must be queryable and constrainable.
prospect_drafts (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  motion_id TEXT NOT NULL, person_id TEXT NOT NULL,     -- denormalized for query
  surface TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('linkedin','email')),
  status TEXT NOT NULL CHECK (status IN
    ('drafting','ready','queued','approved','sent','discarded')),
  authored_by TEXT NOT NULL CHECK (authored_by IN ('agent','operator')),
  edited_by_operator INTEGER NOT NULL DEFAULT 0 CHECK (edited_by_operator IN (0,1)),
  approved_by_operator INTEGER NOT NULL DEFAULT 0 CHECK (approved_by_operator IN (0,1)),
  approved_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  approved_at TEXT, sent_at TEXT,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL                            -- subject, body, notes
)
CREATE INDEX drafts_by_status ON prospect_drafts(status, updated_at DESC);
CREATE INDEX drafts_by_prospect ON prospect_drafts(prospect_id, status);
```

Queries this model unlocks day one (all impossible or full-blob-scans today):

- *Cross-motion suppression* — "have we ever touched this person?":
  `SELECT 1 FROM activity_events WHERE person_id = ? AND direction = 'outbound'`
- *Account relationship map* — "who do we know at company X, and what happened?":
  `employments WHERE company_id = ?` joined to `people` and `activity_events`
- *Job-change detection* — a sync/enrichment pass that observes a new employer closes
  the old employment row (`is_current = 0`, `ended_observed_at`) and opens a new one —
  a first-class GTM trigger signal, and the touch history follows the person
- *Due-work scan* — the agent queue's hot loop becomes an indexed query on
  `prospects(cadence_status, cadence_next_action_due_at)` **joined to
  `motion_accounts.execution_user_id`** for execution scope — never selecting work
  for the wrong user, never rehydrating a motion blob

### Person identity resolution

LinkedIn identity is **two-keyed**, and which key a source provides depends on where
the data came from:

| Source | Provides |
|--------|----------|
| Regular profile URL (`/in/<slug>`, incl. regional hosts like `ma.linkedin.com`) | public slug only |
| Sales Navigator URL (`/sales/lead/ACoAA…`, `/sales/people/ACoAA…`) | member id only |
| Unipile API payloads / inbound observations (`actorLinkedinMemberId`) | member id, sometimes both |
| URN forms (`urn:li:…`) | member id |

One resolver function becomes the single choke point for person matching
(consolidating what `resolve-inbound-observation-links.js` already does for inbound).
It is **a per-kind registry, not a LinkedIn function**: each contact-point kind
registers a normalizer + extractor + match priority. LinkedIn is the first fully
built-out entry; adding a network (or phone/email enrichment) adds a registry entry
and zero schema. Resolver input is `(name, [(kind, rawValue), …])` — never
network-specific parameters.

1. **URLs are never match keys.** Extract identifiers first, and **mine URLs before
   stripping them**: LinkedIn profile URLs can carry the member URN in query params
   (`?miniProfileUrn=…`, `?profileUrn=…`) — v10 extracts those into the opaque id
   rather than discarding them (`v10:app/services/utils/url/linkedin/parser.rb:5,35-56`).
   After mining, tracking params and fragments never reach a stored value; the
   canonical display URL is rebuilt from the slug, not stored as-scraped.
2. **Normalization is per-kind** (fresh-DB rule, set now): slugs and emails are
   trimmed + lowercased; **member ids are trimmed + case-preserved** — they are
   base64-flavored and case-significant, so today's lowercase fold in
   `normalizeContactValue` is corrected for this kind as part of WS3.
3. **Match order:** `linkedin_member_id` exact → `linkedin_public_id` exact →
   **email exact** → create new person. Member id wins because slugs are
   user-editable and absent from Sales Navigator sources. Email is a first-class
   identity key per CRM norms (one normalized address = one mailbox = one person in
   B2B), governed by the email policy below — the short version: role/shared
   mailboxes never match, and weakly-attributed enricher emails go to review
   instead of auto-merging. Two hard constraints ported from v10: **same-network
   username matches must be exact** (no fuzzy matching — prevents guess-merges on
   common names), and **name-only evidence is never sufficient to merge**.
4. **Key backfill, identifiers are never deleted.** Matching on one key while the
   source carries others fills the missing columns. When an identifier *changes*
   (vanity-slug edits are real), the old value **stays** as a `contact_points` row
   pointing at the same person — future scrapes will still present old slugs and
   must resolve correctly. This is v10's alias mechanism (`alias_username` /
   `alias_platform_id`) mapped onto `contact_points`.
5. **Conflict rule — never merge silently.** If a candidate matches on one key but
   another non-null key *disagrees* (slug matches an existing person whose stored
   member id differs — vanity-URL reassignment, scrape error, or two people), do not
   overwrite: record the disagreeing identifier as a `contact_points` row with
   `match_status = same_person_possible` and surface it in review. The contact-point
   schema already carries these statuses; the resolver finally uses them.

**Normalization conditions ported from v10** (reference implementation:
`v10:app/models/concerns/profiles/citation_id_parser.rb:65-105`; each becomes a
WS3 test case):

| Condition | Rule |
|-----------|------|
| Case-sensitive opaque ids (`AC[A-Za-z0-9_-]{8,}` containing uppercase) | never downcase — lowercasing breaks profile re-fetch |
| Double-encoded sequences (`%255c` → `%5c`) | percent-decode **one layer only**; looping over-decodes |
| Trailing encoded/literal slashes and backslashes (copied-URL leakage) | strip |
| Leading non-alphanumeric glyphs (emoji/bullets from SERP titles) | strip, Unicode-aware |
| Regional hosts (`ma.linkedin.com`), `www`, casing | host-insensitive slug extraction (already handled in exo) |
| Sales Navigator (`/sales/lead/ACoAA…`, `/sales/people/…`) and `urn:li:fsd_profile` forms | extract as member id, not slug |
| LinkedIn **company** pages: numeric id vs human-readable slug | both resolve to the company; prefer the human-readable slug as canonical |

**Email identity policy.** Email is a primary identity key, CRM-style (HubSpot and
Marketo dedupe contacts on email for the same reason): a properly normalized address
names one mailbox, and in B2B one mailbox is one person. `people.primary_email` is
UNIQUE on that basis. Three rules make "properly" concrete:

1. **Normalization per email norms** (the match key; raw form kept in evidence):
   - strip `mailto:`, display-name/angle-bracket forms (`"John Smith" <j@x.com>`),
     surrounding whitespace, and trailing scrape punctuation
   - **lowercase the entire address** — domains are case-insensitive by spec;
     local-part case-insensitivity is universal provider practice and the CRM norm
   - punycode-normalize IDN domains
   - **provider-alias variants are review-grade, not merge-grade**: plus-tags
     (`john+vendor@gmail.com`) and gmail dot-insensitivity (`j.ohn@` = `john@`)
     produce a *canonical variant* that, on match, yields `same_person_probable` →
     review — never a silent merge, since alias semantics are provider-specific
2. **Role/shared mailboxes are never identity keys** — `info@`, `sales@`,
   `support@`, `hello@`, `contact@`, `admin@`, `office@`, `team@`, `billing@`, etc.
   This is the actual collision class behind v10's caution (not webmail per se).
   They may still be stored as contact points; they never match or fill
   `primary_email`.
3. **Attribution confidence gates the merge, not the domain class.** A
   verified/observed personal email matching exactly → identity match. An email
   that is enricher-*inferred* (or below confidence threshold) on either side →
   `same_person_probable` → review. Domain class feeds confidence — a
   corporate-domain address corroborated by an employment at that company scores
   higher than uncorroborated webmail — but it modulates confidence rather than
   banning webmail from identity, which would be wrong by CRM norms.

### Multi-channel enrichment (designed in, not bolted on)

LinkedIn is the first network, not the only one — v10 already runs email, mobile
phone, and multi-social enrichment, and exo's model must not engineer those out.
It doesn't, by construction:

- **`contact_points.kind` is already the extension surface** — the existing schema
  enumerates `email`, `phone`, `x_profile`, `instagram_profile`, `facebook_profile`,
  `tiktok_profile`, `reddit_profile`, `website`, `generic_contact` alongside the
  LinkedIn kinds. An enricher for any of these writes contact_points rows + an
  `activity_events` provenance entry; no schema change.
- **Provenance convention** (ported from v10's contact storage): every enrichment-
  sourced contact point records `{ provider, confidence, validationStatus,
  validationSubStatus?, strategy, costCents?, observedAt }` in `payload_json`,
  with `verification_status` reflecting the outcome. Email validation states follow
  v10/ZeroBounce semantics: `valid` and `catch-all` are sendable, `invalid` and
  `unknown` are not — the transport send gate reads this, so a bad enrichment can't
  trigger a send.
- **Enrichers are research-lane task kinds** (`email_enrichment`,
  `phone_enrichment`, `social_discovery`, …) — additive entries in
  `agent-task-lanes.js`, scheduled like any research work, parallel-safe under WS4.
  Provider waterfalls (v10 runs Icypeas → Leadmagic → Prospeo → Findymail for email;
  Findymail → Leadmagic → Prospeo for phone) live inside the task executor; the
  *storage* model is provider-agnostic.
- **People payload carries per-network snapshots** keyed by kind, so an Instagram
  bio and a LinkedIn profile snapshot coexist without schema change.

### Multi-motion collisions on the same person

Multiple motions **will** discover the same people. The schema permits it —
`UNIQUE (motion_id, person_id)` means one assignment per motion, many per person —
and the policy governs engagement, not discovery:

- **Discovery/research:** any motion may hold an assignment for a person. Building
  the assignment is free; signal matches and research accrue per motion.
- **Engagement ownership — one motion actively works a person at a time.** Two gates:
  - *Selection gate:* when promoting an assignment toward `ready`, if the person has
    an in-flight outbound branch in another motion (live query over `prospects` +
    `activity_events` by `person_id`), the new assignment gets
    `queue_status = 'held_cross_motion'` with the owning motion recorded in payload —
    visible in planner views as "held behind <motion>", not silently dropped.
  - *Send gate:* the transport lane re-checks ownership immediately before executing
    a send (belt-and-suspenders against selection races under concurrent lanes).
- **Release:** when the owning branch reaches a terminal outcome (`replied`,
  `nurture`, `blocked`, exhausted, or its motion is archived), held assignments
  become eligible under the cadence policy's cooldown rules (e.g., quarterly-retouch
  windows) — the permanent `activity_events` log is what makes the cooldown
  computable across motions.
- **Companies don't need ownership.** Multiple motions targeting one company is
  normal (`motion_accounts` allows it); only person-level outreach collides.

### Schema/code seams

- `motionSchema` splits: **`motionCoreSchema`** (stored payload — premise, offer,
  audiences, signals, cadence policy) and **`motionViewSchema`** (hydrated shape,
  field-compatible with today's `motionSchema` including `targetMap`). Builders and
  tests consume the view shape.
- `src/db/database.js` (902 lines) splits into per-entity modules:
  `src/db/motions.js`, `people.js`, `prospects.js`, `motion-accounts.js`,
  `activity-events.js`, `drafts.js`, `signal-matches.js`, with `database.js` retaining
  connection management and re-exports.
- **Optimistic concurrency** for motion-core: `UPDATE motions SET ..., version = version + 1
  WHERE id = ? AND version = ?`; zero changed rows throws `MotionVersionConflictError`;
  a small retry helper wraps operator-facing callers.
- **Atomic packet claims** replace JSON packet-state read-modify-write:
  `UPDATE prospects SET packet_claimed_by = ?, packet_claimed_at = ? WHERE id = ? AND
  packet_claimed_by IS NULL RETURNING id` — claim and check in one statement.
- **Transactions** wrap multi-row operations (`recordActionResult` = event insert +
  prospect cadence update + draft status flip, atomically — fixing today's non-atomic
  multi-step writes).
- **Repair scope shrinks**: `rehydrateMotion` covers motion-core only. Prospect/touch
  repair paths are deleted — constraints make the malformed shapes unrepresentable.
  LLM-output contract repair (CLI boundary) stays.

---

## Workstreams

Ordering: WS0 ships immediately (the worker is down). WS1 and WS2 are small,
independent, and land before the branch. WS3 is the normalization branch (one cutover
merge). WS4 lands after cutover.

### WS0 — Unblock the worker (P0, ship today)

**Deliverables**
1. TDZ fix in `scripts/run-agent-host-pass.js`: hoist the four `HOST_STATE_LOCK_*`
   constants into the top-of-file constant block; move the `isMainModule` entry block
   to end-of-file.
2. **Startup host-state touch** (small behavior add that makes the bug testable): at
   pass start, release expired task leases / prune expired backoffs via
   `mutateHostState` and persist. Genuinely useful hygiene — and it guarantees every
   pass, including a noop pass, exercises the lock machinery.
3. Regression test executing the script **as a real main module**: `spawnSync(node,
   [script])` with `EXO_STATE_DIR` + cwd in a temp workspace whose
   `agent-host-state.json` is **seeded with an expired task lease**; assert exit 0,
   the lease released, and a written summary. Two cases: no lane,
   `EXO_AGENT_LANE=transport`.
   *Why the seeding matters (Codex verified empirically): an empty workspace exits 0
   on today's broken code — a noop pass never reaches `mutateHostState`, so the late
   lock constants are never touched. The test must force a host-state mutation
   during main-module execution or it catches nothing.*

**Acceptance:** the new test **fails against current `main`** (TDZ crash on the seeded
mutation), passes with the fix; plain empty-workspace smoke also exits 0.

**Operator gate at kickoff:** check `exo agent queue --json` (currently ~11 due:
7 inbound syncs + 4 sends). The WS3 wipe discards them. If the sends should go out
first, reinstall the routine
(`exo agent install-routine --runtime codex --interval 15m --send-mode verify --install`)
and let them drain in verify mode before starting WS3; the inbound syncs are
re-runnable and need no preservation. Either way the call is recorded explicitly —
not assumed.

### WS1 — `exo next` latency (independent quick win)

**Deliverables**
1. `buildNextView` accepts an optional prebuilt `description` and computes it **lazily**
   — only on the fallback paths (no user, bootstrap incomplete, no due daily item).
   `next.js` passes the one it already built. Kills the double `describeExo()`
   (2 × 571ms measured).
2. `describeExo` takes a lazy/lightweight path for `recommendedPath` so the fallback
   path doesn't rebuild a full daily view it was handed.

**Acceptance:** ≥60% latency reduction on `exo next --json` against the current
dataset (measured baselines: 1.67s and 2.41s on different runs/machines — interim
target ≲700ms), output JSON unchanged (snapshot test). WS1 is the cheap interim win,
not the final word: the true slim path ships in WS3 step 5, where the happy path
becomes an indexed due-prospect query + single-branch hydration with **no full
daily/capacity projection at all** — that is what delivers <500ms durably, and it
falls out of normalization rather than fighting the blob model.

### WS2 — Agent runtime coordination (independent of schema)

**Deliverables**
1. **Lane locks move into the pass script — and the pass script becomes the ONLY
   owner.** `run-agent-host-pass.js` acquires `tryAcquireAgentRunLock({ stateDir,
   lane })` at startup, exits with a noop summary when held. The CLI's duplicate
   acquisition is **removed** in the same change: `runWorkerLanePass` in
   `src/cli/commands/agent.js` stops taking the lane lock itself and instead
   interprets the child's noop summary ("lane lock held by pid N"). Lock path/format
   unchanged so `doctor` still reports holders. One mechanism, one owner — no
   double-lock ambiguity between scheduled, CLI, and direct-node entry points.
2. **Shell runner lock shrinks to a spawn guard** (released after spawning lanes, not
   held through `wait`): a long research pass no longer blocks the next transport pass.
3. **Merged summary fix**: each lane pass, at exit, regenerates `agent-last-pass.json`
   from the lane files under the host-state lock. `mergeLanePassSummaries` moves from
   `src/cli/commands/agent.js` into a shared lib module both call. (Today, in the
   scheduled path, nobody writes the merged file the UI server and doctor read.)
4. Routine artifact version bump + reinstall instructions in the runbook.

**Acceptance:** two concurrent invocations of the same lane → second exits noop (test
via spawned children); scheduled-style lane run leaves a fresh merged
`agent-last-pass.json`; transport lane can start while a research pass holds its lane lock.

### WS3 — Normalized core (the branch; one cutover merge)

**Decision: clean break, explicitly NOT a staged/tracer migration.** The alternative
(normalize drafts + events first while prospects stay in the blob, expand later) was
considered and rejected: cadence state lives on prospects and `recordActionResult`
mutates touches + cadence + drafts *together*, so a drafts/events-first stage forces
the send path to write **both stores in one operation** — two sources of truth, the
read-modify-write race reintroduced across stores, and interim compatibility code
that exists only to be deleted. That is the migration-shaped tax this plan refuses
to carry. Blast radius is managed differently: staged green commits, a mid-branch
tracer gate (below) that proves the send path on the new model before the surface
area grows, and the fact that cutover wipes the DB — a long-lived branch has no
data-drift risk here, only code-merge risk, in a single-developer repo.

Work happens on `feat/normalized-core`; `main` stays releasable. Suggested commit
sequence, each green:

1. **Schema baseline + compatible core writers** — rewrite `src/db/migrations.js`
   as consolidated version 1 (DDL above) + pre-0.3.0 ledger guard ("reinitialize
   required" error). Enable `PRAGMA foreign_keys = ON` alongside existing
   WAL/busy_timeout. *"Each green" constraint:* the new baseline adds NOT NULL
   columns to tables with existing writers (`motions.name`, `motions.schema_version`,
   `companies.schema_version`, `companies.linkedin_company_url`…), so this same
   commit updates `insertMotion`/`updateMotion`/`insertCompany`/`updateCompany` to
   write the new column set — the schema and its existing writers move together;
   new tables (no writers yet) are purely additive.
2. **Entity DB modules** — CRUD + query functions per table, with unit tests:
   companies find-or-create (match by domain, then LinkedIn company URL; create when
   no match), the **person identity resolver** (per-kind registry; member id →
   public slug → email → create; key backfill with old identifiers retained;
   conflict-to-review rule; URL mining for `miniProfileUrn`/`profileUrn` params;
   Sales Navigator/URN extraction; per-kind normalization incl. case-preserved
   member ids and the full v10 condition table), employment upsert + job-change
   transition (close old row, open new) + primary-employment selection rule, event append
   with dedupe-key conflict handling, atomic claim/release, draft status transitions,
   due-prospect scan (`prospects_due` index joined to
   `motion_accounts.execution_user_id` for scope), account relationship-map query
   (`employments` by company joined to people/events), **cross-motion ownership
   query** (in-flight outbound branch for person elsewhere).
3. **Schema split** — `motionCoreSchema` (stored) / `motionViewSchema` (hydrated,
   field-compatible with today's `motionSchema`); `hydrateMotionViews()` assembles
   `targetMap.accounts[].prospects[]` (with touches, drafts, timelineNotes, signal
   matches, derived contacts) from rows; `prospect.title` resolves from the
   (person, company) employment row, `prospect.name` from `people`. Contract test:
   a seeded fixture round-trips through hydration and parses under the existing
   `motionSchema` unchanged.
4. **Write paths flip** — rewrite the kernel mutators on rows/events, in transactions:
   - `record-prospect-touch` → event insert + prospect cadence-column update
   - `set-prospect-draft` / `markMotionProspectDraftSent` → draft row ops
   - `set-prospect-cadence`, `update-prospect` → prospect row updates
   - `record-prospect` (add) → company find-or-create + person resolve/upsert +
     employment upsert + prospect insert (one transaction)
   - `claim-target-account-packet` / `claim-motion-prospect-packet` → atomic claims
   - `record-action-result` → one transaction over the above
   - **cross-motion gates**: selection paths set `held_cross_motion` when the person
     is owned by another motion; the transport send path re-checks ownership before
     executing; terminal outcomes release held assignments per cooldown policy
   - `transition-inbound-observation`, `reconcile-connection-degrees`,
     `remove-motion` (FK cascades; events persist), `import-config`
   - `updateMotion` narrows to motion-core + version check; callers audited
     (53 call sites across 14 files; most become entity-module calls)
5. **Read paths** — `listMotions`/`findMotionById` return hydrated views (D4) so view
   builders/CLI/UI are untouched initially; repair-on-read persistence is **deleted**
   (reads become pure). Then convert the hot scans to SQL: `build-agent-queue` due-scan,
   outbound capacity counts, daily candidate selection, and the **slim next-candidate
   path** (`exo next` happy path = indexed due-prospect query + single-branch
   hydration, no full daily/capacity projection — the durable <500ms fix promised in
   WS1). Cold renderers stay on hydrated views and migrate opportunistically.

   > **Mid-branch tracer gate (must pass before commits 6+):** in a seeded temp
   > workspace, one due send executes end-to-end on the new model — agent queue
   > selects it from the indexed scan, the send records an `activity_events` row +
   > prospect cadence-column update + draft `sent` transition in one transaction —
   > **while a concurrent research-lane process writes a draft to a sibling prospect
   > of the same motion**. Both writes persist; nothing clobbers. This is the
   > tracer-bullet proof Codex asked for, delivered inside the branch instead of as
   > a shipped hybrid stage.

6. **Test repair + fixtures** — a `seedMotionView(view)` helper writes a legacy-shaped
   motion literal into rows so existing fixture-heavy tests port mechanically; repair
   the affected test files (expect: most of the ~90 files compile-and-pass via the
   hydrated shape; budget real time for the writers' tests).
7. **Race regression tests** — the lane-clobber scenario: concurrent draft write +
   touch record on the same motion from two processes; both persist. Optimistic-version
   conflict test on motion-core. Two-process atomic-claim contention test.
   **Identity tests** (the v10 condition table, case by case): Sales Navigator URL
   and `/in/` URL for the same human resolve to one person; a URL whose
   `miniProfileUrn` param carries the member id yields that id; param/fragment/
   regional-subdomain variants normalize identically; `%255c` decodes one layer and
   trailing `%5c`/slashes strip; leading emoji/bullet glyphs strip; member-id casing
   round-trips unfolded; an old slug retained as a contact point still resolves to
   the person after a vanity-URL change; slug-matches-but-member-id-disagrees lands
   in review instead of merging; bare-year employment caption is not current;
   advisory title loses primary-employment selection to a full-time role.
   **Email-policy tests**: `"John Smith" <John.Smith@Acme.COM>` and
   `john.smith@acme.com` resolve to one person (display-name strip + case fold);
   verified personal-email exact match resolves to the same person regardless of
   domain class (webmail included — CRM norm); `info@`/`sales@` overlap never
   merges and never fills `primary_email`; an enricher-inferred email match lands
   in review, not a silent merge; `john+vendor@gmail.com` vs `john@gmail.com`
   yields `same_person_probable` review, not auto-merge; a `primary_email`
   collision with disagreeing LinkedIn keys surfaces as a conflict, not a
   constraint crash. **Cross-motion tests**: second
   motion selecting an owned person is held (not dropped); terminal outcome releases
   the hold under cooldown; send-gate blocks a stale-selection race.
8. **Config portability** — `exo config export` emits motion-core playbooks (no
   execution state); import accepts **legacy bundles by stripping embedded
   `targetMap`/execution state** (zod transform), so today's export re-seeds tomorrow's
   DB. Browser profiles/users/companies import unchanged.
9. **Repair scope shrink** — delete prospect-level repair from `rehydrateMotion`;
   keep CLI-boundary contract repair.

**Acceptance:**
- Full test suite green on the branch.
- The race tests fail against `main`'s blob writes (demonstrating the bug) and pass on
  the branch.
- `exo next`, `exo daily`, `exo agent queue`, operator view, and the UI server produce
  shape-identical output against a seeded fixture workspace (snapshot comparison).
- Fresh-init smoke: delete temp DB → run CLI init-path → tables exist, doctor clean.
- No code path writes `targetMap` into `motions.payload_json` (grep gate in CI/test).

### WS4 — Parallel scale-out (post-cutover)

**Deliverables**
1. **Research-lane concurrency**: `EXO_AGENT_RESEARCH_CONCURRENCY` (default 2) research
   workers per pass. Safe now: row/event writes + atomic claims + task leases. Verify
   `chooseNextQueueTask` skips actively-leased tasks; add a two-worker race test (both
   pick the same task → one wins the lease, the other advances).
2. **Transport stays serial per identity** (anti-bot). Document the sharding key
   (`transport:<connector-account>`) as the future multi-identity path; do not build.
3. *(Optional, recommended)* **Per-lane scheduler cadence**: two launchd labels —
   transport every 5m (send/sync latency), research every 15m. Builds on WS2's
   per-lane locks.
4. Doctor surfaces per-lane status: last pass per lane, lock holders, concurrency setting.

**Acceptance:** a pass with 2+ research workers completes with disjoint task sets and a
coherent merged summary; transport cadence unaffected by a long research pass (observed
via doctor + logs across two scheduler fires).

---

## Cutover runbook (end of WS3)

**Step 0 — operator gate (explicit, recorded).** Before anything below: run
`exo agent queue --json` and review what the wipe discards. Facts to acknowledge:

- `exo config export` preserves **motions (playbooks), companies, browser profiles,
  and users only** (`src/core/export-config.js`) — NOT inbound observations, cues,
  prospects, touches, or drafts.
- Inbound observations and cues are **intentionally disposable**: they rebuild via
  resumable inbound sync from the connected accounts.
- Pipeline state (prospect branches, due sends) is **intentionally disposable**: it
  rebuilds via normal motion execution (discovery → research → selection → cadence).
- If currently-due sends should go out first, drain them in verify mode before
  cutover (WS0 operator gate); otherwise they are discarded here, deliberately.

Proceed only on an explicit yes.

```bash
# 1. Preserve playbooks + config (today's code)
exo config export --out ~/exo-backup/exo-config-pre-0.3.json
cp -R .exo ~/exo-backup/exo-state-pre-0.3        # belt-and-suspenders snapshot

# 2. Stop the scheduler
launchctl bootout gui/$(id -u)/com.williamflanagan.exo.queue-drainer || true

# 3. Land the branch
git checkout main && git merge --no-ff feat/normalized-core

# 4. Reinitialize state (THE wipe — sanctioned)
rm -f .exo/exo.db .exo/exo.db-wal .exo/exo.db-shm
rm -f .exo/agent-host-state.json .exo/agent-last-pass*.json

# 5. Re-seed playbooks (legacy bundle accepted; execution state stripped on import)
exo config import ~/exo-backup/exo-config-pre-0.3.json

# 6. Reinstall the routine (new artifact version, lane locks, merged summaries)
exo agent install-routine --runtime codex --interval 15m --send-mode verify --install
launchctl kickstart -k gui/$(id -u)/com.williamflanagan.exo.queue-drainer

# 7. Verify
exo agent doctor --json    # expect: stale=false, scheduler healthy, no blockers
exo agent queue --json     # pipeline rebuilds via discovery/research/sync passes
```

Expected post-wipe behavior: **companies (864), motions/playbooks, browser profiles,
and users are PRESERVED** — restored by the config import in step 5. **Observations
(1,587) and pipeline branches (prospects, touches, drafts) REBUILD** — via resumable
inbound backfill and normal motion execution (discovery → research → selection →
cadence). The currently-due sends are discarded unless drained pre-WS3 (see the WS0
operator gate).

## Out of scope (explicit)

- Supabase / cloud hub / sync engine / event-log replication
- Async storage interface (revisit only if a remote store becomes real)
- `--json` envelope standardization (separate small track)
- Command-handler thinning beyond what the write-path moves force
- Multi-workspace / workspace_id columns (the `.exo` dir is the workspace boundary)
- Cross-motion person merge tooling/UI (identity is in the schema; tooling only if
  duplicate people actually accumulate)
- Building the email/phone/social **enricher executors** and provider waterfalls
  (Icypeas/Leadmagic/Prospeo/Findymail/ZeroBounce et al.) — the schema, resolver
  registry, provenance convention, and task-lane model are designed for them in
  0.3.0; the executors land as their own post-0.3.0 track

## Risks

| Risk | Mitigation |
|------|------------|
| Hydration drift (view shape ≠ old blob shape) breaks builders subtly | Contract test: seeded rows → hydrate → parse under existing `motionSchema`; snapshot tests on `next`/`daily`/queue/UI outputs |
| Test-repair effort underestimated (~90 files) | `seedMotionView` fixture helper first; port tests mechanically; track count burned down in the branch |
| Person-identity matching wrong (over/under-merge) | Conservative resolver: exact member id → exact slug → exact email → new person; no fuzzy matching; URL params/forms stripped by extraction; cross-key disagreements go to review instead of merging |
| Hidden writers besides `database.js` | Verified none today (grep); add a test gate asserting no `targetMap` in stored motion payloads |
| Worker runs mid-rebuild on old code | Scheduler paused at cutover step 2; branch work doesn't touch the live DB until merge |
| WS3 branch blast radius (one cutover merge touches schema, writers, readers, tests) | Staged green commits; mid-branch tracer gate proves the send path on the new model before surface area grows; wipe-at-cutover removes data-drift risk entirely — remaining risk is code-merge only, in a single-developer repo. The rejected alternative (shipped hybrid stage) trades this bounded risk for dual-store writes on the send path |
| FK enforcement surfaces latent bad refs in new writes | `PRAGMA foreign_keys = ON` from day one + constraint-violation tests per module |

## Convergence record (questions resolved with Codex, 2026-06-10)

1. `signal_matches` as its own table — **agreed, table** (FK integrity with prospect
   soft-refs).
2. Promoted hot columns — **resolved**: execution scope
   (`motion_accounts.execution_user_id`) and draft approval/authorship
   (`authored_by`, `edited_by_operator`, `approved_by_operator`,
   `approved_by_user_id`) are columns; send gating and the due scan read columns,
   never payload. CHECK constraints added on all hot enums (draft status/channel,
   queue status, cadence status, event kind/direction/outcome, verification status,
   match status).
3. Research concurrency — **default 2, enabled only after normalized writes are
   proven** (WS4 is post-cutover by construction; the mid-branch tracer gate is the
   proof point). Per-lane launchd cadence stays optional in WS4.
4. Company dedupe — **agreed: find-or-create by domain → LinkedIn company URL, no
   UNIQUE on domain** (subsidiaries/brands can share one).
5. Cross-motion ownership — **agreed: strict one-motion-active-per-person for 0.3.0**;
   surface-level sharing can be relaxed later if wanted (relaxing is easy,
   retro-tightening is not).
