#!/usr/bin/env node
// @ts-check

import { addUser } from "../../core/add-user.js";
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
import { renderUserList, renderUserSummary } from "../../artifacts/render-user.js";
import { browserProfileCapabilitySchema } from "../../schema/browser-profile.js";
import { userHarnessConnectionStatusSchema, userSchema } from "../../schema/user.js";

/**
 * @param {import("commander").Command} program
 */
export function registerUsers(program) {
  const users = program
    .command("users")
    .description("Manage execution users that own connected accounts across browser profiles and harness connectors.")
    .addHelpText(
      "after",
      `
Examples:
  exo users add --label william-main --owner william
  exo users harness add <user-id> --runtime codex --connector chrome --status available
  exo users accounts add <user-id> --capability linkedin --handle wflanagan@audienti.com --profile <profile-id> --preferred
  exo users accounts add <user-id> --capability gmail --handle william@audienti.com --runtime codex --connector gmail --preferred
  exo users resolve <user-id> --capability gmail --json

Rules:
  - A user is the human or business identity.
  - Accounts are capability-specific connections owned by that user.
  - Accounts can resolve through a browser profile or a harness connection.
`
    );

  users
    .command("add")
    .description("Create a new execution user.")
    .requiredOption("--label <label>", "Stable user label such as william-main")
    .option("--owner <owner>", "Owner such as william")
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

  const accounts = users
    .command("accounts")
    .description("Manage connected capability accounts owned by a user.");

  accounts
    .command("add")
    .description("Register or update one connected account for a user.")
    .argument("<user-id>", "Execution user identifier")
    .requiredOption("--capability <capability>", "generic-web | linkedin | sales-navigator | gmail | hubspot")
    .requiredOption("--handle <handle>", "Human-facing handle such as william@audienti.com")
    .option("--label <label>", "Optional human-friendly account label")
    .option("--profile <profile-id>", "Resolve this account through a registered browser profile")
    .option("--runtime <runtime>", "Resolve this account through a harness connector runtime such as codex")
    .option("--connector <connector>", "Harness connector such as gmail or chrome")
    .option("--preferred", "Mark this as the preferred account for the capability")
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

      let nextRaw = raw;
      let harnessConnectionId = null;

      if (options.runtime || options.connector) {
        if (!options.runtime || !options.connector) {
          console.error("Harness-backed accounts require both --runtime and --connector.");
          process.exitCode = 1;
          return;
        }

        const updatedHarnessUser = upsertUserHarnessConnection(nextRaw, {
          runtime: options.runtime,
          connector: options.connector,
          status: "available"
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
        preferred: Boolean(options.preferred),
        notes: options.notes ?? null
      });
      updateUser(updated);

      if (options.json) {
        console.log(JSON.stringify(updated, null, 2));
        return;
      }

      console.log(renderUserSummary(updated));
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
        console.log(`No connected account found for ${result.capability} on ${result.user.label}.`);
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
