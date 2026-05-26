#!/usr/bin/env node
// @ts-check

import { addBrowserProfile } from "../../core/add-browser-profile.js";
import { retestBrowserProfile } from "../../core/retest-browser-profile.js";
import {
  deleteBrowserProfile,
  findBrowserProfileById,
  findBrowserProfileByPath,
  insertBrowserProfile,
  listBrowserProfiles,
  updateBrowserProfile
} from "../../db/database.js";
import { browserProfileSchema } from "../../schema/browser-profile.js";
import { renderBrowserProfileSummary } from "../../artifacts/render-browser-profile.js";
import { resolveBrowserProfilePaths } from "../../lib/browser-profiles.js";

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
  exo profiles add --browser chrome --label work-linkedin --profile-directory "Profile 2" --capability linkedin --capability sales-navigator
  exo profiles list
  exo profiles test <profile-id>
`
    );

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
  - This command immediately runs a local profile verification pass and stores the result.
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
          `${profile.id}  ${profile.status}  ${profile.browser}  ${profile.profileDirectory}  ${profile.label}`
        );
      }
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
