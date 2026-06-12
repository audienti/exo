#!/usr/bin/env node
// @ts-check

import { addUser } from "../../core/add-user.js";
import { buildUserIntake } from "../../core/build-user-intake.js";
import { mapUserRuntimeAccounts } from "../../core/map-user-runtime-accounts.js";
import {
  removeManagedAccountExclusion,
  removeUserConnectedAccount,
  upsertManagedAccountExclusion,
} from "../../core/user-account-governance.js";
import { buildUserWorkingHoursView, setUserWorkingHours } from "../../core/working-hours.js";
import { probeRuntimeConnectorAvailability, probeUserHarnessConnections } from "../../core/probe-user-harness-connections.js";
import { resolveUserConnection } from "../../core/resolve-user-connection.js";
import { upsertUserConnectedAccount, upsertUserHarnessConnection } from "../../core/upsert-user-harness-connection.js";
import {
  deleteUser,
  findBrowserProfileById,
  findCompanyById,
  findUserById,
  findUserByLabel,
  insertUser,
  listBrowserProfiles,
  listUsers,
  mutateUserById,
  updateUser,
  UserDeletionBlockedError
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
  exo users working-hours set <user-id> --timezone America/New_York --weekday mon --weekday tue --weekday wed --weekday thu --weekday fri --start 07:00 --end 18:00
  exo users harness add <user-id> --runtime codex --connector chrome --status available
  exo users harness probe <user-id> --runtime codex --json
  exo users harness probe <user-id> --runtime codex --connector gmail --writeback --json
  exo users accounts map-runtime <user-id> --runtime codex --apply --json
  exo users accounts add <user-id> --capability linkedin --handle operator-linkedin --runtime codex --connector <connector-from-probe> --provider-account-id <provider-account-id> --preferred
  exo users accounts add <user-id> --capability linkedin --handle operator-linkedin --runtime codex --connector <connector-from-probe> --provider-account-id acct-linkedin-1 --preferred --max-connection-requests 125
  exo users accounts remove <user-id> <account-id> --exclude --json
  exo users accounts exclude <user-id> --runtime codex --connector unipile --capability linkedin --provider-account-id acct-linkedin-2 --label "Wrong LinkedIn" --json
  exo users accounts add <user-id> --capability gmail --handle operator@example.com --runtime codex --connector gmail --provider-account-id <provider-account-id> --preferred
  exo users remove <user-id> --json
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

  users
    .command("remove")
    .description("Remove one execution user.")
    .argument("<user-id>", "Execution user identifier")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const raw = findUserById(userId);
      if (!raw) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      try {
        deleteUser(String(raw.id));
      } catch (error) {
        if (error instanceof UserDeletionBlockedError) {
          const blocked = {
            removed: false,
            user: {
              id: String(raw.id),
              label: String(raw.label),
            },
            blockedBy: error.references,
            message: error.message,
          };
          if (options.json) {
            console.log(JSON.stringify(blocked, null, 2));
          } else {
            console.error(error.message);
          }
          process.exitCode = 1;
          return;
        }
        throw error;
      }
      const result = {
        removed: true,
        user: {
          id: String(raw.id),
          label: String(raw.label),
        },
        message: `Removed execution user ${raw.label}.`,
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(result.message);
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
      if (!findUserById(userId)) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      const { user: updated } = mutateUserById(userId, (latestRaw) => {
        const next = upsertUserHarnessConnection(latestRaw, {
          runtime: options.runtime,
          connector: options.connector,
          label: options.label ?? null,
          status: options.status ? userHarnessConnectionStatusSchema.parse(options.status) : null,
          notes: options.notes ?? null
        });
        return { user: next };
      });

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
      if (!findUserById(userId)) {
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

      if ((options.runtime || options.connector) && (!options.runtime || !options.connector)) {
        console.error("Harness-backed accounts require both --runtime and --connector.");
        process.exitCode = 1;
        return;
      }

      // Probing the runtime is a side-effecty external call. Do it once
      // outside the user-row transaction so concurrent writers do not stack
      // up holding a BEGIN IMMEDIATE lock while a probe is in flight.
      const probe = (options.runtime && options.connector)
        ? probeRuntimeConnectorAvailability(options.runtime, options.connector, {
            codexHome: process.env.CODEX_HOME ?? null,
            claudeCli: process.env.EXO_CLAUDE_CLI ?? null
          })
        : null;

      const { user: updated } = mutateUserById(userId, (latestRaw) => {
        let nextRaw = latestRaw;
        let harnessConnectionId = null;
        if (probe) {
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

        const next = upsertUserConnectedAccount(nextRaw, {
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
        return { user: next };
      });

      if (options.json) {
        console.log(JSON.stringify(updated, null, 2));
        return;
      }

      console.log(renderUserSummary(updated));
    });

  accounts
    .command("remove")
    .description("Remove one connected account from a user.")
    .argument("<user-id>", "Execution user identifier")
    .argument("<account-id>", "Connected account identifier")
    .option("--exclude", "Also exclude this managed identity so map-runtime will not reattach it later")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, accountId, options) => {
      const raw = findUserById(userId);
      if (!raw) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      try {
        const result = removeUserConnectedAccount(raw, accountId, {
          excludeManagedIdentity: Boolean(options.exclude),
        });
        updateUser(result.updatedUser);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(renderUserSummary(result.updatedUser));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  accounts
    .command("exclude")
    .description("Exclude one managed account identity so runtime mapping will not reattach it.")
    .argument("<user-id>", "Execution user identifier")
    .option("--account <account-id>", "Existing connected account to exclude")
    .option("--runtime <runtime>", "Runtime such as codex or claude")
    .option("--connector <connector>", "Connector such as unipile or gmail")
    .option("--capability <capability>", "generic-web | linkedin | sales-navigator | gmail | hubspot")
    .option("--provider-account-id <account-id>", "Exact external account identity")
    .option("--handle <handle>", "Connected account handle")
    .option("--label <label>", "Optional human-friendly account label")
    .option("--notes <notes>", "Freeform notes")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const raw = findUserById(userId);
      if (!raw) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      try {
        const payload = buildManagedExclusionInput(raw, options);
        const updated = upsertManagedAccountExclusion(raw, payload);
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

  accounts
    .command("unexclude")
    .description("Remove one managed account exclusion so runtime mapping may attach it again.")
    .argument("<user-id>", "Execution user identifier")
    .argument("<exclusion-id>", "Managed account exclusion identifier")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, exclusionId, options) => {
      const raw = findUserById(userId);
      if (!raw) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      try {
        const updated = removeManagedAccountExclusion(raw, exclusionId);
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

      let result;
      if (options.apply) {
        // Run the discovery + merge inside the transaction so a parallel
        // claim against the same user cannot drop the LinkedIn or Gmail
        // accounts that this mapping just attached.
        const outcome = mutateUserById(userId, (latestRaw) => {
          const mapping = mapUserRuntimeAccounts(latestRaw, {
            runtime: options.runtime,
            connector: options.connector ?? null,
            apply: true,
            preferManaged: Boolean(options.preferManaged),
            codexHome: process.env.CODEX_HOME ?? null,
            claudeCli: process.env.EXO_CLAUDE_CLI ?? null
          });
          return { user: mapping.updatedUser, result: mapping };
        });
        result = outcome.result;
      } else {
        result = mapUserRuntimeAccounts(raw, {
          runtime: options.runtime,
          connector: options.connector ?? null,
          apply: false,
          preferManaged: Boolean(options.preferManaged),
          codexHome: process.env.CODEX_HOME ?? null,
          claudeCli: process.env.EXO_CLAUDE_CLI ?? null
        });
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
          console.error(`Company ${company.name} is not assigned to an execution user.`);
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
 * @param {any} rawUser
 * @param {Record<string, any>} options
 */
function buildManagedExclusionInput(rawUser, options) {
  if (options.account) {
    const account = Array.isArray(rawUser.accounts)
      ? rawUser.accounts.find((candidate) => candidate.id === options.account)
      : null;
    if (!account) {
      throw new Error(`Connected account not found: ${options.account}`);
    }
    if (account.sourceType !== "harness-connection") {
      throw new Error(`Connected account ${options.account} is not a managed harness-backed identity.`);
    }
    const harnessConnection = Array.isArray(rawUser.harnessConnections)
      ? rawUser.harnessConnections.find((candidate) => candidate.id === account.harnessConnectionId)
      : null;
    if (!harnessConnection) {
      throw new Error(`Harness connection missing for connected account ${options.account}.`);
    }
    return {
      runtime: harnessConnection.runtime,
      connector: harnessConnection.connector,
      capability: account.capability,
      providerAccountId: account.providerAccountId ?? null,
      handle: account.handle,
      label: options.label ?? account.label ?? null,
      notes: options.notes ?? account.notes ?? null,
    };
  }

  if (!options.runtime || !options.connector || !options.capability) {
    throw new Error("Managed account exclusions require --account or --runtime, --connector, and --capability.");
  }
  if (!options.providerAccountId && !options.handle) {
    throw new Error("Managed account exclusions require --provider-account-id or --handle.");
  }

  return {
    runtime: options.runtime,
    connector: options.connector,
    capability: browserProfileCapabilitySchema.parse(options.capability),
    providerAccountId: options.providerAccountId ?? null,
    handle: options.handle ?? null,
    label: options.label ?? null,
    notes: options.notes ?? null,
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
