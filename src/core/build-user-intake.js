// @ts-check

import { browserProfileSchema } from "../schema/browser-profile.js";
import { userSchema } from "../schema/user.js";
import { probeRuntimeConnectorAvailability } from "./probe-user-harness-connections.js";

const RUNTIME_CONNECTOR_CANDIDATES = {
  codex: ["chrome", "gmail", "hubspot", "unipile"],
};

/**
 * @param {{
 *   label?: string | null,
 * }} input
 * @param {{
 *   rawUsers: unknown[],
 *   rawProfiles: unknown[],
 * }} state
 */
export function buildUserIntake(input, state) {
  const users = state.rawUsers.map((item) => userSchema.parse(item));
  const profiles = state.rawProfiles.map((item) => browserProfileSchema.parse(item));
  const executionCapableUsers = users.filter((user) => user.accounts.length > 0);
  const label = normalizeNullableString(input.label);
  const discoveredSources = discoverExecutionSources(profiles);

  if (!users.length) {
    return {
      status: label ? "ready-to-create" : "needs-question",
      nextQuestion: label
        ? null
        : {
            key: "first-user",
            prompt: buildFirstUserPrompt(discoveredSources),
            required: true,
          },
      existingUsers: [],
      discoveredSources,
      knownSpecifics: {
        labelDefined: Boolean(label),
        userCount: 0,
        executionCapableUserCount: 0,
      },
      launchCommandHint: label
        ? `exo users add --label ${shellQuote(label)} --json`
        : null,
      nextCommands: [
        "exo users intake --json",
        "exo users add --label operator-main --json",
        "exo users harness probe <user-id> --runtime codex --json",
        "exo users accounts map-runtime <user-id> --runtime codex --apply --json",
      ],
    };
  }

  if (!executionCapableUsers.length) {
    return {
      status: "needs-account-mapping",
      nextQuestion: {
        key: "first-account",
        prompt: buildFirstAccountPrompt(users[0], discoveredSources),
        required: true,
      },
      existingUsers: users.map((user) => ({
        id: user.id,
        label: user.label,
        accountCount: user.accounts.length,
      })),
      discoveredSources,
      knownSpecifics: {
        labelDefined: false,
        userCount: users.length,
        executionCapableUserCount: 0,
      },
      launchCommandHint: null,
      nextCommands: [
        "exo users intake --json",
        "exo users harness probe <user-id> --runtime codex --json",
        "exo users accounts map-runtime <user-id> --runtime codex --apply --json",
        "exo users accounts add <user-id> --capability linkedin --handle operator-linkedin --runtime codex --connector chrome --provider-account-id <provider-account-id> --preferred --json",
      ],
    };
  }

  return {
    status: "configured",
    nextQuestion: null,
    existingUsers: users.map((user) => ({
      id: user.id,
      label: user.label,
      accountCount: user.accounts.length,
    })),
    discoveredSources,
    knownSpecifics: {
      labelDefined: false,
      userCount: users.length,
      executionCapableUserCount: executionCapableUsers.length,
    },
    launchCommandHint: null,
    nextCommands: [
      "exo users list --json",
      "exo users resolve <user-id> --capability linkedin --json",
      "exo users resolve <user-id> --capability gmail --json",
    ],
  };
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type[]} profiles
 */
function discoverExecutionSources(profiles) {
  const runtimeConnectors = [];

  // Intake discovery should stay cheap and non-interactive.
  // Claude runtime inspection is still an explicit operator step through
  // `exo users harness probe --runtime claude ...`, not an implicit bootstrap side effect.
  for (const [runtime, connectors] of Object.entries(RUNTIME_CONNECTOR_CANDIDATES)) {
    for (const connector of connectors) {
      const probe = probeRuntimeConnectorAvailability(runtime, connector, {
        codexHome: process.env.CODEX_HOME ?? null,
        claudeCli: process.env.EXO_CLAUDE_CLI ?? null,
      });
      if (probe.detectedStatus !== "available") {
        continue;
      }
      runtimeConnectors.push({
        runtime,
        connector,
        reason: probe.reason,
      });
    }
  }

  const profileAccounts = profiles.flatMap((profile) =>
    profile.identity.accounts.map((account) => ({
      profileId: profile.id,
      profileLabel: profile.label,
      profileStatus: profile.status,
      capability: account.capability,
      handle: account.handle,
    })),
  );

  return {
    runtimeConnectors,
    profileAccounts,
  };
}

/**
 * @param {{ runtimeConnectors: Array<{ runtime: string, connector: string }>, profileAccounts: Array<{ capability: string, handle: string, profileLabel: string }> }} discoveredSources
 */
function buildFirstUserPrompt(discoveredSources) {
  if (discoveredSources.profileAccounts.length) {
    const examples = discoveredSources.profileAccounts
      .slice(0, 3)
      .map((account) => `${account.capability}:${account.handle} on ${account.profileLabel}`)
      .join(", ");
    return `I found stored account identities (${examples}). Who is the first user we're managing in Exo?`;
  }

  if (discoveredSources.runtimeConnectors.length) {
    const connectors = discoveredSources.runtimeConnectors
      .slice(0, 4)
      .map((entry) => `${entry.runtime}:${entry.connector}`)
      .join(", ");
    return `I found callable runtime connectors (${connectors}). Who is the first user we're managing in Exo?`;
  }

  return "Who is the first user we're managing in Exo?";
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {{ runtimeConnectors: Array<{ runtime: string, connector: string }>, profileAccounts: Array<{ capability: string, handle: string, profileLabel: string }> }} discoveredSources
 */
function buildFirstAccountPrompt(user, discoveredSources) {
  if (discoveredSources.profileAccounts.length) {
    const examples = discoveredSources.profileAccounts
      .slice(0, 3)
      .map((account) => `${account.capability}:${account.handle}`)
      .join(", ");
    return `I found stored account identities (${examples}), but stored profile clues do not clear onboarding by themselves. Which managed account belongs to ${user.label} first?`;
  }

  if (discoveredSources.runtimeConnectors.length) {
    const connectors = discoveredSources.runtimeConnectors
      .slice(0, 4)
      .map((entry) => `${entry.runtime}:${entry.connector}`)
      .join(", ");
    return `I found callable runtime connectors (${connectors}), but ${user.label} still has no governed account mapped in Exo. Chrome or stored profiles do not count by themselves. Which managed account should we attach first?`;
  }

  return `${user.label} exists in Exo, but no governed account is mapped yet. Which managed account should we attach first?`;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeNullableString(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {string} value
 */
function shellQuote(value) {
  return JSON.stringify(value);
}
