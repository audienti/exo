// @ts-check

import { browserProfileCapabilitySchema } from "../schema/browser-profile.js";
import { inboundSyncPlanModeSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";
import { buildLiveGmailInboundSyncPayload } from "./inbound-gmail-live-sync.js";
import { buildLiveLinkedinInboundSyncPayload } from "./inbound-linkedin-live-sync.js";
import { buildUserInboundSyncPlan } from "./user-inbound-sync.js";

const LIVE_SUPPORTED_CAPABILITIES = new Set(["gmail", "linkedin"]);

/**
 * @param {unknown} rawUser
 * @param {unknown[]} rawProfiles
 * @param {{
 *   accountId?: string | null,
 *   capability?: import("../schema/browser-profile.js").browserProfileCapabilitySchema._type | null,
 *   mode?: import("../schema/inbound.js").inboundSyncPlanModeSchema._type | null,
 *   runtime?: string | null,
 *   limit?: number | null,
 *   since?: string | null,
 *   codexCli?: string | null,
 *   codexHome?: string | null,
 *   claudeCli?: string | null
 * }} [options]
 */
export async function buildLiveInboundSyncPayload(rawUser, rawProfiles, options = {}) {
  const user = userSchema.parse(rawUser);
  const capability = options.capability ? browserProfileCapabilitySchema.parse(options.capability) : null;
  const mode = inboundSyncPlanModeSchema.parse(options.mode ?? "quick");

  if (mode !== "quick") {
    throw new Error("Live inbound sync currently supports quick mode only.");
  }

  const plan = buildUserInboundSyncPlan(user, {
    accountId: options.accountId ?? null,
    capability,
    mode
  });

  if (!plan.accounts.length) {
    throw new Error(`No enabled inbound sync accounts are available for ${mode} mode on user ${user.id}.`);
  }

  const runnableAccounts = plan.accounts.filter((account) => LIVE_SUPPORTED_CAPABILITIES.has(account.capability));
  if (!runnableAccounts.length) {
    throw new Error(`No live-supported inbound accounts are enabled for ${mode} mode on user ${user.id}.`);
  }

  const accountResults = [];
  for (const accountPlan of runnableAccounts) {
    if (accountPlan.capability === "linkedin") {
      const built = await buildLiveLinkedinInboundSyncPayload(user, rawProfiles, {
        accountId: accountPlan.accountId,
        runtime: options.runtime ?? null,
        limit: options.limit ?? null,
        codexCli: options.codexCli ?? null,
        codexHome: options.codexHome ?? null,
        claudeCli: options.claudeCli ?? null
      });
      accountResults.push({
        account: built.account,
        profile: built.profile,
        probe: built.probe,
        capture: built.capture,
        payload: built.payload
      });
      continue;
    }

    if (accountPlan.capability === "gmail") {
      const built = await buildLiveGmailInboundSyncPayload(user, rawProfiles, {
        accountId: accountPlan.accountId,
        runtime: options.runtime ?? null,
        limit: options.limit ?? null,
        since: options.since ?? null,
        codexCli: options.codexCli ?? null,
        codexHome: options.codexHome ?? null,
        claudeCli: options.claudeCli ?? null
      });
      accountResults.push({
        account: built.account,
        profile: built.profile,
        probe: built.probe,
        capture: built.capture,
        payload: built.payload
      });
    }
  }

  return {
    user: {
      id: user.id,
      label: user.label,
      owner: user.owner
    },
    generatedAt: new Date().toISOString(),
    mode,
    plan: {
      headline: plan.headline,
      counts: plan.counts,
      followUpCommands: plan.followUpCommands,
      requestedAccountCount: plan.accounts.length,
      runnableAccountCount: accountResults.length
    },
    accounts: accountResults,
    payload: {
      mode,
      accounts: accountResults.flatMap((account) => account.payload.accounts)
    }
  };
}
