// @ts-check

import { browserProfileSchema } from "../schema/browser-profile.js";
import { testBrowserProfile } from "../lib/browser-profiles.js";

/**
 * @param {unknown} rawProfile
 */
export function retestBrowserProfile(rawProfile) {
  const profile = browserProfileSchema.parse(rawProfile);
  const now = new Date().toISOString();
  const test = testBrowserProfile({
    browser: profile.browser,
    userDataDir: profile.userDataDir,
    profileDirectory: profile.profileDirectory,
    browserCommand: profile.browserCommand,
    profilePath: profile.profilePath
  });

  return browserProfileSchema.parse({
    ...profile,
    updatedAt: now,
    detectedProfileName: test.detectedProfileName,
    status: test.result.status,
    lastTestedAt: now,
    lastTestResult: test.result
  });
}
