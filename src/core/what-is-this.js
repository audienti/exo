// @ts-check

import { listBrowserProfiles, listCompanies, listMotions } from "../db/database.js";
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
  const stateSummary = buildStateSummary(motions, companies, browserProfiles);
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
        command: "exo config export/import",
        purpose: "Export and import motions, companies, and browser profiles as portable Exo configuration."
      },
      {
        command: "exo companies add/list/find/show/update/motions/research-brief/signal-matches show/add/prospects show/add/through-line show/set/opening-plan show/set/cadence show/set/profile show/assign",
        purpose: "Manage canonical companies, persist website and company-page identity, generate governed company research briefs, store synthesized concise writer-ready motion-specific signal matches, persist chosen prospects, their through-lines, their opening plans, their cadence state, and pin a sticky engagement profile when outreach starts."
      },
      {
        command: "exo motion start/add/target/clone/update/refresh/list/show/remove",
        purpose: "Start a motion from an offer URL, force reuse-or-branch decisions when that URL already exists, evaluate targeting readiness, and then create, branch, refine, refresh, enumerate, inspect, and remove offer-driven motion state built around premise, audience hypotheses, and motion-specific signals."
      },
      {
        command: "exo profiles discover/add/claim/list/show/capabilities/resolve/test/remove",
        purpose: "Discover local browser profiles, claim them as business identities, store account-level weekly outreach quotas, verify claimed capabilities, resolve the right browser identity, and query capability coverage for browser-backed Exo work."
      }
    ],
    browserProfileRules: [
      "Browser-backed work should fail closed if no profile is attached or trusted.",
      "A ready profile means the local browser context looks structurally usable.",
      "Profile checks do not yet prove live LinkedIn, Sales Navigator, Gmail, or HubSpot auth.",
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
          "State the governed next move in plain English.",
          "Mention ids or commands only when they are operationally necessary.",
          "Do not narrate JSON field names unless the operator explicitly asks for raw structure."
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
              "exo motion show <motion-id> --json",
              "exo motion target <motion-id> --json",
              "exo motion update <motion-id> --audience \"Primary ICP\" --title \"Chief Risk Officer\" --json",
              "exo motion clone <motion-id> --audience \"Secondary ICP\" --segment alt-segment --json"
            ]
          },
          {
            name: "create-motion",
            when: "Use this when the operator has an offer URL and wants Exo to check for existing motions before creating anything new.",
            commands: [
              "exo motion start --url https://example.com/product --premise \"This offer matters when ...\" --audience \"Primary ICP\" --signal \"company::Is there recent evidence that ...?\" --json"
            ]
          },
          {
            name: "prepare-browser-work",
            when: "Use this before any LinkedIn, Sales Navigator, Gmail, or HubSpot work that depends on a real browser identity.",
            commands: [
              "exo profiles discover --json",
              "exo profiles claim <profile-id> --label audienti-main --workspace audienti --account linkedin:wflanagan@audienti.com --max-connection-requests 40 --max-inmail-messages 20 --json",
              "exo profiles list --json",
              "exo profiles capabilities --json",
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
              "exo companies through-line set <company-id> --prospect <prospect-id> --signal-match <signal-match-id> --specific-to-them \"Specific to them\" --shared-problem \"Shared problem\" --why-now \"Why now\" --legitimate-wedge \"Why they would reply\" --compression-line \"One sentence\" --json",
              "exo companies opening-plan set <company-id> --prospect <prospect-id> --signal-match <signal-match-id> --why-now \"Reason to talk now\" --angle \"Opening angle\" --reply-path \"Why this person would legitimately reply now\" --primary-channel connection-request --fallback-channel email --fallback-trigger \"Use email if LinkedIn is blocked or there is no reply.\" --preflight-action \"View the prospect profile\" --first-move \"First move\" --first-message-goal \"Desired response\" --json",
              "exo companies cadence set <company-id> --prospect <prospect-id> --current-step connection-request --next-action \"Send the first touch\" --json",
              "exo companies profile assign <company-id> --profile <profile-id> --reason \"Use one identity consistently\" --json"
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
      "No live browser auth probes yet.",
      "No profile-to-motion assignment yet.",
      "No automatic company population from motion retrieval yet.",
      "No real Sales Navigator retrieval yet.",
      "No automatic target-map or stakeholder-map generation yet, even though Exo can now persist manual target-account signal matches, prospects, through-lines, opening plans, and cadence state.",
      "No automatic prospect selection, through-line synthesis, or opening-plan generation yet. Agents still need to choose and write back the people, the reply-path hypothesis, and the first move explicitly.",
      "No execution-harness registry yet. Exo governs browser identity, but does not yet model Chrome-vs-Playwriter-vs-other harness preference as a first-class object.",
      "No public bug-reporting or feature-request intake yet. That is a future alpha feature, not current scope."
    ],
    docs: [
      { label: "Installation", path: "docs/installation.md" },
      { label: "CLI Guide", path: "docs/cli-guide.md" },
      { label: "Agent Usage", path: "docs/agent-usage.md" },
      { label: "Companies", path: "docs/companies.md" },
      { label: "Browser Profiles", path: "docs/browser-profiles.md" },
      { label: "Config Portability", path: "docs/config-portability.md" },
      { label: "CLI and MCP Contract", path: "docs/cli-mcp-contract.md" }
    ]
  };
}

/**
 * @param {unknown[]} motions
 * @param {unknown[]} companies
 * @param {unknown[]} browserProfiles
 */
function buildStateSummary(motions, companies, browserProfiles) {
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

  return {
    motions: {
      count: motions.length,
      focusMotionId: rankedMotions[0]?.id ?? null,
      focusMotionName: rankedMotions[0]?.name ?? null,
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
    }
  };
}

/**
 * @param {{
 *   motions: { count: number, focusMotionId: string | null, focusMotionName: string | null, preview: Array<{ id: string, name: string, status: string, premiseStatus: string, sourceUrl: string, audienceCount: number, signalCount: number, nextStepCount: number }> },
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
        "exo profiles claim <profile-id> --label audienti-main --workspace audienti --account linkedin:wflanagan@audienti.com --json",
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
 *   motions: { count: number, focusMotionId: string | null, focusMotionName: string | null, preview: Array<{ id: string, name: string, status: string, premiseStatus: string, sourceUrl: string, audienceCount: number, signalCount: number, nextStepCount: number }> },
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
      "State the next move in plain English.",
      "Use Exo ids or commands only when the operator needs to act on them.",
      "Do not narrate JSON field names or internal property paths in normal conversation."
    ],
    currentCall: {
      headline:
        recommendedPath.mode === "continue-motion"
          ? `Keep working ${recommendedPath.focusMotionName ?? "the current motion"} instead of creating a new one.`
          : recommendedPath.mode === "create-motion"
            ? "Create the first motion before trying to do anything downstream."
            : "Follow the current governed path before expanding scope.",
      nextMove:
        recommendedPath.mode === "continue-motion"
          ? `Continue ${recommendedPath.focusMotionName ?? "the focus motion"}, clear its blockers, and only then move into browser or company work.`
          : recommendedPath.mode === "create-motion"
            ? "Define a new motion with premise, audience hypothesis, and first signal."
            : "Use the recommended path as the next governed move.",
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
