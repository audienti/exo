// @ts-check

import { listBrowserProfiles, listCompanies, listMotions, listUsers } from "../db/database.js";
import { describeStatePathRule } from "../db/paths.js";

/**
 * @returns {{
 *   name: string,
 *   version: string,
 *   identity: {
 *     oneLiner: string,
 *     purpose: string,
 *     interactionModel: string[]
 *   },
 *   notThis: string[],
 *   operatingRules: string[],
 *   currentCapabilities: Array<{ command: string, purpose: string }>,
 *   browserProfileRules: string[],
 *   agentUsage: {
 *     preferJson: boolean,
 *     bootstrapSequence: string[],
 *     sharedStatePath: string,
 *     sharedStateRule: string,
 *     recommendedPath: {
 *       mode: string,
 *       reason: string,
 *       focusMotionId: string | null,
 *       focusMotionName: string | null,
 *       blockers: string[],
 *       commands: string[]
 *     },
 *     responseStyle: {
 *       principle: string,
 *       rules: string[]
 *     },
 *     operatorGuidance: {
 *       principle: string,
 *       firstQuestion: string,
 *       modes: Array<{
 *         name: string,
 *         when: string,
 *         commands: string[]
 *       }>
 *     }
 *   },
 *   concurrency: {
 *     supported: boolean,
 *     model: string,
 *     requirements: string[]
 *   },
 *   stateSummary: {
 *     motions: {
 *       count: number,
 *       focusMotionId: string | null,
 *       focusMotionName: string | null,
 *       preview: Array<{ id: string, name: string, status: string, premiseStatus: string, sourceUrl: string, audienceCount: number, signalCount: number, nextStepCount: number }>
 *     },
 *     companies: {
 *       count: number,
 *       preview: Array<{ id: string, name: string, domain: string | null }>
 *     },
 *     browserProfiles: {
 *       count: number,
 *       readyCount: number,
 *       preview: Array<{ id: string, label: string, status: string, capabilities: string[] }>
 *     }
 *   },
 *   operatorInterface: {
 *     principle: string,
 *     conversationRules: string[],
 *     currentCall: {
 *       headline: string,
 *       nextMove: string,
 *       blockers: string[]
 *     }
 *   },
 *   gettingStarted: Array<{
 *     title: string,
 *     reason: string,
 *     commands: string[]
 *   }>,
 *   currentLimitations: string[],
 *   docs: Array<{ label: string, path: string }>
 * }}
 */
