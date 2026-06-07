// @ts-check

import { listBrowserProfiles, listCompanies, listMotions, listUsers } from "../db/database.js";
import { describeStatePathRule } from "../db/paths.js";
import { buildOnboardingState } from "./onboarding.js";

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
 *     },
 *     users: {
 *       count: number,
 *       executionCapableCount: number,
 *       preview: Array<{ id: string, label: string, accountCount: number }>
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
 *   onboarding: ReturnType<typeof buildOnboardingState>,
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
  const onboarding = buildOnboardingState({
    rawUsers: users,
    rawProfiles: browserProfiles,
    rawMotions: motions,
    rawCompanies: companies,
  });
  const recommendedPath = buildRecommendedPath(stateSummary, onboarding);
  const operatorInterface = buildOperatorInterface(recommendedPath);

  return {
    name: "Exo",
    version: "0.1.0",
    identity: {
      oneLiner: "Exo is an agentic CRM and GTM motion system of record exposed through a local CLI and later through MCP.",
      purpose:
        "Exo turns an offer plus a premise, audience hypotheses, signals, targeting, and suppression inputs into durable GTM state, then uses that state to govern agent behavior, connector-managed execution, and GTM action.",
      interactionModel: [
        "Claude or Codex uses the CLI with --json or the future MCP layer.",
        "The agent guides the operator; Exo is not primarily a human-first shell product.",
        "Exo is queryable, but its main purpose is to drive behavior, act as the GTM system of record, and enforce governance.",
        "Connectors and external tools do the interfacing. Exo owns state, policy, and governed writeback."
      ]
    },
    notThis: [
      "a generic browser automation framework",
      "the transport layer itself",
      "an AI SDR",
      "a sequence builder",
      "a proprietary prospect database"
    ],
    operatingRules: [
      "Run from the same repo root when shared Exo state matters.",
      "Prefer --json when another agent needs structured output.",
      "Treat Exo as the GTM system of record. If you learn something durable, write it back.",
      "Opening the Exo state store may apply versioned local database migrations.",
      "Prefer connected-account and harness-connector paths over browser-profile paths.",
      "Browser profiles are legacy state only. They do not create a governed execution path.",
      "Exo should govern connector-managed work and landed outcomes, not become the interface layer."
    ],
    currentCapabilities: [
      {
        command: "exo what-is-this",
        purpose: "Return the product identity, operating rules, capabilities, and limitations."
      },
      {
        command: "exo onboarding",
        purpose: "Inspect or apply the first-run install-scope and execution-user onboarding flow."
      },
      {
        command: "exo actions list/show/result",
        purpose: "Inspect the canonical Audienti-style GTM action catalog and write back governed action outcomes so cadence, drafts, touch history, and inbound reconciliation stay in one contract."
      },
      {
        command: "exo inbound surfaces/surface/cues add/list/resolve/sync show/plan/live/linkedin/linkedin-live/gmail/gmail-live/run/set/record/observations list/show/add",
        purpose: "Inspect the canonical inbound truth surfaces, record ambient inbound cues, manage per-account sync policy, emit governed connector-capture contracts, and read or write normalized inbound observations."
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
        command: "exo transition start/promote/promote-all/rehome",
        purpose: "Absorb in-flight legacy relationships into one transition motion, carry their current invite or reply state forward, and then re-home triaged prospects into real motions without losing cadence, touches, or linked observations."
      },
      {
        command: "exo ui-status/ui",
        purpose: "Report or serve the interactive operator workspace wired to live Exo state and real writeback actions."
      },
      {
        command: "exo config export/import",
        purpose: "Export and import motions, companies, browser profiles, and execution users as portable Exo configuration."
      },
      {
        command: "exo companies add/list/find/show/update/motions/research-brief/signal-matches show/add/prospects show/add/update/claim/complete/cadence show/set/touches show/add/profile show/assign/user show/assign/execution show",
        purpose: "Manage canonical companies, persist website and company-page identity, generate governed company research briefs, store synthesized concise writer-ready motion-specific signal matches, persist chosen prospects, their cadence state, their touch history, inspect one cross-motion company rollup, pin the acting execution user when outreach starts, and inspect the resolved execution plan."
      },
      {
        command: "exo motion intake/start/add/seed/discover/target/packets/packet-brief/prospects/actions/action-brief/drafts/draft-brief/clone/update/pause/resume/archive/restart/refresh/list/show/profile show/assign/user show/assign/remove",
        purpose: "Ask one intake question at a time before launch, start a motion from an offer URL, force reuse-or-branch decisions when that URL already exists, evaluate targeting readiness, inspect targeted prospects and writing inputs, inspect prospect-scoped action readiness and execution briefs, inspect Audienti-style draft cases, inspect one compact single-surface draft brief for chat writing, assign one sticky execution identity at motion scope, and then create, branch, refine, pause, resume, archive, restart, refresh, enumerate, inspect, and remove offer-driven motion state built around premise, audience hypotheses, and motion-specific signals."
      },
      {
        command: "exo profiles discover/add/claim/list/show/capabilities/resolve/test/auth/remove",
        purpose: "Inspect legacy browser-profile records that may still exist in local state during migration."
      },
      {
        command: "exo users add/list/show/working-hours show/set/harness add/probe/accounts add/map-runtime/resolve",
        purpose: "Manage human execution identities that own connected accounts across harness connectors, define the user's working-hours window for planner pressure, probe the current runtime for callable harness paths, map discovered LinkedIn, email, and related managed accounts onto the user, and then resolve the right account for each capability."
      }
    ],
    browserProfileRules: [
      "Browser-profile execution fallback has been removed. Governed work must resolve through managed connector accounts.",
      "Legacy browser-profile records may still exist in local state during migration, but they do not authorize execution.",
      "Profile checks do not prove live LinkedIn, Sales Navigator, Gmail, or HubSpot auth.",
      "Inbound sync policy and normalized inbound observations are governed per connected account.",
      "Configured weekly quotas on the governed connected account should govern outreach pacing. InMail credits are still a separate live observation, not a static config knob.",
      "Exo resolves the governed account path. The agent runtime should choose the actual connector, MCP server, or CLI surface.",
      "In Codex, prefer the named connector path first. Do not fall back to browser-profile state."
    ],
    agentUsage: {
      preferJson: true,
      bootstrapSequence: [
        "exo what-is-this --json",
        "exo onboarding --json",
        "exo companies list --json",
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
      writingVoice: {
        principle:
          "Any user-facing copy you produce (outreach drafts, email replies, motion briefs, packet summaries, prospect notes, status lines, planner narration, docs prose) follows docs/writing-voice.md. Sound like a person with a point of view, not an LLM completing a task.",
        sourceOfTruth: "docs/writing-voice.md",
        rules: [
          "Lead with the point. No throat-clearing openers like \"just wanted to\", \"quick note\", \"hope you're well\", \"I wanted to reach out\".",
          "No em dashes. Use periods or commas.",
          "State the claim directly. No binary contrast formulas like \"not X, but Y\" or \"it's not just X\".",
          "Use active voice and name the actor. No passive voice or false agency like \"the data tells us\".",
          "Cut AI-jargon and hype. Avoid \"delve\", \"landscape\", \"pivotal\", \"showcase\", \"underscores\", \"unlock\", \"game-changer\", \"seamless\", \"robust\", \"leverage\", \"tapestry\", \"testament\".",
          "No three-item slogan lists, dramatic fragments, or adverb-heavy emphasis (\"really\", \"very\", \"actually\", \"genuinely\").",
          "Prefer one concrete fact over broad claims. If the context gives a detail, use it. If not, stay plain.",
          "No chatbot collaboration artifacts (\"I hope this helps\", \"Of course!\", \"Certainly!\", \"Let me know if…\").",
          "No knowledge-cutoff disclaimers, no sycophancy, no decorative emojis, no curly quotes, no title-case headings."
        ]
      },
      operatorGuidance: {
        principle:
          "Do not just enumerate Exo commands. First identify what the operator is trying to do, then guide them through the relevant Exo path and persist durable findings back into Exo.",
        firstQuestion:
          "Are we choosing install scope for a fresh workspace, continuing an existing motion, creating a new motion, configuring connector-backed execution, absorbing transition backlog, or managing canonical company state?",
        modes: [
          {
            name: "choose-install-scope",
            when: "Use this on a true empty workspace before the first execution user exists, so Exo does not silently guess between local-folder and global-install storage.",
            commands: [
              "exo onboarding --json",
              "exo onboarding --scope local-folder --apply --json",
              "exo onboarding --scope global-install --apply --json"
            ]
          },
          {
            name: "configure-execution-user",
            when: "Use this on a fresh state store or any half-bootstrapped store where Exo still does not know who the first managed execution user is.",
            commands: [
              "exo onboarding --label operator-main --apply --json",
              "exo users intake --json",
              "exo users add --label operator-main --json",
              "exo users harness probe <user-id> --runtime codex --json",
              "exo users accounts map-runtime <user-id> --runtime codex --apply --json",
            ]
          },
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
            name: "configure-execution-connectors",
            when: "Use this before any LinkedIn, Gmail, or other live work that depends on a real managed connector path.",
            commands: [
              "exo users intake --json",
              "exo users add --label operator-main --owner operator --json",
              "exo users harness probe <user-id> --runtime codex --json",
              "exo users harness probe <user-id> --runtime claude --json",
              "exo users accounts map-runtime <user-id> --runtime codex --apply --json",
              "exo users harness probe <user-id> --runtime codex --connector <connector-from-probe> --writeback --json",
              "exo users accounts add <user-id> --capability linkedin --handle operator-linkedin --runtime codex --connector <connector-from-probe> --provider-account-id <provider-account-id> --preferred --json",
              "exo users accounts add <user-id> --capability gmail --handle operator@example.com --runtime codex --connector gmail --provider-account-id <provider-account-id> --preferred --json",
              "exo users accounts add <user-id> --capability gmail --handle operator@example.com --runtime claude --connector gmail --provider-account-id <provider-account-id> --preferred --json",
              "exo inbound sync linkedin-live <user-id> --account <account-id> --runtime codex --json",
              "exo inbound sync gmail-live <user-id> --account <account-id> --json",
              "exo users list --json",
              "exo users resolve <user-id> --capability linkedin --json",
              "exo users resolve <user-id> --capability gmail --json"
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
              "exo companies cadence set <company-id> --prospect <prospect-id> --current-step connection-request --next-action \"Send the first touch\" --json",
              "exo companies profile assign <company-id> --profile <profile-id> --reason \"Use one identity consistently\" --json",
              "exo companies user assign <company-id> --user <user-id> --reason \"Use one human identity across LinkedIn and email\" --json"
            ]
          },
          {
            name: "transition-backlog",
            when: "Use this when real invites, replies, or warm relationships already exist outside Exo and need to be absorbed without starting cold.",
            commands: [
              "exo transition start --json",
              "exo inbound review <user-id> --json",
              "exo inbox --user <user-id> --json",
              "exo transition promote <observation-id> --user <user-id> --json",
              "exo transition promote-all --user <user-id> --surface linkedin-sent-invitations --json",
              "exo transition rehome <prospect-id> --to-motion <motion-id> --json"
            ]
          },
          {
            name: "serve-operator-ui",
            when: "Use this when the operator wants the live interactive Exo workspace rather than only JSON/terminal surfaces.",
            commands: [
              "exo ui-status --json",
              "exo ui --user <user-id>",
              "exo report workspace --user <user-id> --json"
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
        "Treat managed connector accounts as the execution identity and re-check runtime availability before unattended work."
      ]
    },
    stateSummary,
    onboarding,
    operatorInterface,
    gettingStarted: buildGettingStarted(stateSummary, onboarding),
    currentLimitations: [
      "No MCP wrapper yet.",
      "Limited live connector auth proof now exists through supported runtime adapters, but Exo still does not do full cross-runtime auth proof by itself.",
      "Limited live inbound retrieval now exists for Gmail and for LinkedIn's authoritative quick surfaces through supported runtime adapters, including full reconciliation mode for those LinkedIn quick surfaces, but Exo still does not do broader LinkedIn or other inbound retrieval by itself. In Codex desktop shell mode, native live capture still has to be performed by the outer agent and then landed through Exo's governed writeback path.",
      "Ambient inbound cues and working-hours-aware sync pressure now exist, but cues are still suspicion rather than truth and the planner still depends on governed sync runs to confirm what actually changed.",
      "Motion-level sticky execution defaults now exist, but canonical company execution still needs explicit motion context when the same company belongs to more than one motion.",
      "Automatic public-web company discovery can now replenish thin motion backlog, but Exo still does not do live Sales Navigator retrieval or proprietary database sourcing by itself.",
      "Packet-driven prospect selection and prospect research now exist, but the autonomous pipeline still depends on governed public-web and live-enrichment writeback rather than a first-party prospect corpus.",
      "No real Sales Navigator retrieval yet.",
      "Limited runtime auto-discovery now exists for Codex harness connectors through local Codex config inspection and for Claude through CLI plugin and MCP inspection, but Exo still does not do full cross-runtime availability inspection or live connector auth probes by itself.",
      "No full multi-channel pacing model yet. Exo can now compute LinkedIn invitation deficit when the governed LinkedIn account has a stored quota, but broader channel saturation and capacity balancing are still future work.",
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
      executionCapableCount: users.filter((user) => Array.isArray(user.accounts) && user.accounts.length > 0).length,
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
 *   browserProfiles: { count: number, readyCount: number, preview: Array<{ id: string, label: string, status: string, capabilities: string[] }> },
 *   users: { count: number, executionCapableCount: number, preview: Array<{ id: string, label: string, accountCount: number }> }
 * }} stateSummary
 * @param {ReturnType<typeof buildOnboardingState>} onboarding
 */
function buildGettingStarted(stateSummary, onboarding) {
  /** @type {Array<{ title: string, reason: string, commands: string[] }>} */
  const steps = [];

  if (onboarding.status === "needs-scope") {
    steps.push({
      title: "Choose install scope before first-run setup",
      reason:
        "A truly empty folder should not silently fall into one storage mode. Decide whether this workspace keeps local Exo state or attaches to the global install before anything durable is created.",
      commands: [
        "exo onboarding --json",
        "exo onboarding --scope local-folder --apply --json",
        "exo onboarding --scope global-install --apply --json"
      ]
    });
  } else if (stateSummary.users.count === 0) {
    steps.push({
      title: "Register the first execution user",
      reason:
        "Before the live operator workspace, inbox, daily agenda, or managed-account execution can mean anything, Exo needs to know who the first governed user is and which runtime accounts may belong to them.",
      commands: [
        "exo onboarding --label operator-main --apply --json",
        "exo users intake --json",
        "exo users add --label operator-main --json",
        "exo users harness probe <user-id> --runtime codex --json",
        "exo users accounts map-runtime <user-id> --runtime codex --apply --json",
      ]
    });
  } else if (stateSummary.users.executionCapableCount === 0) {
    steps.push({
      title: "Map the first governed account",
      reason:
        "Execution users already exist, but none of them owns a governed account path yet. Exo should inspect runtime coverage and ask who the discovered accounts belong to before pretending the workspace is ready.",
      commands: [
        "exo users intake --json",
        "exo users list --json",
        "exo users harness probe <user-id> --runtime codex --json",
        "exo users accounts map-runtime <user-id> --runtime codex --apply --json",
      ]
    });
  }

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
        "Once the execution identity is named, start from the offer URL so Exo can confirm what is being promoted and check for reuse before creating motion state.",
      commands: [
        "exo motion intake --json",
        "exo motion start --url https://example.com/product --premise \"This offer matters when ...\" --audience \"Primary ICP\" --signal \"company::Is there recent evidence that ...?\" --json"
      ]
    });
  }

  if (stateSummary.users.count > 0 && stateSummary.users.executionCapableCount > 0) {
    steps.push({
      title: "Check execution-path coverage before live work",
      reason:
        "Governed live work should resolve through managed connector accounts. Check runtime coverage and exact account resolution before launch.",
      commands: [
        "exo users add --label operator-main --owner operator --json",
        "exo users harness probe <user-id> --runtime codex --json",
        "exo users harness probe <user-id> --runtime claude --json",
        "exo users accounts map-runtime <user-id> --runtime codex --apply --json",
        "exo users accounts add <user-id> --capability linkedin --handle operator-linkedin --runtime codex --connector <connector-from-probe> --provider-account-id <provider-account-id> --preferred --json",
        "exo users resolve <user-id> --capability linkedin --json",
        "exo users resolve <user-id> --capability gmail --json"
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
 *   browserProfiles: { count: number, readyCount: number, preview: Array<{ id: string, label: string, status: string, capabilities: string[] }> },
 *   users: { count: number, executionCapableCount: number, preview: Array<{ id: string, label: string, accountCount: number }> }
 * }} stateSummary
 * @param {ReturnType<typeof buildOnboardingState>} onboarding
 */
function buildRecommendedPath(stateSummary, onboarding) {
  /** @type {string[]} */
  const blockers = [];
  const focusMotion = stateSummary.motions.preview[0] ?? null;

  if (onboarding.status === "needs-scope") {
    return {
      mode: "choose-install-scope",
      reason: onboarding.next.reason,
      focusMotionId: null,
      focusMotionName: null,
      blockers: ["Install scope has not been chosen yet."],
      commands: onboarding.next.commands,
    };
  }

  if (stateSummary.users.count === 0) {
    return {
      mode: "configure-execution-user",
      reason: "No execution users exist in the current Exo state store yet, so Exo still does not know who the first managed operator identity is.",
      focusMotionId: focusMotion?.id ?? null,
      focusMotionName: focusMotion?.name ?? null,
      blockers: ["No execution user exists yet."],
      commands: [
        "exo users intake --json",
        "exo users add --label operator-main --json",
        "exo users harness probe <user-id> --runtime codex --json",
        "exo users accounts map-runtime <user-id> --runtime codex --apply --json",
      ]
    };
  }

  if (stateSummary.users.executionCapableCount === 0) {
    return {
      mode: "configure-execution-connectors",
      reason: "Execution users exist, but none of them owns a governed connected account path yet.",
      focusMotionId: focusMotion?.id ?? null,
      focusMotionName: focusMotion?.name ?? null,
      blockers: ["No execution-capable user exists yet."],
      commands: [
        "exo users intake --json",
        "exo users list --json",
        "exo users harness probe <user-id> --runtime codex --json",
        "exo users accounts map-runtime <user-id> --runtime codex --apply --json",
      ]
    };
  }

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
        recommendedPath.mode === "choose-install-scope"
          ? "Choose whether this folder is local-only or attached to the global Exo install before first-run setup."
          : recommendedPath.mode === "configure-execution-user"
          ? "Register the first execution user before trying to use the live operator workspace."
          : recommendedPath.mode === "configure-execution-connectors"
            ? "Map the first governed account before trying to use the live operator workspace."
            : recommendedPath.mode === "continue-motion"
              ? `Keep working ${recommendedPath.focusMotionName ?? "the current motion"} instead of creating a new one.`
              : recommendedPath.mode === "activate-motion"
                ? `Activate ${recommendedPath.focusMotionName ?? "a motion"} before trying to use cross-motion execution.`
                : recommendedPath.mode === "create-motion"
                  ? "Create the first motion before trying to do anything downstream."
                  : "Follow the current governed path before expanding scope.",
      nextMove:
        recommendedPath.mode === "choose-install-scope"
          ? "Decide whether this folder keeps its own Exo state or attaches to the shared global install, then continue onboarding."
          : recommendedPath.mode === "configure-execution-user"
          ? "Inspect discovered accounts and runtime coverage, then decide who the first managed user is."
          : recommendedPath.mode === "configure-execution-connectors"
            ? "Inspect discovered accounts and map the first governed account onto the existing execution user."
            : recommendedPath.mode === "continue-motion"
              ? `Continue ${recommendedPath.focusMotionName ?? "the focus motion"}, clear its blockers, and only then move into execution-path or company work.`
              : recommendedPath.mode === "activate-motion"
                ? `Restart or resume ${recommendedPath.focusMotionName ?? "a motion"} first. Draft, paused, and archived motions should not enter the shared execution agenda.`
                : recommendedPath.mode === "create-motion"
                  ? "Define a new motion with premise, audience hypothesis, and first signal."
                  : "Use the recommended path as the next governed move.",
      operatorPrompt:
        recommendedPath.mode === "choose-install-scope"
          ? "Is this a local folder workspace or a global install?"
          : recommendedPath.mode === "configure-execution-user"
          ? "Who is the first user we're managing in Exo?"
          : recommendedPath.mode === "configure-execution-connectors"
            ? "Which discovered account should we map first?"
            : recommendedPath.mode === "continue-motion"
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
