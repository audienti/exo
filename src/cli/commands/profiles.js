#!/usr/bin/env node
// @ts-check

import { addBrowserProfile } from "../../core/add-browser-profile.js";
import { claimBrowserProfile } from "../../core/claim-browser-profile.js";
import { probeBrowserProfileAuth } from "../../core/probe-browser-profile-auth.js";
import { retestBrowserProfile } from "../../core/retest-browser-profile.js";
import {
  deleteBrowserProfile,
  findBrowserProfileById,
  findBrowserProfileByPath,
  insertBrowserProfile,
  findCompanyById,
  findUserById,
  listBrowserProfiles,
  updateBrowserProfile
} from "../../db/database.js";
import {
  browserProfileCapabilitySchema,
  browserProfileIdentityScopeSchema,
  browserKeySchema,
  browserProfileSchema
} from "../../schema/browser-profile.js";
import {
  renderBrowserProfileCapabilities,
  renderDiscoveredBrowserProfiles,
  renderBrowserProfileSummary
} from "../../artifacts/render-browser-profile.js";
import { resolveUserConnection } from "../../core/resolve-user-connection.js";
import { discoverBrowserProfiles, resolveBrowserProfilePaths } from "../../lib/browser-profiles.js";

/**
 * @param {import("commander").Command} program
 */
export function registerProfiles(program) {
  const profiles = program
    .command("profiles")
    .description("Manage browser profiles used for browser-backed Exo actions.")
    .addHelpText(
      "after",
      `
Profile rules:
  - Browser-backed work should not guess which local browser identity to use.
  - Register a profile once, then re-test it before unattended or overnight work.
  - Use --json when another agent needs the exact stored profile object.

Status meanings:
  ready    profile looks usable for browser-backed work
  warning  profile exists but has non-fatal trust issues
  invalid  profile should not be used until fixed

Typical flow:
  exo profiles discover --json
  exo profiles add --browser chrome --label work-linkedin --profile-directory "Profile 2" --capability linkedin --capability sales-navigator
  exo profiles claim <profile-id> --label workspace-main --workspace workspace --account linkedin:operator-linkedin --max-inmail-messages 20
  exo profiles list
  exo profiles capabilities --json
  exo profiles resolve --capability linkedin --json
  exo profiles test <profile-id>
  exo profiles auth <profile-id> --runtime codex --json
`
    );

  profiles
    .command("discover")
    .description("Scan local browser roots and report candidate profiles before registration.")
    .option("--browser <browser>", "Limit discovery to one browser; may be repeated", collect, [])
    .option("--user-data-dir <path>", "Override user data root for a single browser scan")
    .option("--browser-command <path>", "Override browser executable path for a single browser scan")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo profiles discover --json
  exo profiles discover --browser chrome --json
  exo profiles discover --browser chrome --user-data-dir "~/Library/Application Support/Google/Chrome" --json

Rules:
  - Discovery does not register anything.
  - Discovery reports candidate profiles, detected names, local evidence, and whether a profile is already registered in Exo.
  - Use --user-data-dir or --browser-command only when scanning a single browser.
`
    )
    .action((options) => {
      const browsers = options.browser.length
        ? [...new Set(options.browser.map((browser) => browserKeySchema.parse(browser)))]
        : browserKeySchema.options;

      if ((options.userDataDir || options.browserCommand) && browsers.length !== 1) {
        console.error("Use --user-data-dir and --browser-command only when scanning a single browser.");
        process.exitCode = 1;
        return;
      }

      const registeredByPath = new Map(
        listBrowserProfiles().map((profile) => {
          const parsed = browserProfileSchema.parse(profile);
          return [parsed.profilePath, parsed];
        })
      );

      const candidates = browsers.flatMap((browser) =>
        discoverBrowserProfiles({
          browser,
          userDataDir: options.userDataDir ?? null,
          browserCommand: options.browserCommand ?? null
        }).map((candidate) => {
          const existing = registeredByPath.get(candidate.profilePath);
          return {
            ...candidate,
            registered: Boolean(existing),
            registeredProfileId: existing?.id ?? null,
            registeredLabel: existing?.label ?? null,
            registeredStatus: existing?.status ?? null,
            declaredCapabilities: existing?.capabilities ?? [],
            verifiedCapabilities: existing?.verifiedCapabilities ?? []
          };
        })
      );

      const result = {
        browsersScanned: browsers,
        candidates
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderDiscoveredBrowserProfiles(result));
    });

  profiles
    .command("claim")
    .description("Claim a registered browser profile as a named business identity.")
    .argument("<profile-id>", "Browser profile identifier")
    .option("--label <label>", "Human-friendly stable label such as workspace-main or client-main")
    .option("--owner <owner>", "Owner such as operator")
    .option("--workspace <workspace>", "Workspace or surface such as workspace, client, or personal")
    .option("--scope <scope>", "unknown | work | personal | shared")
    .option("--account <mapping>", "Capability mapping like linkedin:operator-linkedin", collect, [])
    .option("--max-profile-visits <count>", "Weekly quota for profile visits, or 'unlimited'")
    .option("--max-messages <count>", "Weekly quota for LinkedIn messages, or 'unlimited'")
    .option("--max-inmail-messages <count>", "Alias for the weekly LinkedIn messages quota, or 'unlimited'")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo profiles claim <profile-id> --label workspace-main --owner operator --workspace workspace --scope work --account linkedin:operator-linkedin --account gmail:operator@example.com
  exo profiles claim <profile-id> --label client-main --workspace client --account hubspot:client-main
  exo profiles claim <profile-id> --label workspace-main --max-profile-visits 60 --max-inmail-messages 20

This is the step that turns a browser context into a stable execution identity.
LinkedIn connection-request weekly quotas are now configured on the user-account record
(see exo users accounts add --help and exo users accounts map-runtime --help).
`
    )
    .action((profileId, options) => {
      const raw = findBrowserProfileById(profileId);
      if (!raw) {
        console.error(`Browser profile not found: ${profileId}`);
        process.exitCode = 1;
        return;
      }

      const scope = options.scope ? browserProfileIdentityScopeSchema.parse(options.scope) : null;
      const accounts = options.account.length ? options.account.map(parseAccountMapping) : null;
      const automationControls = buildAutomationControlsFromOptions(options);
      const updated = claimBrowserProfile(raw, {
        label: options.label ?? null,
        owner: options.owner ?? null,
        workspace: options.workspace ?? null,
        scope,
        accounts,
        automationControls
      });
      updateBrowserProfile(updated);

      if (options.json) {
        console.log(JSON.stringify(updated, null, 2));
        return;
      }

      console.log(renderBrowserProfileSummary(updated));
    });

  profiles
    .command("add")
    .description("Register a browser profile and run an initial access test.")
    .requiredOption("--browser <browser>", "chrome | chrome-beta | chromium | brave | arc | edge")
    .option("--label <label>", "Operator-facing label for this browser profile")
    .option("--user-data-dir <path>", "Browser user data root path")
    .option("--profile-directory <name>", "Profile directory such as Default or Profile 2")
    .option("--browser-command <path>", "Browser executable path")
    .option("--capability <capability>", "generic-web | linkedin | sales-navigator | gmail | hubspot", collect, [])
    .option("--notes <notes>", "Freeform notes")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo profiles add --browser chrome --label work-linkedin --profile-directory "Profile 2" --capability linkedin --capability sales-navigator
  exo profiles add --browser arc --label founder-gmail --profile-directory Default --capability gmail