export function describeExo() {
  const motions = listMotions();
  const companies = listCompanies();
  const browserProfiles = listBrowserProfiles();
  const users = listUsers();
  const stateSummary = buildStateSummary(motions, companies, browserProfiles, users);
  const recommendedPath = buildRecommendedPath(stateSummary);
  const operatorInterface = buildOperatorInterface(recommendedPath);

  return {
    name: "Exo",
    version: "0.1.0",
    identity: {
      oneLiner: "Exo is a GTM operating kernel and system of record exposed through a local CLI and later through MCP.",
      purpose:
        "Exo turns an offer plus a premise, audience hypotheses, signals, targeting, and suppression inputs into durable GTM state, then uses that state to govern agent behavior, browser-backed execution, and GTM action.",
      interactionModel: [
        "Claude or Codex uses the CLI with --json or the future MCP layer.",
        "The agent guides the operator; Exo is not primarily a human-first shell product.",
        "Exo is queryable, but its main purpose is to drive behavior, act as the GTM system of record, and enforce governance.",
        "Browser-backed work is gated by an explicit registered browser profile."
      ]
    },
    notThis: [
      "a generic browser automation framework",
      "a CRM replacement",
      "an AI SDR",
      "a sequence builder",
      "a proprietary prospect database"
    ],
    operatingRules: [
      "Run from the same repo root when shared Exo state matters.",
      "Prefer --json when another agent needs structured output.",
      "Treat Exo as the GTM system of record. If you learn something durable, write it back.",
      "Opening the Exo state store may apply versioned local database migrations.",
      "Do not guess browser identity. Register and test a browser profile first.",
      "Treat browser profile status as a gate for browser-backed work, not a hint.",
      "In Codex, prefer the native Chrome browser harness for Chrome-backed authenticated work. Do not default to Playwriter."
    ],
    currentCapabilities: [
      {
        command: "exo what-is-this",
        purpose: "Return the product identity, operating rules, capabilities, and limitations."
      },
      {
        command: "exo actions list/show",
        purpose: "Inspect the canonical Audienti-style GTM action catalog that Exo uses for action readiness and execution briefs."
      },
      {
        command: "exo inbound surfaces/surface/cues add/list/resolve/sync show/plan/live/linkedin/linkedin-live/gmail/gmail-live/run/set/record/observations list/show/add",
        purpose: "Inspect the canonical inbound truth surfaces, record ambient inbound cues, manage per-account sync policy, run one governed mixed-account live inbound pass plus the first direct LinkedIn and Gmail live retrieval slices through supported runtimes, and read or write normalized inbound observations."
      },
      {
        command: "exo inbound review",
        purpose: "Show the management surface for inbound state: which surfaces were checked, which concrete items need review, which sent invites are stale, and where sync counted items without itemizing them."
      },
      {
        command: "exo inbox",
        purpose: "Show the ranked triage surface of meaningful inbound changes and the next move each one may justify."
      },
      {
        command: "exo daily",
        purpose: "Show the planner agenda that reconciles prospect cadence, inbound observations, ambient sync cues, working-hours windows, and configured connection-request pacing into due-now, waiting, deficit, and inbound-overridden next moves."
      },
      {
        command: "exo next",
        purpose: "Show the strongest governed next move right now by preferring the daily agenda, then the motion path, then the general operator call."
      },
      {
        command: "exo report motion",
        purpose: "Render one unified motion report that combines setup, readiness, company progress, prospect progress, and next actions."
      },
      {
        command: "exo report workspace",
        purpose: "Render one read-only workspace projection across inbound truth surfaces, motions, prep state, engagement state, and planner pressure."
      },
      {
        command: "exo config export/import",
        purpose: "Export and import motions, companies, browser profiles, and execution users as portable Exo configuration."
      },
      {
        command: "exo companies add/list/find/show/update/motions/research-brief/signal-matches show/add/prospects show/add/update/claim/complete/through-line show/set/opening-plan show/set/cadence show/set/touches show/add/profile show/assign/user show/assign/execution show",
        purpose: "Manage canonical companies, persist website and company-page identity, generate governed company research briefs, store synthesized concise writer-ready motion-specific signal matches, persist chosen prospects, their through-lines, their opening plans, their cadence state, their touch history, inspect one cross-motion company rollup, pin either a sticky engagement profile or a cross-capability execution user when outreach starts, and inspect the resolved execution plan with optional motion-level fallback."
      },
      {
        command: "exo motion intake/start/add/seed/discover/target/packets/packet-brief/prospects/actions/action-brief/drafts/draft-brief/clone/update/pause/resume/archive/restart/refresh/list/show/profile show/assign/user show/assign/remove",
        purpose: "Ask one intake question at a time before launch, start a motion from an offer URL, force reuse-or-branch decisions when that URL already exists, evaluate targeting readiness, inspect targeted prospects and writing inputs, inspect prospect-scoped action readiness and execution briefs, inspect Audienti-style draft cases, inspect one compact single-surface draft brief for chat writing, assign one sticky execution identity at motion scope, and then create, branch, refine, pause, resume, archive, restart, refresh, enumerate, inspect, and remove offer-driven motion state built around premise, audience hypotheses, and motion-specific signals."
      },
      {
        command: "exo profiles discover/add/claim/list/show/capabilities/resolve/test/auth/remove",
        purpose: "Discover local browser profiles, claim them as business identities, store account-level weekly outreach quotas, verify claimed capabilities, probe live signed-in readiness, resolve the right browser identity, and query capability coverage for browser-backed Exo work."
      },
      {
        command: "exo users add/list/show/working-hours show/set/harness add/probe/accounts add/resolve",
        purpose: "Manage human execution identities that own connected accounts across browser profiles and harness connectors, define the user's working-hours window for planner pressure, probe the current runtime for callable harness paths, and then resolve the right account for each capability."
      }
    ],
    browserProfileRules: [
      "Browser-backed work should fail closed if no profile is attached or trusted.",
      "A ready profile means the local browser context looks structurally usable.",
      "Profile checks do not yet prove live LinkedIn, Sales Navigator, Gmail, or HubSpot auth.",
      "Inbound sync policy and normalized inbound observations can now be governed per connected account. Gmail can now be retrieved live through supported runtime adapters, including runtime:gmail harness-backed accounts and trusted Chrome profiles plus runtime:chrome harnesses. LinkedIn's authoritative quick surfaces can now be retrieved through a trusted Chrome profile plus a supported runtime:chrome harness in either bounded quick mode or full reconciliation mode, but broader inbound retrieval still needs dedicated producers. In Codex desktop shell mode, Exo now returns an agent-side live-capture contract instead of shelling out to codex exec.",
      "Configured weekly quotas on the claimed profile identity should govern outreach pacing. InMail credits are still a separate live observation, not a static config knob.",
      "Exo resolves browser identity. The agent runtime should choose the browser-control harness.",
      "In Codex, prefer the Chrome skill or native Chrome connector before Playwriter for Chrome-profile work."
    ],
    agentUsage: {
      preferJson: true,
      bootstrapSequence: [
        "exo what-is-this --json",
        "exo companies list --json",
        "exo profiles discover --json",
        "exo profiles list --json",
        "exo profiles capabilities --json",
        "exo users list --json",
        "exo inbound surfaces --json",
        "exo inbound sync show <user-id> --json",
        "exo inbound sync plan <user-id> --mode quick --json",
        "exo inbound cues list <user-id> --json",
        "exo inbound review <user-id> --json",
        "exo inbound observations list <user-id> --json",
        "exo inbox --user <user-id> --json",
        "exo daily --user <user-id> --json",
        "exo next --json",
        "exo profiles resolve --capability linkedin --json",
        "exo motion list --json"
      ],
      sharedStatePath: "EXO_STATE_DIR/exo.db or ./.exo/exo.db",
      sharedStateRule: describeStatePathRule(),
      recommendedPath,
      responseStyle: {
        principle:
          "Translate Exo state into an operator judgment and next move. Treat Exo as the system of record, not as a passive status feed. Do not speak like you are reading source code or field paths.",
        rules: [
          "Lead with the conclusion.",
          "Keep the operator-facing reply as short as the decision allows.",
          "State the governed next move in plain English.",
          "When Exo exposes a direct operator question, ask that question before offering process detail.",
          "Mention ids or commands only when they are operationally necessary.",
          "Do not narrate JSON field names unless the operator explicitly asks for raw structure.",
          "Do not describe shell bootstrapping, state-path setup, sync modes, or writeback mechanics unless the operator explicitly asks or the workflow is blocked."
        ]
      },
      operatorGuidance: {
        principle:
          "Do not just enumerate Exo commands. First identify what the operator is trying to do, then guide them through the relevant Exo path and persist durable findings back into Exo.",
        firstQuestion:
          "Are we continuing an existing motion, creating a new motion, preparing browser-backed work, or managing canonical company state?",
        modes: [
          {
            name: "continue-motion",
            when: "Use this when motions already exist and the operator is trying to inspect or continue one.",
            commands: [
              "exo motion list --json",
              "exo report motion <motion-id> --json",
              "exo motion show <motion-id> --json",
              "exo motion target <motion-id> --json",
              "exo motion prospects <motion-id> --json",
              "exo motion prospects <motion-id> --prospect <prospect-id> --json",
              "exo motion actions <motion-id> --prospect <prospect-id> --json",
              "exo motion action-brief <motion-id> --prospect <prospect-id> --action connection_request --json",
              "exo motion drafts <motion-id> --prospect <prospect-id> --json",
              "exo motion draft-brief <motion-id> --prospect <prospect-id> --surface connection_request --json",
              "exo motion update <motion-id> --audience \"Primary ICP\" --title \"Chief Risk Officer\" --json",
              "exo motion clone <motion-id> --audience \"Secondary ICP\" --segment alt-segment --json",
              "exo motion pause <motion-id> --json",
              "exo motion resume <motion-id> --json",
              "exo motion archive <motion-id> --json",
              "exo motion restart <motion-id> --json"
            ]
          },
          {
            name: "create-motion",
            when: "Use this when the operator wants to set up a new motion and you need to ask for specifics one at a time before launch.",
            commands: [
              "exo motion intake --json",
              "exo motion intake --url https://example.com/product --json",
              "exo motion intake --url https://example.com/product --premise \"This offer matters when ...\" --audience \"Primary ICP\" --json",
              "exo motion start --url https://example.com/product --premise \"This offer matters when ...\" --audience \"Primary ICP\" --signal \"company::Is there recent evidence that ...?\" --json"
            ]
          },
          {
            name: "prepare-browser-work",
            when: "Use this before any LinkedIn, Sales Navigator, Gmail, or HubSpot work that depends on a real browser identity.",
            commands: [
              "exo profiles discover --json",
              "exo profiles claim <profile-id> --label workspace-main --workspace workspace --account linkedin:operator-linkedin --max-connection-requests 40 --max-inmail-messages 20 --json",
              "exo users add --label operator-main --owner operator --json",
              "exo users harness probe <user-id> --runtime codex --json",
              "exo users harness probe <user-id> --runtime claude --json",
              "exo users accounts add <user-id> --capability linkedin --handle operator-linkedin --profile <profile-id> --preferred --json",
              "exo users accounts add <user-id> --capability gmail --handle operator@example.com --runtime codex --connector gmail --preferred --json",
              "exo users accounts add <user-id> --capability gmail --handle operator@example.com --runtime claude --connector gmail --preferred --json",
              "exo users harness add <user-id> --runtime codex --connector chrome --status unknown --json",
              "exo users harness add <user-id> --runtime claude --connector chrome --status unknown --json",
              "exo profiles auth <profile-id> --runtime codex --json",
              "exo inbound sync linkedin-live <user-id> --account <account-id> --runtime codex --json",
              "exo inbound sync gmail-live <user-id> --account <account-id> --json",
              "exo profiles list --json",
              "exo profiles capabilities --json",
              "exo users list --json",
              "exo profiles resolve --capability linkedin --json",
              "exo profiles test <profile-id> --json"
            ]
          },
          {
            name: "manage-companies",
            when: "Use this when the operator needs to inspect or add canonical companies explicitly.",
            commands: [
              "exo companies list --json",
              "exo companies add --name ExampleCo --domain example.com --motion <motion-id> --json",
              "exo companies update <company-id> --website-url https://example.com --json",
              "exo companies research-brief <company-id> --json",
              "exo companies signal-matches add <company-id> --signal <signal-id> --summary \"Stored reason to talk\" --json",
              "exo companies signal-matches show <company-id> --json",
              "exo companies prospects add <company-id> --name \"Person Name\" --title \"Director Title\" --email person@example.com --profile-viewed-at <iso-datetime> --live-signal-summary \"Recent post shows channel activity\" --why-relevant \"Why this person matters now\" --json",
              "exo companies prospects update <company-id> --prospect <prospect-id> --email person@example.com --source-url https://example.com/profile --observed-at <iso-datetime> --json",
              "exo companies through-line set <company-id> --prospect <prospect-id> --signal-match <signal-match-id> --specific-to-them \"Specific to them\" --shared-problem \"Shared problem\" --why-now \"Why now\" --legitimate-wedge \"Why they would reply\" --compression-line \"One sentence\" --json",
              "exo companies opening-plan set <company-id> --prospect <prospect-id> --signal-match <signal-match-id> --why-now \"Reason to talk now\" --angle \"Opening angle\" --reply-path \"Why this person would legitimately reply now\" --primary-channel connection-request --fallback-channel email --fallback-trigger \"Use email if LinkedIn is blocked or there is no reply.\" --preflight-action \"View the prospect profile\" --first-move \"First move\" --first-message-goal \"Desired response\" --json",
              "exo companies cadence set <company-id> --prospect <prospect-id> --current-step connection-request --next-action \"Send the first touch\" --json",
              "exo companies profile assign <company-id> --profile <profile-id> --reason \"Use one identity consistently\" --json",
              "exo companies user assign <company-id> --user <user-id> --reason \"Use one human identity across LinkedIn and email\" --json"
            ]
          }
        ]
      }
    },
    concurrency: {
      supported: true,
      model: "Multiple CLI processes can share one Exo state store. Reads happen in parallel and writes are serialized through SQLite.",
      requirements: [
        "Point every agent shell at the same state store using EXO_STATE_DIR or the same repo root.",
        "Keep commands short and object-level. Do not hold long-running write transactions.",
        "Treat browser profiles as shared execution identity and re-test them before unattended work."
      ]
    },
    stateSummary,
    operatorInterface,
    gettingStarted: buildGettingStarted(stateSummary),
    currentLimitations: [
      "No MCP wrapper yet.",
      "Live browser auth probes now exist for trusted Chrome profiles through supported runtime:chrome adapters, but Exo still does not do broader cross-browser auth proof or live non-browser connector auth proof by itself.",
      "Limited live inbound retrieval now exists for Gmail and for LinkedIn's authoritative quick surfaces through supported runtime adapters, including full reconciliation mode for those LinkedIn quick surfaces, but Exo still does not do broader LinkedIn or other inbound retrieval by itself. In Codex desktop shell mode, native live capture still has to be performed by the outer agent and then landed through Exo's governed writeback path.",
      "Ambient inbound cues and working-hours-aware sync pressure now exist, but cues are still suspicion rather than truth and the planner still depends on governed sync runs to confirm what actually changed.",
      "Motion-level sticky execution defaults now exist, but canonical company execution still needs explicit motion context when the same company belongs to more than one motion.",
      "No automatic company population from motion retrieval yet.",
      "No real Sales Navigator retrieval yet.",
      "No automatic target-map or stakeholder-map generation yet, even though Exo can now persist manual target-account signal matches, prospects, through-lines, opening plans, and cadence state.",
      "No automatic prospect selection, through-line synthesis, or opening-plan generation yet. Agents still need to choose and write back the people, the reply-path hypothesis, and the first move explicitly.",
      "Limited runtime auto-discovery now exists for Codex harness connectors through local Codex config inspection and for Claude through CLI plugin and MCP inspection, but Exo still does not do full cross-runtime availability inspection or live connector auth probes by itself.",
      "No full multi-channel pacing model yet. Exo can now compute LinkedIn invitation deficit when the claimed browser profile has a stored quota, but broader channel saturation and capacity balancing are still future work.",
      "No public bug-reporting or feature-request intake yet. That is a future alpha feature, not current scope."
    ],
    docs: [
      { label: "Installation", path: "docs/installation.md" },
      { label: "CLI Guide", path: "docs/cli-guide.md" },
      { label: "Agent Usage", path: "docs/agent-usage.md" },
      { label: "Companies", path: "docs/companies.md" },
      { label: "Browser Profiles", path: "docs/browser-profiles.md" },
      { label: "Action Catalog", path: "docs/action-catalog.md" },
      { label: "Inbound Sync", path: "docs/inbound-sync.md" },
      { label: "Inbound Review", path: "docs/inbound-review.md" },
      { label: "Inbox", path: "docs/inbox.md" },
      { label: "Daily", path: "docs/daily.md" },
      { label: "Next", path: "docs/next.md" },
      { label: "Go-Live Checklist", path: "docs/go-live-checklist.md" },
      { label: "Config Portability", path: "docs/config-portability.md" },
      { label: "CLI and MCP Contract", path: "docs/cli-mcp-contract.md" }
    ]
  };
}

