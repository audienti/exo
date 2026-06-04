// @ts-check

import { browserProfileCapabilitySchema, browserProfileSchema } from "../schema/browser-profile.js";
import { companySchema } from "../schema/company.js";
import { motionSchema } from "../schema/motion.js";
import { userSchema } from "../schema/user.js";
import { resolveScopedExecutionAssignment } from "./resolve-scoped-execution-assignment.js";

/**
 * @param {unknown} rawCompany
 * @param {unknown | null} rawUser
 * @param {unknown[]} rawProfiles
 * @param {{ capability: string, rawMotion?: unknown | null, rawUsers?: unknown[] | null }} input
 */
export function buildCompanyExecutionView(rawCompany, rawUser, rawProfiles, input) {
  const company = companySchema.parse(rawCompany);
  const capability = browserProfileCapabilitySchema.parse(input.capability);
  const profiles = rawProfiles.map((profile) => browserProfileSchema.parse(profile));
  const user = rawUser ? userSchema.parse(rawUser) : null;
  const motion = input.rawMotion ? motionSchema.parse(input.rawMotion) : null;
  const scoped = resolveScopedExecutionAssignment({
    rawCompany: company,
    rawMotion: motion,
    rawProfiles: profiles,
    rawUsers: input.rawUsers ?? (user ? [user] : []),
    capability
  });
  const resolvedAccount = scoped.resolvedAccount;
  const resolvedProfile = scoped.resolvedProfile;
  const accountResolution = scoped.accountResolution ?? null;

  return {
    company: {
      id: company.id,
      name: company.name,
      domain: company.domain
    },
    motion: motion
      ? {
          id: motion.id,
          name: motion.name
        }
      : null,
    capability,
    assignmentSource: scoped.source,
    assignments: {
      user: scoped.assignedUser
        ? {
            userId: scoped.assignedUser.id,
            label: scoped.assignedUser.label,
            owner: scoped.assignedUser.owner,
            accountRefs: scoped.userAssignmentRecord?.accountRefs?.length
              ? scoped.userAssignmentRecord.accountRefs
              : scoped.assignedUser.accounts.map((account) => `${account.capability}:${account.handle}`),
            assignedAt: scoped.userAssignmentRecord?.assignedAt ?? null,
            reason: scoped.userAssignmentRecord?.reason ?? null
          }
        : null,
      profile: scoped.assignedProfile
        ? {
            profileId: scoped.assignedProfile.id,
            label: scoped.assignedProfile.label,
            browser: scoped.assignedProfile.browser,
            profileDirectory: scoped.assignedProfile.profileDirectory,
            assignedAt: scoped.profileAssignmentRecord?.assignedAt ?? scoped.userAssignmentRecord?.assignedAt ?? null,
            reason: scoped.profileAssignmentRecord?.reason ?? scoped.userAssignmentRecord?.reason ?? null
          }
        : null
    },
    resolvedAccount: resolvedAccount
      ? {
          accountId: resolvedAccount.accountId,
          capability: resolvedAccount.capability,
          handle: resolvedAccount.handle,
          label: resolvedAccount.label,
          providerAccountId: resolvedAccount.providerAccountId ?? null,
          sourceType: resolvedAccount.sourceType,
          status: resolvedAccount.status,
          reason: resolvedAccount.reason,
          browserProfile: resolvedAccount.browserProfile,
          harnessConnection: resolvedAccount.harnessConnection
        }
      : null,
    accountResolution: accountResolution
      ? {
          status: accountResolution.status,
          reason: accountResolution.reason,
          sourceType: accountResolution.sourceType ?? null
        }
      : null,
    resolvedProfile: resolvedProfile
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
    transport: buildTransportPlan({
      company,
      capability,
      resolvedAccount,
      resolvedProfile,
      accountResolution
    }),
    knowledgeRefs: [
      "docs/browser-profiles.md",
      "docs/agent-usage.md"
    ]
  };
}