Notes:
  - Default paths are currently macOS-oriented.
  - Pass --user-data-dir and --browser-command explicitly if your environment is non-standard.
  - This command immediately runs a local profile verification pass and stores both declared and verified capabilities.
`
    )
    .action((options) => {
      const resolved = resolveBrowserProfilePaths({
        browser: options.browser,
        userDataDir: options.userDataDir ?? null,
        profileDirectory: options.profileDirectory ?? null,
        browserCommand: options.browserCommand ?? null,
        label: options.label ?? null
      });

      const existing = findBrowserProfileByPath(resolved.profilePath);
      if (existing) {
        const profile = browserProfileSchema.parse(existing);
        console.error(`Browser profile already exists: ${profile.id} (${profile.label})`);
        process.exitCode = 1;
        return;
      }

      const profile = addBrowserProfile({
        browser: options.browser,
        userDataDir: options.userDataDir ?? null,
        profileDirectory: options.profileDirectory ?? null,
        browserCommand: options.browserCommand ?? null,
        label: options.label ?? null,
        capabilities: options.capability,
        notes: options.notes ?? null
      });

      insertBrowserProfile(profile);

      if (options.json) {
        console.log(JSON.stringify(profile, null, 2));
        return;
      }

      console.log(renderBrowserProfileSummary(profile));
    });

  profiles
    .command("list")
    .description("List registered browser profiles.")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Use this command when a human or agent needs to resolve profile ids before test/show/remove.
`
    )
    .action((options) => {
      const profiles = listBrowserProfiles().map((profile) => browserProfileSchema.parse(profile));

      if (options.json) {
        console.log(JSON.stringify(profiles, null, 2));
        return;
      }

      if (!profiles.length) {
        console.log("No browser profiles found.");
        return;
      }

      for (const profile of profiles) {
        console.log(
          `${profile.id}  ${profile.status}  ${profile.browser}  ${profile.profileDirectory}  ${profile.label}  declared:[${profile.capabilities.join(", ")}] verified:[${profile.verifiedCapabilities.join(", ")}] quotas:[inv=${formatQuota(profile.automationControls.weeklyQuotas.invitations)} msg=${formatQuota(profile.automationControls.weeklyQuotas.messages)}]`
        );
      }
    });

  profiles
    .command("capabilities")
    .description("Show browser-profile capability coverage across registered profiles.")
    .argument("[profile-id]", "Optional browser profile identifier")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo profiles capabilities
  exo profiles capabilities --json
  exo profiles capabilities <profile-id>

