// @ts-check

import crypto from "node:crypto";
import { browserProfileSchema } from "../schema/browser-profile.js";
import { resolveBrowserProfilePaths, testBrowserProfile } from "../lib/browser-profiles.js";

/**
 * @param {{
 *   browser: unknown,
 *   userDataDir?: string | null,
 *   profileDirectory?: string | null,
 *   browserCommand?: string | null,
 *   label?: string | null,
 *   capabilities?: string[] | null,
 *   notes?: string | null
 * }} input
 */
export function addBrowserProfile(input) {
  const resolved = resolveBrowserProfilePaths(input);
  const now = new Date().toISOString();
  const test = testBrowserProfile({
    browser: resolved.browser,
    userDataDir: resolved.userDataDir,
    profileDirectory: resolved.profileDirectory,
    browserCommand: resolved.browserCommand,
    profilePath: resolved.profilePath,
    capabilities: input.capabilities ?? ["generic-web"]
  });

  return browserProfileSchema.parse({
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    label: resolved.label,
    browser: resolved.browser,
    browserCommand: resolved.browserCommand,
    userDataDir: resolved.userDataDir,
    profileDirectory: resolved.profileDirectory,
    profilePath: resolved.profilePath,
    detectedProfileName: test.detectedProfileName,
    capabilities: input.capabilities?.length ? input.capabilities : ["generic-web"],
    verifiedCapabilities: test.verifiedCapabilities,
    notes: input.notes ?? null,
    status: test.result.status,
    lastTestedAt: now,
    lastTestResult: test.result
  });
}
