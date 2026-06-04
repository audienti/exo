#!/usr/bin/env node
// @ts-check

import {
  appendPolicyEvent,
  listPolicyEvents,
  loadEffectivePolicy,
} from "../../core/policy-ledger.js";
import { inboundSurfaceKeySchema } from "../../schema/inbound.js";

const POLICY_KINDS = [
  "ignore_identity",
  "unignore_identity",
  "hide_surface",
  "show_surface",
  "suppress_identity",
  "unsuppress_identity",
];

/**
 * @param {import("commander").Command} program
 */
export function registerPolicy(program) {
  const policy = program
    .command("policy")
    .description("Inspect or update layered operator policy overlays.")
    .addHelpText(
      "after",
      `
Canonical policy interface:
  exo policy list --scope effective --json
  exo policy add --scope global --kind ignore_identity --actor-handle person@example.com --reason "Never show this sender again" --json
  exo policy add --scope local --kind hide_surface --capability linkedin --surface linkedin-received-invitations --reason "Hide inbound invites in this repo" --json

Rules:
  - Global policy is the operator-private home ledger.
  - Local policy is the repo-shared overlay at ./exo-policy.jsonl.
  - Policy selectors use stable identities, not local SQLite row ids.
`
    );

  policy
    .command("list")
    .description("List global, local, or effective policy overlays.")
    .option("--scope <scope>", "global | local | effective", "effective")
    .option("--json", "Emit machine-readable JSON")
    .action((options) => {
      const scope = normalizeScope(options.scope, { allowEffective: true });
      if (!scope) {
        process.exitCode = 1;
        return;
      }

      if (scope === "effective") {
        const result = {
          scope,
          events: listPolicyEvents("effective"),
          effective: loadEffectivePolicy(),
        };

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(renderPolicyList(result));
        return;
      }

      const result = {
        scope,
        events: listPolicyEvents(scope),
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderPolicyList(result));
    });

  policy
    .command("add")
    .description("Append one policy event to the global or local overlay.")
    .requiredOption("--scope <scope>", "global | local")
    .requiredOption("--kind <kind>", POLICY_KINDS.join(" | "))
    .option("--reason <text>", "Operator note explaining the policy decision")
    .option("--provider-account-id <id>", "Stable provider account identifier")
    .option("--capability <capability>", "Capability such as linkedin or gmail")
    .option("--handle <handle>", "Stable account handle used when providerAccountId is unavailable")
    .option("--actor-handle <handle>", "Stable person handle or email")
    .option("--linkedin-member-id <id>", "LinkedIn member identifier")
    .option("--linkedin-public-id <id>", "LinkedIn public profile identifier")
    .option("--profile-url <url>", "Stable profile URL")
    .option("--thread-url <url>", "Stable thread URL")
    .option("--surface <surface-key>", "Canonical surface key")
    .option("--json", "Emit machine-readable JSON")
    .action((options) => {
      const scope = normalizeScope(options.scope, { allowEffective: false });
      if (!scope) {
        process.exitCode = 1;
        return;
      }

      const kind = String(options.kind ?? "").trim();
      if (!POLICY_KINDS.includes(kind)) {
        console.error(`Unsupported policy kind: ${options.kind}`);
        process.exitCode = 1;
        return;
      }

      let event;
      try {
        event = appendPolicyEvent(scope, buildPolicyEventInput(kind, options));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      const result = {
        scope,
        event,
        effective: loadEffectivePolicy(),
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderPolicyAdded(result));
    });
}

/**
 * @param {string | undefined} rawScope
 * @param {{ allowEffective: boolean }} options
 */
function normalizeScope(rawScope, options) {
  const scope = String(rawScope ?? "").trim().toLowerCase();
  if (scope === "global" || scope === "local") {
    return scope;
  }
  if (options.allowEffective && scope === "effective") {
    return scope;
  }
  console.error(`Unsupported --scope: ${rawScope}`);
  return null;
}

/**
 * @param {string} kind
 * @param {Record<string, any>} options
 */
function buildPolicyEventInput(kind, options) {
  const surfaceKey = normalizeNullableString(options.surface);
  const capability = normalizeNullableString(options.capability);
  const person = {
    actorHandle: normalizeNullableString(options.actorHandle),
    actorLinkedinMemberId: normalizeNullableString(options.linkedinMemberId),
    actorLinkedinPublicId: normalizeNullableString(options.linkedinPublicId),
    actorProfileUrl: normalizeNullableString(options.profileUrl),
    threadUrl: normalizeNullableString(options.threadUrl),
  };
  const account = {
    providerAccountId: normalizeNullableString(options.providerAccountId),
    capability,
    handle: normalizeNullableString(options.handle),
  };

  if ((kind === "hide_surface" || kind === "show_surface")) {
    if (!capability || !surfaceKey) {
      throw new Error(`${kind} requires --capability and --surface.`);
    }
    return {
      kind,
      reason: normalizeNullableString(options.reason),
      account: null,
      person: null,
      surface: {
        capability,
        surfaceKey: inboundSurfaceKeySchema.parse(surfaceKey),
      },
    };
  }

  const hasAccountSelector = Boolean(account.providerAccountId || account.handle || account.capability);
  const hasPersonSelector = Object.values(person).some(Boolean);
  if (!hasAccountSelector && !hasPersonSelector) {
    throw new Error(`${kind} requires at least one account or person selector.`);
  }

  return {
    kind,
    reason: normalizeNullableString(options.reason),
    account: hasAccountSelector ? account : null,
    person: hasPersonSelector ? person : null,
    surface: null,
  };
}

/**
 * @param {{ scope: string, events: any[], effective?: any }} result
 */
function renderPolicyList(result) {
  const lines = [`Policy scope: ${result.scope}`];
  if (!result.events.length) {
    lines.push("No policy events recorded.");
    return lines.join("\n");
  }

  for (const event of result.events) {
    const scopeLabel = event.scope ? ` [${event.scope}]` : "";
    lines.push(`${event.createdAt} ${event.kind}${scopeLabel} ${describeEventTarget(event)}`);
    if (event.reason) {
      lines.push(`  ${event.reason}`);
    }
  }

  if (result.effective) {
    lines.push(
      `Effective: ${result.effective.effective.ignoredIdentities.length} ignored identities, ` +
      `${result.effective.effective.suppressedIdentities.length} suppressed identities, ` +
      `${result.effective.effective.hiddenSurfaces.length} hidden surfaces.`,
    );
  }

  return lines.join("\n");
}

/**
 * @param {{ scope: string, event: any, effective: any }} result
 */
function renderPolicyAdded(result) {
  return [
    `Recorded ${result.event.kind} in ${result.scope} policy.`,
    `Target: ${describeEventTarget(result.event)}`,
    result.event.reason ? `Reason: ${result.event.reason}` : null,
    `Effective state: ${result.effective.effective.ignoredIdentities.length} ignored, ` +
      `${result.effective.effective.suppressedIdentities.length} suppressed, ` +
      `${result.effective.effective.hiddenSurfaces.length} hidden surfaces.`,
  ].filter(Boolean).join("\n");
}

/**
 * @param {any} event
 */
function describeEventTarget(event) {
  if (event.surface) {
    return `${event.surface.capability}:${event.surface.surfaceKey}`;
  }

  const parts = [];
  if (event.account?.providerAccountId) {
    parts.push(`providerAccountId=${event.account.providerAccountId}`);
  } else if (event.account?.capability || event.account?.handle) {
    parts.push(`account=${event.account?.capability ?? "unknown"}:${event.account?.handle ?? "unknown"}`);
  }
  if (event.person?.actorHandle) parts.push(`handle=${event.person.actorHandle}`);
  if (event.person?.actorLinkedinMemberId) parts.push(`memberId=${event.person.actorLinkedinMemberId}`);
  if (event.person?.actorLinkedinPublicId) parts.push(`publicId=${event.person.actorLinkedinPublicId}`);
  if (event.person?.actorProfileUrl) parts.push(`profile=${event.person.actorProfileUrl}`);
  if (event.person?.threadUrl) parts.push(`thread=${event.person.threadUrl}`);
  return parts.join(" ") || "unspecified target";
}

/**
 * @param {string | null | undefined} value
 */
function normalizeNullableString(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
}