Use this when an agent needs to know:
  - which profiles have verified access signals for linkedin, sales-navigator, gmail, or hubspot
  - whether a required capability exists at all
  - which profile ids match a requested browser-backed action
`
    )
    .action((profileId, options) => {
      const supportedCapabilities = browserProfileCapabilitySchema.options;

      if (profileId) {
        const raw = findBrowserProfileById(profileId);
        if (!raw) {
          console.error(`Browser profile not found: ${profileId}`);
          process.exitCode = 1;
          return;
        }

        const profile = browserProfileSchema.parse(raw);
        const result = {
          profile: {
            id: profile.id,
            label: profile.label,
            status: profile.status,
            browser: profile.browser,
            profileDirectory: profile.profileDirectory,
            declaredCapabilities: profile.capabilities,
            verifiedCapabilities: profile.verifiedCapabilities
          },
          supportedCapabilities
        };

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(renderBrowserProfileCapabilities([profile], supportedCapabilities));
        return;
      }

      const profiles = listBrowserProfiles().map((profile) => browserProfileSchema.parse(profile));
      const result = {
        supportedCapabilities,
        profiles: profiles.map((profile) => ({
          id: profile.id,
          label: profile.label,
          status: profile.status,
          browser: profile.browser,
          profileDirectory: profile.profileDirectory,
          declaredCapabilities: profile.capabilities,
          verifiedCapabilities: profile.verifiedCapabilities
        })),
        coverage: Object.fromEntries(
          supportedCapabilities.map((capability) => [
            capability,
            profiles
              .filter((profile) => profile.verifiedCapabilities.includes(capability))
              .map((profile) => ({
                id: profile.id,
                label: profile.label,
                status: profile.status
              }))
          ])
        )
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderBrowserProfileCapabilities(profiles, supportedCapabilities));
    });

  profiles
    .command("resolve")
    .description("Resolve the best verified browser profile for a required capability.")
    .requiredOption("--capability <capability>", "generic-web | linkedin | sales-navigator | gmail | hubspot")
    .option("--browser <browser>", "Optional browser preference")
    .option("--company <company-id>", "Honor sticky profile assignment for a company if one exists")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Use this when an agent needs a concrete answer to:
  - which browser should I use?
  - which profile should I use?

Examples:
  exo profiles resolve --capability linkedin --json
  exo profiles resolve --capability sales-navigator --browser chrome --json
`
    )
    .action((options) => {
      const supportedCapabilities = browserProfileCapabilitySchema.options;
      if (!supportedCapabilities.includes(options.capability)) {
        console.error(`Unsupported capability: ${options.capability}`);
        process.exitCode = 1;
        return;
      }

      const profiles = listBrowserProfiles().map((profile) => browserProfileSchema.parse(profile));
      const company = options.company ? findCompanyById(options.company) : null;
      if (options.company && !company) {
        console.error(`Company not found: ${options.company}`);
        process.exitCode = 1;
        return;
      }
      const assignedUser = company?.engagementUserAssignment
        ? findUserById(company.engagementUserAssignment.userId)
        : null;
      const assignedUserResolution = assignedUser
        ? resolveUserConnection(assignedUser, profiles, { capability: options.capability }).resolved
        : null;
      const assigned = assignedUserResolution?.browserProfile
        ? profiles.find((profile) => profile.id === assignedUserResolution.browserProfile.id) ?? null
        : company?.engagementProfileAssignment
          ? profiles.find((profile) => profile.id === company.engagementProfileAssignment.profileId) ?? null
          : null;
      const candidates = profiles
        .filter((profile) => profile.verifiedCapabilities.includes(options.capability))
        .filter((profile) => (options.browser ? profile.browser === options.browser : true))
        .sort((a, b) => compareProfilesForResolution(a, b));

      const assignedSatisfies = Boolean(
        assigned
        && assigned.verifiedCapabilities.includes(options.capability)
        && (!options.browser || assigned.browser === options.browser)
      );
      const resolvedProfile = assignedUserResolution
        ? assignedSatisfies ? assigned : null
        : assigned ? assignedSatisfies ? assigned : null : (candidates[0] ?? null);
      const resolutionMode = assignedUserResolution
        ? assignedSatisfies
          ? "company-user-assignment"
          : "blocked-by-company-user-assignment"
        : assigned
        ? assignedSatisfies
          ? "company-assignment"
          : "blocked-by-company-assignment"
        : "best-verified-match";

      const result = {
        capability: options.capability,
        browserPreference: options.browser ?? null,
        companyId: options.company ?? null,
        resolutionMode,
        assignedUser: assignedUser
          ? {
              id: assignedUser.id,
              label: assignedUser.label,
              owner: assignedUser.owner,
              resolvedAccount: assignedUserResolution
            }
          : null,
        assignedProfile: assigned
          ? {
              id: assigned.id,
              label: assigned.label,
              browser: assigned.browser,
              profileDirectory: assigned.profileDirectory,
              verifiedCapabilities: assigned.verifiedCapabilities
            }
          : null,
        resolved: resolvedProfile
          ? {
              id: resolvedProfile.id,
              label: resolvedProfile.label,
              browser: resolvedProfile.browser,
              browserCommand: resolvedProfile.browserCommand,
              userDataDir: resolvedProfile.userDataDir,
              profileDirectory: resolvedProfile.profileDirectory,
              profilePath: resolvedProfile.profilePath,
              verifiedCapabilities: resolvedProfile.verifiedCapabilities
            }
          : null,
        blocker:
          assignedUserResolution && assignedUserResolution.sourceType === "harness-connection"
            ? `Company is assigned to ${assignedUser.label}, but ${options.capability} resolves through a harness connection instead of a browser profile.`
            : assignedUserResolution && assignedUserResolution.sourceType === "browser-profile" && !assignedUserResolution.browserProfile
              ? `Company is assigned to ${assignedUser.label}, but the assigned browser-profile account is missing its registered profile.`
              : assigned && !assignedSatisfies
              ? `Company is assigned to ${assigned.label}, but that profile is not verified for ${options.capability}.`
              : null,
        candidates: candidates.map((profile) => ({
          id: profile.id,
          label: profile.label,
          status: profile.status,
          browser: profile.browser,
          profileDirectory: profile.profileDirectory,
          verifiedCapabilities: profile.verifiedCapabilities
        }))
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!result.resolved) {
        if (result.blocker) {
          console.log(result.blocker);
          return;
        }

        console.log(`No verified browser profile found for capability ${options.capability}.`);
        return;
      }

      if (result.resolutionMode === "company-assignment" || result.resolutionMode === "company-user-assignment") {
        console.log(
          `Use assigned profile ${result.resolved.label} (${result.resolved.browser} / ${result.resolved.profileDirectory}) for ${options.capability}.`
        );
        return;
      }

      console.log(
        `Use ${result.resolved.browser} / ${result.resolved.profileDirectory} (${result.resolved.label}) for ${options.capability}.`
      );
    });

  profiles
    .command("show")
    .description("Show one registered browser profile.")
    .argument("<profile-id>", "Browser profile identifier")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo profiles show <profile-id>
  exo profiles show <profile-id> --json