/**
 * @param {unknown[]} motions
 * @param {unknown[]} companies
 * @param {unknown[]} browserProfiles
 * @param {unknown[]} users
 */
function buildStateSummary(motions, companies, browserProfiles, users) {
  const rankedMotions = motions
    .map((motion) => ({
      id: motion.id,
      name: motion.name,
      status: motion.status,
      premiseStatus: motion.premise?.status ?? "missing",
      sourceUrl: motion.offer?.sourceUrl ?? "unknown",
      audienceCount: Array.isArray(motion.audienceHypotheses) ? motion.audienceHypotheses.length : 0,
      signalCount: Array.isArray(motion.signals) ? motion.signals.length : 0,
      nextStepCount: Array.isArray(motion.nextSteps) ? motion.nextSteps.length : 0
    }))
    .sort(compareMotionPreview);
  const activeMotionPreview = rankedMotions.filter((motion) => motion.status === "active");
  const focusMotion = activeMotionPreview[0] ?? rankedMotions[0] ?? null;

  return {
    motions: {
      count: motions.length,
      focusMotionId: focusMotion?.id ?? null,
      focusMotionName: focusMotion?.name ?? null,
      activeCount: activeMotionPreview.length,
      preview: rankedMotions.slice(0, 3)
    },
    companies: {
      count: companies.length,
      preview: companies.slice(0, 3).map((company) => ({
        id: company.id,
        name: company.name,
        domain: company.domain ?? null
      }))
    },
    browserProfiles: {
      count: browserProfiles.length,
      readyCount: browserProfiles.filter((profile) => profile.status === "ready").length,
      preview: browserProfiles.slice(0, 3).map((profile) => ({
        id: profile.id,
        label: profile.label,
        status: profile.status,
        capabilities: Array.isArray(profile.verifiedCapabilities) ? profile.verifiedCapabilities : []
      }))
    },
    users: {
      count: users.length,
      preview: users.slice(0, 3).map((user) => ({
        id: user.id,
        label: user.label,
        accountCount: Array.isArray(user.accounts) ? user.accounts.length : 0
      }))
    }
  };
}

