// @ts-check

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
 *     sharedStateRule: string
 *   },
 *   concurrency: {
 *     supported: boolean,
 *     model: string,
 *     requirements: string[]
 *   },
 *   currentLimitations: string[],
 *   docs: Array<{ label: string, path: string }>
 * }}
 */
export function describeExo() {
  return {
    name: "Exo",
    version: "0.1.0",
    identity: {
      oneLiner: "Exo is a GTM operating kernel exposed through a local CLI and later through MCP.",
      purpose:
        "Exo turns an offer plus targeting and suppression inputs into durable motion state, then makes browser-backed and agent-backed work safer to run.",
      interactionModel: [
        "Operator uses the CLI directly.",
        "Claude or Codex uses the CLI with --json or the future MCP layer.",
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
      "Do not guess browser identity. Register and test a browser profile first.",
      "Treat browser profile status as a gate for browser-backed work, not a hint."
    ],
    currentCapabilities: [
      {
        command: "exo what-is-this",
        purpose: "Return the product identity, operating rules, capabilities, and limitations."
      },
      {
        command: "exo motion add",
        purpose: "Create a new offer-driven motion seed from URL, targeting, and suppression inputs."
      },
      {
        command: "exo motion list",
        purpose: "List stored motion ids in the current workspace state store."
      },
      {
        command: "exo motion show",
        purpose: "Render or emit a stored motion object."
      },
      {
        command: "exo profiles add/list/show/test/remove",
        purpose: "Manage browser profiles used for browser-backed Exo work."
      }
    ],
    browserProfileRules: [
      "Browser-backed work should fail closed if no profile is attached or trusted.",
      "A ready profile means the local browser context looks structurally usable.",
      "Profile checks do not yet prove live LinkedIn, Sales Navigator, Gmail, or HubSpot auth."
    ],
    agentUsage: {
      preferJson: true,
      bootstrapSequence: [
        "exo what-is-this --json",
        "exo profiles list --json",
        "exo motion list --json"
      ],
      sharedStatePath: "EXO_STATE_DIR/exo.db or ./.exo/exo.db",
      sharedStateRule: describeStatePathRule()
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
    currentLimitations: [
      "No MCP wrapper yet.",
      "No live browser auth probes yet.",
      "No profile-to-motion assignment yet.",
      "No real Sales Navigator retrieval yet.",
      "No target-map or stakeholder-map generation yet beyond seeded motion placeholders.",
      "No public bug-reporting or feature-request intake yet. That is a future alpha feature, not current scope."
    ],
    docs: [
      { label: "Installation", path: "docs/installation.md" },
      { label: "CLI Guide", path: "docs/cli-guide.md" },
      { label: "Agent Usage", path: "docs/agent-usage.md" },
      { label: "Browser Profiles", path: "docs/browser-profiles.md" },
      { label: "CLI and MCP Contract", path: "docs/cli-mcp-contract.md" }
    ]
  };
}