`
    )
    .action((profileId, options) => {
      const raw = findBrowserProfileById(profileId);
      if (!raw) {
        console.error(`Browser profile not found: ${profileId}`);
        process.exitCode = 1;
        return;
      }

      const profile = browserProfileSchema.parse(raw);

      if (options.json) {
        console.log(JSON.stringify(profile, null, 2));
        return;
      }

      console.log(renderBrowserProfileSummary(profile));
    });

  profiles
    .command("test")
    .description("Re-test a registered browser profile and persist the latest result.")
    .argument("<profile-id>", "Browser profile identifier")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Use this command before browser-backed or unattended work.

It currently verifies:
  - user-data directory
  - profile directory
  - browser executable path
  - Local State
  - Preferences
  - Cookies
  - History

Examples:
  exo profiles test <profile-id>
  exo profiles test <profile-id> --json
`
    )
    .action((profileId, options) => {
      const raw = findBrowserProfileById(profileId);
      if (!raw) {
        console.error(`Browser profile not found: ${profileId}`);
        process.exitCode = 1;
        return;
      }

      const updated = retestBrowserProfile(raw);
      updateBrowserProfile(updated);

      if (options.json) {
        console.log(JSON.stringify(updated, null, 2));
        return;
      }

      console.log(renderBrowserProfileSummary(updated));
    });

  profiles
    .command("auth")
    .description("Probe live signed-in readiness for a registered browser profile and persist the latest auth result.")
    .argument("<profile-id>", "Browser profile identifier")
    .requiredOption("--runtime <runtime>", "codex | claude")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Use this command before browser-backed work when structural profile checks are not enough.