/**
 * @param {{
 *   motions: { count: number, focusMotionId: string | null, focusMotionName: string | null, activeCount: number, preview: Array<{ id: string, name: string, status: string, premiseStatus: string, sourceUrl: string, audienceCount: number, signalCount: number, nextStepCount: number }> },
 *   companies: { count: number, preview: Array<{ id: string, name: string, domain: string | null }> },
 *   browserProfiles: { count: number, readyCount: number, preview: Array<{ id: string, label: string, status: string, capabilities: string[] }> }
 * }} stateSummary
 */
function buildGettingStarted(stateSummary) {
  /** @type {Array<{ title: string, reason: string, commands: string[] }>} */
  const steps = [];

  if (stateSummary.motions.count > 0) {
    const firstMotion = stateSummary.motions.preview[0];
    steps.push({
      title: "Inspect the existing motion state first",
      reason:
        "This store already has motions. Do not create another one until you understand whether you are continuing an existing motion or starting a new one.",
      commands: [
        "exo motion list --json",
        `exo motion show ${firstMotion.id} --json`,
        `exo motion target ${firstMotion.id} --json`,
        `exo motion update ${firstMotion.id} --audience "Primary ICP" --title "Chief Risk Officer" --json`,
        `exo motion clone ${firstMotion.id} --audience "Secondary ICP" --segment alt-segment --json`
      ]
    });
  } else {
    steps.push({
      title: "Create the first motion",
      reason:
        "Exo is motion-first. If there is no motion yet, start from the offer URL so Exo can confirm what is being promoted and check for reuse before creating state.",
      commands: [
        "exo motion intake --json",
        "exo motion start --url https://example.com/product --premise \"This offer matters when ...\" --audience \"Primary ICP\" --signal \"company::Is there recent evidence that ...?\" --json"
      ]
    });
  }

  if (stateSummary.browserProfiles.count === 0) {
    steps.push({
      title: "Register a browser profile before browser-backed work",
      reason:
        "Profiles are empty. That means Exo currently has no trusted browser identity for LinkedIn, Sales Navigator, Gmail, or HubSpot work.",
      commands: [
        "exo profiles discover --json",
        "exo profiles add --browser chrome --label work-linkedin --profile-directory \"Profile 2\" --capability linkedin --capability sales-navigator --json",
        "exo profiles claim <profile-id> --label workspace-main --workspace workspace --account linkedin:operator-linkedin --json",
        "exo profiles capabilities --json",
        "exo profiles resolve --capability linkedin --json",
        "exo profiles test <profile-id> --json"
      ]
    });
  } else {
    steps.push({
      title: "Check profile coverage before touching the browser",
      reason:
        "Profiles already exist. Verify that one of them actually covers the capabilities you need before you assume Exo can use the browser safely.",
      commands: [
        "exo profiles discover --json",
        "exo profiles list --json",
        "exo profiles capabilities --json",
        "exo profiles resolve --capability linkedin --json"
      ]
    });
  }

  if (stateSummary.companies.count === 0) {
    steps.push({
      title: "Expect the company registry to be thin or empty",
      reason:
        "Exo does not populate companies automatically from motion retrieval yet. An empty company registry is normal at this stage.",
      commands: [
        "exo companies list --json",
        "exo companies add --name ExampleCo --domain example.com --motion <motion-id> --json"
      ]
    });
  } else {
    steps.push({
      title: "Inspect the canonical companies already in state",
      reason:
        "Companies are first-class canonical identity. Check what is already tracked before adding duplicates.",
      commands: [
        "exo companies list --json",
        `exo companies show ${stateSummary.companies.preview[0].id} --json`,
        `exo companies research-brief ${stateSummary.companies.preview[0].id} --json`,
        `exo companies profile ${stateSummary.companies.preview[0].id} --json`
      ]
    });
  }

  steps.push({
    title: "Use config export for handoff, not raw SQLite copying",
    reason:
      "If you need to move state into another chat or machine, export the supported Exo objects instead of improvising around the database file.",
    commands: [
      "exo config export --json",
      "exo config export --out ./exo-config.json"
    ]
  });

  return steps;
}

