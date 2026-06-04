#!/usr/bin/env node
// @ts-check

import { addUser } from "../../core/add-user.js";
import { buildUserIntake } from "../../core/build-user-intake.js";
import { mapUserRuntimeAccounts } from "../../core/map-user-runtime-accounts.js";
import { buildUserWorkingHoursView, setUserWorkingHours } from "../../core/working-hours.js";
import { probeRuntimeConnectorAvailability, probeUserHarnessConnections } from "../../core/probe-user-harness-connections.js";
import { resolveUserConnection } from "../../core/resolve-user-connection.js";
import { upsertUserConnectedAccount, upsertUserHarnessConnection } from "../../core/upsert-user-harness-connection.js";
import {
  findBrowserProfileById,
  findCompanyById,
  findUserById,
  findUserByLabel,
  insertUser,
  listBrowserProfiles,
  listUsers,
  updateUser
} from "../../db/database.js";
import {
  renderUserHarnessProbe,
  renderUserList,
  renderUserRuntimeAccountMapping,
  renderUserSummary,
  renderUserWorkingHours
} from "../../artifacts/render-user.js";
import { browserProfileCapabilitySchema } from "../../schema/browser-profile.js";
import { userHarnessConnectionStatusSchema, userSchema } from "../../schema/user.js";

/**
 * @param {import("commander").Command} program
 */