It currently verifies live signed-in readiness for the declared browser-backed capabilities on a trusted Chrome profile through the selected runtime.

Examples:
  exo profiles auth <profile-id> --runtime codex
  exo profiles auth <profile-id> --runtime claude --json
`
    )
    .action(async (profileId, options) => {
      const raw = findBrowserProfileById(profileId);
      if (!raw) {
        console.error(`Browser profile not found: ${profileId}`);
        process.exitCode = 1;
        return;
      }

      let updated;
      try {
        updated = await probeBrowserProfileAuth(raw, {
          runtime: options.runtime
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      updateBrowserProfile(updated);

      if (options.json) {
        console.log(JSON.stringify(updated, null, 2));
        return;
      }

      console.log(renderBrowserProfileSummary(updated));
    });

  profiles
    .command("remove")
    .description("Remove a registered browser profile.")
    .argument("<profile-id>", "Browser profile identifier")
    .addHelpText(
      "after",
      `
Use this when a stored profile is stale, wrong, or tied to a dead browser context.
`
    )
    .action((profileId) => {
      const raw = findBrowserProfileById(profileId);
      if (!raw) {
        console.error(`Browser profile not found: ${profileId}`);
        process.exitCode = 1;
        return;
      }

      deleteBrowserProfile(profileId);
      console.log(`Removed browser profile: ${profileId}`);
    });
}

/**
 * @param {string} value
 * @param {string[]} previous
 * @returns {string[]}
 */
function collect(value, previous) {
  previous.push(value);
  return previous;
}

/**
 * @param {string} value
 */
function parseAccountMapping(value) {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`Invalid account mapping: ${value}. Use capability:identifier.`);
  }

  const capability = browserProfileCapabilitySchema.parse(value.slice(0, separator).trim());
  const handle = value.slice(separator + 1).trim();
  if (!handle.length) {
    throw new Error(`Invalid account mapping: ${value}. Missing identifier.`);
  }

  return { capability, handle };
}

/**
 * @param {Record<string, any>} options
 * @returns {{
 *   weeklyQuotas?: {
 *     profileVisits?: number | null,
 *     messages?: number | null
 *   }
 * } | null}
 */
function buildAutomationControlsFromOptions(options) {
  const profileVisits = options.maxProfileVisits !== undefined
    ? parseQuotaValue(options.maxProfileVisits, "max-profile-visits")
    : undefined;
  const messageQuota = parseMessageQuotaOption(options.maxMessages, options.maxInmailMessages);

  if (profileVisits === undefined && messageQuota === undefined) {
    return null;
  }

  return {
    weeklyQuotas: {
      ...(profileVisits !== undefined ? { profileVisits } : {}),
      ...(messageQuota !== undefined ? { messages: messageQuota } : {})
    }
  };
}

/**
 * @param {string | undefined} maxMessages
 * @param {string | undefined} maxInmailMessages
 * @returns {number | null | undefined}
 */
function parseMessageQuotaOption(maxMessages, maxInmailMessages) {
  const messageQuota = maxMessages !== undefined
    ? parseQuotaValue(maxMessages, "max-messages")
    : undefined;
  const inmailQuota = maxInmailMessages !== undefined
    ? parseQuotaValue(maxInmailMessages, "max-inmail-messages")
    : undefined;

  if (messageQuota !== undefined && inmailQuota !== undefined && messageQuota !== inmailQuota) {
    throw new Error(
      `Conflicting message quotas: --max-messages=${formatQuota(messageQuota)} and --max-inmail-messages=${formatQuota(inmailQuota)}.`
    );
  }

  return messageQuota !== undefined ? messageQuota : inmailQuota;
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

/**
 * @param {number | null} value
 * @returns {string}
 */
function formatQuota(value) {
  return value === null ? "unlimited" : String(value);
}

/**
 * @param {import("../../schema/browser-profile.js").browserProfileSchema._type} left
 * @param {import("../../schema/browser-profile.js").browserProfileSchema._type} right
 */
function compareProfilesForResolution(left, right) {
  if (left.status === "ready" && right.status !== "ready") {
    return -1;
  }
  if (left.status !== "ready" && right.status === "ready") {
    return 1;
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}
