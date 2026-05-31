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
            accountRefs: scoped.assignedUser.accounts.map((account) => `${account.capability}:${account.handle}`),
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
          sourceType: resolvedAccount.sourceType,
          status: resolvedAccount.status,
          reason: resolvedAccount.reason,
          browserProfile: resolvedAccount.browserProfile,
          harnessConnection: resolvedAccount.harnessConnection
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
      resolvedProfile
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
 *     sourceType: string,
 *     status: string,
 *     reason: string,
 *     browserProfile: unknown,
 *     harnessConnection: unknown
 *   } | null,
 *   resolvedProfile: import("../schema/browser-profile.js").browserProfileSchema._type | null
 * }} input
 */
function buildTransportPlan(input) {
  const { company, capability, resolvedAccount, resolvedProfile } = input;

  if (resolvedAccount?.sourceType === "harness-connection" && resolvedAccount.harnessConnection) {
    return {
      status: resolvedAccount.status === "ready" ? "ready" : "warning",
      mode: "harness-connection",
      preferredTransport: {
        tool: `${resolvedAccount.harnessConnection.runtime}:${resolvedAccount.harnessConnection.connector}`,
        reason: `This ${capability} path resolves through a harness connection instead of a browser profile.`
      },
      fallbackTransport: null,
      runtimeChecks: [
        "Verify the named harness connector is callable in the current runtime before you act.",
        "Do not silently fall back to a different browser identity when the harness path is missing.",
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
        : `The resolved harness connection is not ready for ${capability}.`
    };
  }

  if (!resolvedProfile) {
    return {
      status: "blocked",
      mode: "unresolved",
      preferredTransport: null,
      fallbackTransport: null,
      runtimeChecks: [
        "Resolve the company user and browser profile first.",
        `Run exo profiles resolve --capability ${capability} --company ${company.id} --json before browser-backed work.`
      ],
      failureClasses: [
        {
          key: "missing_execution_path",
          symptom: "No resolved browser profile or harness connector exists for the requested capability.",
          operatorRule: "Stop and resolve the company execution assignment before attempting browser-backed work."
        }
      ],
      recoveryHints: [],
      blocker: `No resolved browser profile or harness connection exists for ${company.name} on ${capability}.`
    };
  }

  const genericChecks = [
    "Do not switch identities mid-company. Keep the same execution user and browser profile for the whole account.",
    "Verify the signed-in surface matches the intended account before you click anything.",
    "Break sensitive LinkedIn sends into observed steps and verify the resulting state before you record success."
  ];

  if (resolvedProfile.browser === "chrome") {
    return {
      status: "ready",
      mode: "chrome-profile",
      preferredTransport: {
        tool: "chrome",
        reason: "Chrome-backed authenticated work should use the native Chrome browser-control surface first when the runtime exposes it."
      },
      fallbackTransport: {
        tool: "profile-relay",
        reason: "If native Chrome is not callable, use a lower-level relay bound explicitly to the resolved Chrome profile instead of an unqualified browser session."
      },
      runtimeChecks: [
        ...genericChecks,
        `Resolved browser profile: ${resolvedProfile.label} (${resolvedProfile.profileDirectory}).`,
        `Resolved profile path: ${resolvedProfile.profilePath}.`
      ],
      failureClasses: [
        {
          key: "profile_selection_ambiguity",
          symptom: "The runtime reports multiple browser attachments, multiple extensions, or lands in the wrong signed-in profile.",
          operatorRule: "Treat this as a transport-selection failure. Rebind explicitly to the resolved profile instead of retrying the business action blindly."
        },
        {
          key: "stale_transport_listener",
          symptom: "A relay or browser-control listener exists but is stale, unbound, or attached to the wrong browser context.",
          operatorRule: "Clear the stale listener once, retry with the same resolved profile, and stop if the listener still cannot bind correctly."
        },
        {
          key: "ui_hang_without_state_change",
          symptom: "The target UI opens but no success state appears after the action attempt.",
          operatorRule: "Break the flow into observed steps and verify each state transition before recording success or retrying."
        }
      ],
      recoveryHints: [
        "Treat multiple-browser or multiple-extension attachment errors as profile-selection failures, not prospect failures.",
        "Do not open an unqualified Playwriter or relay session when more than one Chrome profile or extension is attached.",
        `If you fall back to a relay, bind it explicitly to ${resolvedProfile.label} (${resolvedProfile.profileDirectory}) instead of the default attachment.`,
        "If the local relay listener is stale and has no active profile binding, clear it once and retry. Do not keep looping blind.",
        "If LinkedIn invite UI hangs, break the flow into observed steps: open profile, confirm Connect, open note, fill, send, then verify Pending or Message state before recording success."
      ],
      blocker: null
    };
  }

  return {
    status: "ready",
    mode: "browser-profile",
    preferredTransport: {
      tool: "browser-profile",
      reason: `This ${capability} path resolves through the pinned ${resolvedProfile.browser} profile.`
    },
    fallbackTransport: null,
    runtimeChecks: genericChecks,
    failureClasses: [
      {
        key: "wrong_signed_in_account",
        symptom: "The runtime opens the right browser binary but the wrong signed-in account or profile context.",
        operatorRule: "Treat this as an identity failure. Stop and restore the resolved profile instead of continuing under the wrong account."
      }
    ],
    recoveryHints: [
      "If the runtime cannot control the resolved profile directly, stop and repair the access path instead of drifting to another browser context."
    ],
    blocker: null
  };
}