/**
 * @param {{
 *   motions: { count: number, focusMotionId: string | null, focusMotionName: string | null, activeCount: number, preview: Array<{ id: string, name: string, status: string, premiseStatus: string, sourceUrl: string, audienceCount: number, signalCount: number, nextStepCount: number }> },
 *   companies: { count: number, preview: Array<{ id: string, name: string, domain: string | null }> },
 *   browserProfiles: { count: number, readyCount: number, preview: Array<{ id: string, label: string, status: string, capabilities: string[] }> }
 * }} stateSummary
 */
function buildRecommendedPath(stateSummary) {
  /** @type {string[]} */
  const blockers = [];
  const focusMotion = stateSummary.motions.preview[0] ?? null;

  if (!focusMotion) {
    return {
      mode: "create-motion",
      reason: "No motions exist in the current Exo state store yet.",
      focusMotionId: null,
      focusMotionName: null,
      blockers: [],
      commands: [
        "exo motion start --url https://example.com/product --premise \"This offer matters when ...\" --audience \"Primary ICP\" --signal \"company::Is there recent evidence that ...?\" --json"
      ]
    };
  }

  if (stateSummary.motions.activeCount === 0) {
    return {
      mode: "activate-motion",
      reason: "Motions exist in state, but none of them are active. Cross-motion execution should only move active motions forward.",
      focusMotionId: focusMotion.id,
      focusMotionName: focusMotion.name,
      blockers: ["No active motion exists yet."],
      commands: [
        "exo motion list --json",
        `exo motion show ${focusMotion.id} --json`,
        `exo motion restart ${focusMotion.id} --json`,
        `exo motion clone ${focusMotion.id} --audience "Secondary ICP" --segment alt-segment --json`
      ]
    };
  }

  if (focusMotion.premiseStatus !== "defined") {
    blockers.push("The focus motion does not yet have a defined premise.");
  }

  if (focusMotion.audienceCount === 0) {
    blockers.push("The focus motion does not yet have any audience hypotheses.");
  }

  if (focusMotion.signalCount === 0) {
    blockers.push("The focus motion does not yet have any motion-specific signals.");
  }

  if (stateSummary.browserProfiles.readyCount === 0) {
    blockers.push("No ready browser profile exists yet for browser-backed work.");
  }

  if (stateSummary.companies.count === 0) {
    blockers.push("No canonical companies are registered yet.");
  }

  return {
    mode: "continue-motion",
    reason:
      "A motion already exists in state. The governed next path is to continue the strongest existing motion instead of creating a new one.",
    focusMotionId: focusMotion.id,
    focusMotionName: focusMotion.name,
    blockers,
    commands: [
      "exo motion list --json",
      `exo motion show ${focusMotion.id} --json`,
      `exo motion target ${focusMotion.id} --json`,
      `exo motion update ${focusMotion.id} --audience "Primary ICP" --title "Chief Risk Officer" --json`,
      `exo motion clone ${focusMotion.id} --audience "Secondary ICP" --segment alt-segment --json`
    ]
  };
}