/**
 * @param {{
 *   company: import("../schema/company.js").companySchema._type,
 *   capability: import("../schema/browser-profile.js").browserProfileCapabilitySchema._type,
 *   resolvedAccount: {
 *     accountId: string,
 *     capability: string,
 *     handle: string,
 *     label: string | null,
 *     providerAccountId?: string | null,
 *     sourceType: string,
 *     status: string,
 *     reason: string,
 *     browserProfile: unknown,
 *     harnessConnection: unknown
 *   } | null,
 *   resolvedProfile: import("../schema/browser-profile.js").browserProfileSchema._type | null,
 *   accountResolution: { status: string, reason: string, sourceType: string | null } | null
 * }} input
 */
function buildTransportPlan(input) {
  const { company, capability, resolvedAccount, resolvedProfile, accountResolution } = input;

  if (resolvedAccount?.sourceType === "harness-connection" && resolvedAccount.harnessConnection) {
    return {
      status: resolvedAccount.status === "ready" ? "ready" : "warning",
      mode: "harness-connection",
      preferredTransport: {
        tool: `${resolvedAccount.harnessConnection.runtime}:${resolvedAccount.harnessConnection.connector}`,
        reason: `This ${capability} path resolves through a managed connector. Exo should govern the work, not interface directly.`
      },
      fallbackTransport: null,
      runtimeChecks: [
        "Verify the named harness connector is callable in the current runtime before you act.",
        "Do not silently fall back to a browser identity when the connector path is missing.",
        "Write back the real outcome to Exo immediately after the action."
      ],
      failureClasses: [
        {
          key: "connector_unavailable",
          symptom: "The named runtime connector is missing, unavailable, or not callable in the current session.",
          operatorRule: "Treat this as an execution-path failure and repair the connector path before retrying the business action."
        }
      ],
      recoveryHints: [
        "Treat a missing or unavailable harness connector as a runtime-path failure, not a prospect failure.",
        "Stop and repair the connector path before retrying the business action."
      ],
      blocker: resolvedAccount.status === "ready"
        ? null
        : resolvedAccount.reason
    };
  }

  if (accountResolution?.sourceType === "harness-connection" && accountResolution.status !== "resolved") {
    return {
      status: "blocked",
      mode: "unresolved",
      preferredTransport: null,
      fallbackTransport: null,
      runtimeChecks: [
        "Resolve one exact managed account before you act.",
        "Do not let the connector identity default implicitly across multiple connected accounts.",
        "Write back the real outcome to Exo immediately after the action."
      ],
      failureClasses: [
        {
          key: "managed_account_identity_unresolved",
          symptom: "A managed connector exists, but Exo cannot yet prove which exact external account should act.",
          operatorRule: "Treat this as an identity-resolution failure and pin one exact managed account before retrying the business action."
        }
      ],
      recoveryHints: [
        "Claim the discovered managed account with its providerAccountId or mark one exact managed account preferred.",
        "Do not silently fall back to another connected account or another transport."
      ],
      blocker: accountResolution.reason
    };
  }

  if (accountResolution?.sourceType === "browser-profile" || resolvedAccount?.sourceType === "browser-profile" || resolvedProfile) {
    return {
      status: "blocked",
      mode: "unresolved",
      preferredTransport: null,
      fallbackTransport: null,
      runtimeChecks: [
        "Do not use browser-profile fallback for governed execution.",
        `Map a managed ${capability} connector account for ${company.name} before launch.`
      ],
      failureClasses: [
        {
          key: "legacy_browser_profile_unsupported",
          symptom: "A browser-profile execution path still exists in state, but browser-profile fallback has been removed.",
          operatorRule: "Stop and replace the legacy browser-profile mapping with a managed connector account before attempting the business action."
        }
      ],
      recoveryHints: [],
      blocker: `Profile-backed ${capability} accounts are no longer supported for ${company.name}. Map a managed connector account instead.`
    };
  }

  return {
    status: "blocked",
    mode: "unresolved",
    preferredTransport: null,
    fallbackTransport: null,
    runtimeChecks: [
      "Resolve one exact managed connector account before you act.",
      "Do not let browser-profile state stand in for a governed execution path."
    ],
    failureClasses: [
      {
        key: "missing_execution_path",
        symptom: "No resolved harness connector exists for the requested capability.",
        operatorRule: "Stop and resolve the company execution assignment before attempting the business action."
      }
    ],
    recoveryHints: [],
    blocker: `No resolved managed connector account exists for ${company.name} on ${capability}.`
  };
}