export function registerUsers(program) {
  const users = program
    .command("users")
    .description("Manage execution users that own governed connected accounts across harness connectors.")
    .addHelpText(
      "after",
      `
Examples:
  exo users intake --json
  exo users add --label operator-main --owner operator
  exo users working-hours set <user-id> --timezone America/New_York --weekday mon --weekday tue --weekday wed --weekday thu --weekday fri --start 09:00 --end 17:00
  exo users harness add <user-id> --runtime codex --connector chrome --status available
  exo users harness probe <user-id> --runtime codex --json
  exo users harness probe <user-id> --runtime codex --connector gmail --writeback --json
  exo users accounts map-runtime <user-id> --runtime codex --apply --json
  exo users accounts add <user-id> --capability linkedin --handle operator-linkedin --runtime codex --connector <connector-from-probe> --provider-account-id <provider-account-id> --preferred
  exo users accounts add <user-id> --capability linkedin --handle operator-linkedin --runtime codex --connector <connector-from-probe> --provider-account-id acct-linkedin-1 --preferred --max-connection-requests 125
  exo users accounts add <user-id> --capability gmail --handle operator@example.com --runtime codex --connector gmail --provider-account-id <provider-account-id> --preferred
  exo users resolve <user-id> --capability gmail --json

Rules:
  - A user is the human or business identity.
  - Accounts are capability-specific connections owned by that user.
  - Accounts resolve through harness connections. Legacy browser-profile mappings do not create a governed execution path.
  - Working hours describe when Exo should treat sync pressure as due now versus queued for the next open window.
`
    );

  users
    .command("intake")
    .description("Inspect execution bootstrap state and return the next setup question before live work.")
    .option("--label <label>", "Candidate execution-user label such as william-main")
    .option("--json", "Emit machine-readable JSON")
    .action((options) => {
      const result = buildUserIntake(
        {
          label: options.label ?? null,
        },
        {
          rawUsers: listUsers(),
          rawProfiles: listBrowserProfiles(),
        },
      );

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`User Intake: ${result.status}`);
      if (result.nextQuestion) {
        console.log(`Next Question: ${result.nextQuestion.prompt}`);
      }
      if (result.launchCommandHint) {
        console.log(`Launch Command: ${result.launchCommandHint}`);
      }
    });

  users
    .command("add")
    .description("Create a new execution user.")
    .requiredOption("--label <label>", "Stable user label such as operator-main")
    .option("--owner <owner>", "Owner such as operator")
    .option("--notes <notes>", "Freeform notes")
    .option("--json", "Emit machine-readable JSON")
    .action((options) => {
      if (findUserByLabel(options.label)) {
        console.error(`User label already exists: ${options.label}`);
        process.exitCode = 1;
        return;
      }

      const user = addUser({
        label: options.label,
        owner: options.owner ?? null,
        notes: options.notes ?? null
      });
      insertUser(user);

      if (options.json) {
        console.log(JSON.stringify(user, null, 2));
        return;
      }

      console.log(renderUserSummary(user));
    });

  users
    .command("list")
    .description("List execution users.")
    .option("--json", "Emit machine-readable JSON")
    .action((options) => {
      const userList = listUsers().map((user) => userSchema.parse(user));
      if (options.json) {
        console.log(JSON.stringify(userList, null, 2));
        return;
      }

      console.log(renderUserList(userList));
    });

  users
    .command("show")
    .description("Show one execution user.")
    .argument("<user-id>", "Execution user identifier")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const raw = findUserById(userId);
      if (!raw) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      const user = userSchema.parse(raw);
      if (options.json) {
        console.log(JSON.stringify(user, null, 2));
        return;
      }

      console.log(renderUserSummary(user));
    });

  const workingHours = users
    .command("working-hours")
    .description("Inspect or update the user's working-hours policy for planner scheduling.");

  workingHours
    .command("show")
    .description("Show the current working-hours policy and whether the window is open right now.")
    .argument("<user-id>", "Execution user identifier")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const raw = findUserById(userId);
      if (!raw) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      const result = buildUserWorkingHoursView(raw);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderUserWorkingHours(result));
    });

  workingHours
    .command("set")
    .description("Set or relax the user's working-hours policy.")
    .argument("<user-id>", "Execution user identifier")
    .option("--mode <mode>", "always | scheduled")
    .option("--timezone <timezone>", "IANA timezone such as America/New_York")
    .option("--weekday <weekday>", "Allowed weekday: sun, mon, tue, wed, thu, fri, sat", collect, [])
    .option("--start <time>", "Local start time in HH:MM")
    .option("--end <time>", "Local end time in HH:MM")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const raw = findUserById(userId);
      if (!raw) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      try {
        const updated = setUserWorkingHours(raw, {
          mode: options.mode ?? null,
          timezone: options.timezone ?? null,
          weekdays: options.weekday.length ? options.weekday : null,
          startLocalTime: options.start ?? null,
          endLocalTime: options.end ?? null
        });
        updateUser(updated);

        if (options.json) {
          console.log(JSON.stringify(updated, null, 2));
          return;
        }

        console.log(renderUserSummary(updated));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  const harness = users
    .command("harness")
    .description("Manage harness connectors available to a user.");

  harness
    .command("add")
    .description("Register or update a harness connector for a user.")
    .argument("<user-id>", "Execution user identifier")
    .requiredOption("--runtime <runtime>", "Runtime such as codex or claude")
    .requiredOption("--connector <connector>", "Connector/plugin such as chrome, gmail, browser-use")
    .option("--label <label>", "Optional human-friendly label")
    .option("--status <status>", "available | unavailable | unknown")
    .option("--notes <notes>", "Freeform notes")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const raw = findUserById(userId);
      if (!raw) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      const updated = upsertUserHarnessConnection(raw, {
        runtime: options.runtime,
        connector: options.connector,
        label: options.label ?? null,
        status: options.status ? userHarnessConnectionStatusSchema.parse(options.status) : null,
        notes: options.notes ?? null
      });
      updateUser(updated);

      if (options.json) {
        console.log(JSON.stringify(updated, null, 2));
        return;
      }

      console.log(renderUserSummary(updated));
    });

  harness
    .command("probe")
    .description("Inspect stored harness rows and the current runtime, then infer which connectors are actually callable.")
    .argument("<user-id>", "Execution user identifier")
    .option("--runtime <runtime>", "Filter to one runtime such as codex")
    .option("--connector <connector>", "Filter to one connector such as gmail or chrome")
    .option("--writeback", "Persist detected statuses back onto the matching harness connections")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const raw = findUserById(userId);
      if (!raw) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      const result = probeUserHarnessConnections(raw, {
        runtime: options.runtime ?? null,
        connector: options.connector ?? null,
        writeback: Boolean(options.writeback)
      });

      if (options.writeback) {
        updateUser(result.updatedUser);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderUserHarnessProbe(result));
    });

  const accounts = users
    .command("accounts")
    .description("Manage connected capability accounts owned by a user.");

  accounts
    .command("add")
    .description("Register or update one connected account for a user.")
    .argument("<user-id>", "Execution user identifier")
    .requiredOption("--capability <capability>", "generic-web | linkedin | sales-navigator | gmail | hubspot")
    .requiredOption("--handle <handle>", "Human-facing handle such as operator@example.com or operator-linkedin")
    .option("--label <label>", "Optional human-friendly account label")
    .option("--profile <profile-id>", "Resolve this account through a registered browser profile")
    .option("--runtime <runtime>", "Resolve this account through a harness connector runtime such as codex")
    .option("--connector <connector>", "Harness connector such as gmail or chrome")
    .option("--provider-account-id <account-id>", "Exact external account identity for managed connector accounts")
    .option("--preferred", "Mark this as the preferred account for the capability")
    .option("--max-connection-requests <count>", "Weekly quota for connection requests/invitations, or 'unlimited'")
    .option("--notes <notes>", "Freeform notes")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const raw = findUserById(userId);
      if (!raw) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      const hasProfile = Boolean(options.profile);
      const hasHarness = Boolean(options.runtime || options.connector);
      if (hasProfile === hasHarness) {
        console.error("Choose exactly one account source: --profile or --runtime with --connector.");
        process.exitCode = 1;
        return;
      }

      if (options.profile && !findBrowserProfileById(options.profile)) {
        console.error(`Browser profile not found: ${options.profile}`);
        process.exitCode = 1;
        return;
      }

      if (options.profile && options.providerAccountId) {
        console.error("--provider-account-id can only be used with --runtime and --connector.");
        process.exitCode = 1;
        return;
      }

      let nextRaw = raw;
      let harnessConnectionId = null;

      if (options.runtime || options.connector) {
        if (!options.runtime || !options.connector) {
          console.error("Harness-backed accounts require both --runtime and --connector.");
          process.exitCode = 1;
          return;
        }

        const probe = probeRuntimeConnectorAvailability(options.runtime, options.connector, {
          codexHome: process.env.CODEX_HOME ?? null,
          claudeCli: process.env.EXO_CLAUDE_CLI ?? null
        });
        const updatedHarnessUser = upsertUserHarnessConnection(nextRaw, {
          runtime: options.runtime,
          connector: options.connector,
          status: probe.detectedStatus
        });
        nextRaw = updatedHarnessUser;
        harnessConnectionId = updatedHarnessUser.harnessConnections.find(
          (connection) =>
            connection.runtime.toLowerCase() === options.runtime.toLowerCase()
            && connection.connector.toLowerCase() === options.connector.toLowerCase()
        )?.id ?? null;
      }

      const updated = upsertUserConnectedAccount(nextRaw, {
        capability: browserProfileCapabilitySchema.parse(options.capability),
        handle: options.handle,
        label: options.label ?? null,
        browserProfileId: options.profile ?? null,
        harnessConnectionId,
        providerAccountId: options.providerAccountId ?? null,
        preferred: options.preferred ? true : null,
        automationControls: buildAccountAutomationControlsFromOptions(options),
        notes: options.notes ?? null
      });
      updateUser(updated);

      if (options.json) {
        console.log(JSON.stringify(updated, null, 2));
        return;
      }

      console.log(renderUserSummary(updated));
    });

  accounts
    .command("map-runtime")
    .description("Probe one runtime for managed capability coverage, then map discovered LinkedIn, email, and related connector accounts onto a user.")
    .argument("<user-id>", "Execution user identifier")
    .requiredOption("--runtime <runtime>", "Runtime such as codex or claude")
    .option("--connector <connector>", "Limit mapping to one connector such as unipile, gmail, or hubspot")
    .option("--apply", "Persist the discovered connector mappings onto this user")
    .option("--prefer-managed", "Mark mapped managed accounts as preferred for their capability")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const raw = findUserById(userId);
      if (!raw) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      const result = mapUserRuntimeAccounts(raw, {
        runtime: options.runtime,
        connector: options.connector ?? null,
        apply: Boolean(options.apply),
        preferManaged: Boolean(options.preferManaged),
        codexHome: process.env.CODEX_HOME ?? null,
        claudeCli: process.env.EXO_CLAUDE_CLI ?? null
      });

      if (options.apply) {
        updateUser(result.updatedUser);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderUserRuntimeAccountMapping(result));
    });

  users
    .command("resolve")
    .description("Resolve the best connected account for a capability, optionally honoring a company assignment.")
    .argument("[user-id]", "Execution user identifier")
    .requiredOption("--capability <capability>", "generic-web | linkedin | sales-navigator | gmail | hubspot")
    .option("--company <company-id>", "Company identifier whose user assignment should be honored")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      let rawUser = userId ? findUserById(userId) : null;

      if (options.company) {
        const company = findCompanyById(options.company);
        if (!company) {
          console.error(`Company not found: ${options.company}`);
          process.exitCode = 1;
          return;
        }

        const assignedUserId = company.engagementUserAssignment?.userId ?? null;
        if (!assignedUserId) {
          console.error(`Company ${company.name} is not pinned to an execution user.`);
          process.exitCode = 1;
          return;
        }

        rawUser = findUserById(assignedUserId);
      }

      if (!rawUser) {
        console.error(`User not found: ${userId ?? "unknown"}`);
        process.exitCode = 1;
        return;
      }

      const result = resolveUserConnection(rawUser, listBrowserProfiles(), {
        capability: browserProfileCapabilitySchema.parse(options.capability)
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!result.resolved) {
        console.log(result.reason);
        return;
      }

      if (result.resolved.sourceType === "browser-profile") {
        console.log(`Use ${result.resolved.browserProfile.label} for ${result.capability} on ${result.user.label}.`);
        return;
      }

      console.log(
        `Use ${result.resolved.harnessConnection.runtime}:${result.resolved.harnessConnection.connector} for ${result.capability} on ${result.user.label}.`
      );
    });
}

/**
 * @param {string[]} value
 * @param {string} previous
 */
function collect(value, previous) {
  return previous ? [previous, value].flat() : [value];
}

/**
 * @param {Record<string, any>} options
 * @returns {{
 *   weeklyQuotas?: {
 *     invitations?: number | null
 *   }
 * } | null}
 */
function buildAccountAutomationControlsFromOptions(options) {
  const invitations = options.maxConnectionRequests !== undefined
    ? parseQuotaValue(options.maxConnectionRequests, "max-connection-requests")
    : undefined;

  if (invitations === undefined) {
    return null;
  }

  return {
    weeklyQuotas: {
      invitations
    }
  };
}

/**
 * @param {string} value
 * @param {string} label
 * @returns {number | null}
 */
function parseQuotaValue(value, label) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "unlimited" || normalized === "none" || normalized === "null") {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}: ${value}. Use a non-negative integer or 'unlimited'.`);
  }

  return parsed;
}