/**
 * @param {{
 *   mode: string,
 *   reason: string,
 *   focusMotionId: string | null,
 *   focusMotionName: string | null,
 *   blockers: string[],
 *   commands: string[]
 * }} recommendedPath
 */
function buildOperatorInterface(recommendedPath) {
  return {
    principle:
      "Exo is the GTM operator interface and system of record for agents. The agent should translate Exo state into a normal operating conversation, persist durable findings back into Exo, and not expose Exo primitives unless they are necessary.",
    conversationRules: [
      "Lead with the decision or judgment.",
      "Keep the operator-facing reply tight and skip runtime narration unless asked.",
      "State the next move in plain English.",
      "If the next move is a simple operator decision, ask it directly as a question.",
      "Use Exo ids or commands only when the operator needs to act on them.",
      "Do not narrate JSON field names or internal property paths in normal conversation."
    ],
    currentCall: {
      headline:
        recommendedPath.mode === "continue-motion"
          ? `Keep working ${recommendedPath.focusMotionName ?? "the current motion"} instead of creating a new one.`
          : recommendedPath.mode === "activate-motion"
            ? `Activate ${recommendedPath.focusMotionName ?? "a motion"} before trying to use cross-motion execution.`
          : recommendedPath.mode === "create-motion"
            ? "Create the first motion before trying to do anything downstream."
            : "Follow the current governed path before expanding scope.",
      nextMove:
        recommendedPath.mode === "continue-motion"
          ? `Continue ${recommendedPath.focusMotionName ?? "the focus motion"}, clear its blockers, and only then move into browser or company work.`
          : recommendedPath.mode === "activate-motion"
            ? `Restart or resume ${recommendedPath.focusMotionName ?? "a motion"} first. Draft, paused, and archived motions should not enter the shared execution agenda.`
          : recommendedPath.mode === "create-motion"
            ? "Define a new motion with premise, audience hypothesis, and first signal."
            : "Use the recommended path as the next governed move.",
      operatorPrompt:
        recommendedPath.mode === "continue-motion"
          ? `Keep working ${recommendedPath.focusMotionName ?? "the current motion"}. What do you want to do next?`
          : recommendedPath.mode === "activate-motion"
            ? `Restart or resume ${recommendedPath.focusMotionName ?? "the motion"} first.`
          : recommendedPath.mode === "create-motion"
            ? "No motion exists yet. Do you want to create one now?"
            : "What do you want to do next?",
      blockers: recommendedPath.blockers
    }
  };
}

/**
 * @param {{ premiseStatus: string, signalCount: number, audienceCount: number, nextStepCount: number, id: string }} left
 * @param {{ premiseStatus: string, signalCount: number, audienceCount: number, nextStepCount: number, id: string }} right
 */
function compareMotionPreview(left, right) {
  return (
    scoreMotionPreview(right) - scoreMotionPreview(left)
      || right.id.localeCompare(left.id)
  );
}

/**
 * @param {{ premiseStatus: string, signalCount: number, audienceCount: number, nextStepCount: number }} motion
 */
function scoreMotionPreview(motion) {
  let score = 0;
  if (motion.premiseStatus === "defined") {
    score += 100;
  }

  score += motion.signalCount * 10;
  score += motion.audienceCount * 5;
  score += Math.min(motion.nextStepCount, 9);
  return score;
}
