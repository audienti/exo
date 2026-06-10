// @ts-check

import fs from "node:fs";
import path from "node:path";
import { browserProfileSchema } from "../schema/browser-profile.js";
import { userSchema } from "../schema/user.js";
import { accountCanAttachConnectionNote } from "./connection-note-capability.js";
import { discoverRuntimeConnectorAccounts } from "./discover-runtime-account-identities.js";
import { getHomeStateDir } from "../db/paths.js";
import { isStoredManagedAccountExcluded } from "./user-account-governance.js";

const discoveredAccountCache = new Map();
const linkedinEvidenceCache = new Map();

export function resetResolveUserConnectionCachesForTest() {
  discoveredAccountCache.clear();
  linkedinEvidenceCache.clear();
}

/**
 * @param {unknown} rawUser
 * @param {unknown[]} rawProfiles
 * @param {{ capability: string }} input
 */
export function resolveUserConnection(rawUser, rawProfiles, input) {
  const user = userSchema.parse(rawUser);
  const profiles = rawProfiles.map((profile) => browserProfileSchema.parse(profile));
  const matches = user.accounts
    .filter((account) => account.capability === input.capability)
    .filter((account) => {
      const harnessConnection = account.harnessConnectionId
        ? user.harnessConnections.find((candidate) => candidate.id === account.harnessConnectionId) ?? null
        : null;
      return !isStoredManagedAccountExcluded(user, account, harnessConnection);
    })
    .map((account) => buildResolvedAccount(account, profiles, user))
    .sort(compareResolvedAccounts);
  const browserResolved = matches.find((candidate) => candidate.sourceType === "browser-profile") ?? null;
  const managedResolution = resolveManagedAccountResolution(matches, input.capability, user.label);
  if (managedResolution?.status === "resolved") {
    const resolved = managedResolution.resolved;
    return {
      user: {
        id: user.id,
        label: user.label,
        owner: user.owner
      },
      capability: input.capability,
      resolved,
      candidates: matches,
      resolutionStatus: "resolved",
      reason: resolved.reason,
      sourceType: resolved.sourceType
    };
  }

  if (managedResolution) {
    return {
      user: {
        id: user.id,
        label: user.label,
        owner: user.owner
      },
      capability: input.capability,
      resolved: managedResolution.resolved,
      candidates: matches,
      resolutionStatus: managedResolution.status,
      reason: managedResolution.reason,
      sourceType: managedResolution.sourceType
    };
  }

  if (browserResolved) {
    return {
      user: {
        id: user.id,
        label: user.label,
        owner: user.owner
      },
      capability: input.capability,
      resolved: null,
      candidates: matches,
      resolutionStatus: "unsupported",
      reason: `Profile-backed ${input.capability} accounts are no longer supported as governed execution paths. Map a managed connector account for ${user.label} before launch.`,
      sourceType: browserResolved.sourceType
    };
  }

  const resolved = matches[0] ?? null;

  return {
    user: {
      id: user.id,
      label: user.label,
      owner: user.owner
    },
    capability: input.capability,
    resolved,
    candidates: matches,
    resolutionStatus: resolved ? "resolved" : "not_found",
    reason: resolved
      ? resolved.reason
      : `No connected ${input.capability} account is stored for ${user.label}.`,
    sourceType: resolved?.sourceType ?? null
  };
}

/**
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type[]} profiles
 * @param {import("../schema/user.js").userSchema._type} user
 */
function buildResolvedAccount(account, profiles, user) {
  const explicitMetadata = account.metadata && typeof account.metadata === "object" ? account.metadata : null;
  const base = {
    accountId: account.id,
    capability: account.capability,
    handle: account.handle,
    label: account.label,
    preferred: account.preferred,
    sourceType: account.sourceType,
    providerAccountId: account.providerAccountId ?? null,
    metadata: explicitMetadata,
    connectionNoteCapable: accountCanAttachConnectionNote(account),
  };

  if (account.sourceType === "browser-profile") {
    const profile = profiles.find((candidate) => candidate.id === account.browserProfileId) ?? null;
    const ready = Boolean(profile && profile.status === "ready" && profile.verifiedCapabilities.includes(account.capability));
    return {
      ...base,
      status: ready ? "ready" : "warning",
      reason: ready
        ? `Resolved through browser profile ${profile.label}.`
        : profile
          ? `Profile ${profile.label} is not trusted for ${account.capability}.`
          : "Referenced browser profile is missing.",
      browserProfile: profile
        ? {
            id: profile.id,
            label: profile.label,
            browser: profile.browser,
            profileDirectory: profile.profileDirectory,
            verifiedCapabilities: profile.verifiedCapabilities
          }
        : null,
      harnessConnection: null
    };
  }

  const harnessConnection = user.harnessConnections.find((connection) => connection.id === account.harnessConnectionId) ?? null;
  const resolvedMetadata = resolveManagedAccountMetadata(account, harnessConnection);
  const ready = Boolean(harnessConnection && harnessConnection.status === "available");
  return {
    ...base,
    metadata: resolvedMetadata,
    connectionNoteCapable: accountCanAttachConnectionNote({
      ...account,
      metadata: resolvedMetadata,
    }),
    status: ready ? "ready" : "warning",
    reason: ready
      ? `Resolved through harness connection ${harnessConnection.runtime}:${harnessConnection.connector}.`
      : harnessConnection
        ? `Harness connection ${harnessConnection.runtime}:${harnessConnection.connector} is not currently available.`
        : "Referenced harness connection is missing.",
    browserProfile: null,
    harnessConnection: harnessConnection
      ? {
          id: harnessConnection.id,
          runtime: harnessConnection.runtime,
          connector: harnessConnection.connector,
          label: harnessConnection.label,
          status: harnessConnection.status
        }
      : null
  };
}

/**
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 * @param {import("../schema/user.js").userHarnessConnectionSchema._type | null} harnessConnection
 */
function resolveManagedAccountMetadata(account, harnessConnection) {
  const explicitMetadata = account.metadata && typeof account.metadata === "object" ? account.metadata : null;
  if (account.sourceType !== "harness-connection" || account.capability !== "linkedin") {
    return explicitMetadata;
  }

  if (!harnessConnection || String(harnessConnection.status ?? "").trim().toLowerCase() !== "available") {
    return explicitMetadata;
  }

  const cacheKey = `${String(harnessConnection.runtime ?? "").trim().toLowerCase()}:${String(harnessConnection.connector ?? "").trim().toLowerCase()}:${account.capability}`;
  let discoveredAccounts = discoveredAccountCache.get(cacheKey) ?? null;
  if (!discoveredAccounts) {
    try {
      discoveredAccounts = discoverRuntimeConnectorAccounts({
        runtime: harnessConnection.runtime,
        connector: harnessConnection.connector,
        capability: account.capability,
        codexHome: process.env.CODEX_HOME ?? null,
      });
    } catch {
      discoveredAccounts = [];
    }
    discoveredAccountCache.set(cacheKey, discoveredAccounts);
  }

  const match = discoveredAccounts.find((candidate) =>
    (account.providerAccountId && candidate.providerAccountId)
      ? candidate.providerAccountId === account.providerAccountId
      : candidate.handle === account.handle
  ) ?? null;

  const discoveredMetadata = match?.metadata && typeof match.metadata === "object" ? match.metadata : null;
  const evidenceMetadata = readLinkedinAccountEvidenceMetadata(account.id, account.providerAccountId ?? null);
  return mergeAccountMetadata(explicitMetadata, discoveredMetadata, evidenceMetadata);
}

/**
 * @param {Record<string, unknown> | null} explicitMetadata
 * @param {Record<string, unknown> | null} discoveredMetadata
 * @param {Record<string, unknown> | null} evidenceMetadata
 */
function mergeAccountMetadata(explicitMetadata, discoveredMetadata, evidenceMetadata) {
  const merged = {
    ...(explicitMetadata ?? {}),
    ...(discoveredMetadata ?? {}),
    ...(evidenceMetadata ?? {}),
  };
  const premiumFeatures = [
    ...(Array.isArray(explicitMetadata?.premiumFeatures) ? explicitMetadata.premiumFeatures : []),
    ...(Array.isArray(discoveredMetadata?.premiumFeatures) ? discoveredMetadata.premiumFeatures : []),
    ...(Array.isArray(evidenceMetadata?.premiumFeatures) ? evidenceMetadata.premiumFeatures : []),
  ]
    .map((feature) => normalizeNullableString(feature))
    .filter(Boolean);
  if (premiumFeatures.length) {
    merged.premiumFeatures = [...new Set(premiumFeatures)];
  }
  return Object.keys(merged).length ? merged : null;
}

/**
 * @param {string} accountId
 * @param {string | null} providerAccountId
 */
function readLinkedinAccountEvidenceMetadata(accountId, providerAccountId) {
  const normalizedManagedAccountId = normalizeNullableString(accountId);
  if (!normalizedManagedAccountId) {
    return null;
  }

  if (linkedinEvidenceCache.has(normalizedManagedAccountId)) {
    return linkedinEvidenceCache.get(normalizedManagedAccountId);
  }

  const filename = `inbound-linkedin-${normalizedManagedAccountId}.json`;
  const automationTmpDir = path.join(getHomeStateDir(), "automation-tmp");
  const filePaths = listNamedFiles(automationTmpDir, filename);
  if (!filePaths.length) {
    linkedinEvidenceCache.set(normalizedManagedAccountId, null);
    return null;
  }

  try {
    const normalizedProviderAccountId = normalizeNullableString(providerAccountId);
    const metadata = filePaths
      .map((filePath) => readLinkedinEvidenceCandidate(filePath))
      .filter(Boolean)
      .sort((left, right) => compareLinkedinEvidenceCandidates(left, right, normalizedProviderAccountId))
      .map((candidate) => candidate.metadata)
      .find(Boolean)
      ?? null;
    linkedinEvidenceCache.set(normalizedManagedAccountId, metadata);
    return metadata;
  } catch {
    linkedinEvidenceCache.set(normalizedManagedAccountId, null);
    return null;
  }
}

/**
 * @param {string} dir
 * @param {string} filename
 * @returns {string[]}
 */
function listNamedFiles(dir, filename) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  /** @type {string[]} */
  const matches = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === filename) {
        matches.push(fullPath);
      }
    }
  }

  return matches;
}

/**
 * @param {string} filePath
 */
function readLinkedinEvidenceCandidate(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }

  const metadataCandidate = extractLinkedinEvidenceMetadataCandidate(parsed);
  if (!metadataCandidate) {
    return null;
  }

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    mtimeMs = 0;
  }

  return {
    connectedProviderAccountId: metadataCandidate.connectedProviderAccountId,
    metadata: metadataCandidate.metadata,
    mtimeMs,
  };
}

/**
 * @param {unknown} parsed
 */
function extractLinkedinEvidenceMetadataCandidate(parsed) {
  const verifiedConnectedAccount = parsed?.accountVerification?.connectedAccount;
  if (verifiedConnectedAccount && typeof verifiedConnectedAccount === "object") {
    return buildLinkedinEvidenceMetadataCandidate({
      providerAccountId: verifiedConnectedAccount.accountId,
      accountType: verifiedConnectedAccount.type,
      publicIdentifier: verifiedConnectedAccount.publicIdentifier,
      username: verifiedConnectedAccount.name,
      premiumFeatures: verifiedConnectedAccount.premiumFeatures,
    });
  }

  const capturedAccount = parsed?.account;
  if (capturedAccount && typeof capturedAccount === "object") {
    // Folder inference can only prove premium, never free: a capture without
    // SALES_NAVIGATOR folders says nothing about the plan tier. Only pass the
    // feature list along when it carries positive evidence.
    const inferredPremiumFeatures = collectLinkedinEvidencePremiumFeatures(parsed);
    return buildLinkedinEvidenceMetadataCandidate({
      providerAccountId: capturedAccount.account_id,
      accountType: capturedAccount.provider,
      publicIdentifier: capturedAccount.public_identifier,
      username: capturedAccount.name,
      premiumFeatures: inferredPremiumFeatures.length ? inferredPremiumFeatures : null,
    });
  }

  return null;
}

/**
 * @param {{
 *   providerAccountId: unknown,
 *   accountType: unknown,
 *   publicIdentifier: unknown,
 *   username: unknown,
 *   premiumFeatures: unknown,
 * }} input
 */
function buildLinkedinEvidenceMetadataCandidate(input) {
  // Keep premiumFeatures only when the evidence actually carried the field.
  // A present-but-empty array means a verified free tier; an absent key means
  // the evidence said nothing about the plan tier.
  const premiumFeatures = Array.isArray(input.premiumFeatures)
    ? input.premiumFeatures
        .map((feature) => normalizeNullableString(feature))
        .filter(Boolean)
    : null;
  const metadata = {
    accountType: normalizeNullableString(input.accountType) ?? null,
    publicIdentifier: normalizeNullableString(input.publicIdentifier) ?? null,
    username: normalizeNullableString(input.username) ?? null,
  };
  if (premiumFeatures) {
    metadata.premiumFeatures = premiumFeatures;
  }

  if (!metadata.accountType && !metadata.publicIdentifier && !metadata.username && !premiumFeatures?.length) {
    return null;
  }

  return {
    connectedProviderAccountId: normalizeNullableString(input.providerAccountId),
    metadata,
  };
}

/**
 * @param {unknown} parsed
 * @returns {string[]}
 */
function collectLinkedinEvidencePremiumFeatures(parsed) {
  const premiumFeatures = new Set();
  for (const folder of collectLinkedinEvidenceFolders(parsed?.surfaces)) {
    if (folder.includes("SALES_NAVIGATOR")) {
      premiumFeatures.add("sales_navigator");
    }
  }
  return [...premiumFeatures];
}

/**
 * @param {unknown} rawSurfaces
 * @returns {string[]}
 */
function collectLinkedinEvidenceFolders(rawSurfaces) {
  const surfaces = Array.isArray(rawSurfaces)
    ? rawSurfaces
    : rawSurfaces && typeof rawSurfaces === "object"
      ? Object.values(rawSurfaces)
      : [];

  return surfaces.flatMap((surface) => {
    if (!surface || typeof surface !== "object" || !Array.isArray(surface.items)) {
      return [];
    }

    return surface.items.flatMap((item) => Array.isArray(item?.folder)
      ? item.folder
          .map((folder) => normalizeNullableString(folder))
          .filter(Boolean)
      : []);
  });
}

/**
 * @param {{ connectedProviderAccountId: string | null, metadata: Record<string, unknown>, mtimeMs: number }} left
 * @param {{ connectedProviderAccountId: string | null, metadata: Record<string, unknown>, mtimeMs: number }} right
 * @param {string | null} normalizedProviderAccountId
 */
function compareLinkedinEvidenceCandidates(left, right, normalizedProviderAccountId) {
  const scoreDelta = scoreLinkedinEvidenceCandidate(right, normalizedProviderAccountId)
    - scoreLinkedinEvidenceCandidate(left, normalizedProviderAccountId);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  return right.mtimeMs - left.mtimeMs;
}

/**
 * @param {{ connectedProviderAccountId: string | null, metadata: Record<string, unknown>, mtimeMs: number }} candidate
 * @param {string | null} normalizedProviderAccountId
 */
function scoreLinkedinEvidenceCandidate(candidate, normalizedProviderAccountId) {
  let score = 0;
  const normalizedCandidateProviderAccountId = normalizeNullableString(candidate.connectedProviderAccountId);
  if (normalizedProviderAccountId) {
    if (normalizedCandidateProviderAccountId === normalizedProviderAccountId) {
      score += 100;
    } else if (!normalizedCandidateProviderAccountId) {
      score += 10;
    } else {
      score -= 100;
    }
  }

  const premiumFeatureCount = Array.isArray(candidate.metadata?.premiumFeatures)
    ? candidate.metadata.premiumFeatures.length
    : 0;
  score += premiumFeatureCount * 20;
  if (candidate.metadata?.publicIdentifier) {
    score += 5;
  }
  if (candidate.metadata?.username) {
    score += 5;
  }
  if (candidate.metadata?.accountType) {
    score += 1;
  }
  return score;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeNullableString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {ReturnType<typeof buildResolvedAccount>} left
 * @param {ReturnType<typeof buildResolvedAccount>} right
 */
function compareResolvedAccounts(left, right) {
  if (left.status !== right.status) {
    return left.status === "ready" ? -1 : 1;
  }

  if (left.preferred !== right.preferred) {
    return left.preferred ? -1 : 1;
  }

  if (left.sourceType !== right.sourceType) {
    return left.sourceType === "harness-connection" ? -1 : 1;
  }

  return left.handle.localeCompare(right.handle);
}

/**
 * @param {ReturnType<typeof buildResolvedAccount>[]} matches
 * @param {string} capability
 * @param {string} userLabel
 */
function resolveManagedAccountResolution(matches, capability, userLabel) {
  const managedMatches = matches.filter((candidate) => candidate.sourceType === "harness-connection");
  if (!managedMatches.length) {
    return null;
  }

  const explicitMatches = managedMatches.filter((candidate) => Boolean(candidate.providerAccountId));
  const preferredExplicitMatches = explicitMatches.filter((candidate) => candidate.preferred);

  if (preferredExplicitMatches.length === 1) {
    return {
      resolved: preferredExplicitMatches[0],
      status: "resolved",
      reason: preferredExplicitMatches[0].reason,
      sourceType: "harness-connection"
    };
  }

  if (preferredExplicitMatches.length > 1) {
    return {
      resolved: null,
      status: "identity_ambiguous",
      reason: `Multiple preferred managed ${capability} accounts are mapped for ${userLabel}. Keep only one preferred exact account before launch.`,
      sourceType: "harness-connection"
    };
  }

  if (explicitMatches.length === 1) {
    return {
      resolved: explicitMatches[0],
      status: "resolved",
      reason: explicitMatches[0].reason,
      sourceType: "harness-connection"
    };
  }

  if (explicitMatches.length > 1) {
    return {
      resolved: null,
      status: "identity_ambiguous",
      reason: `Multiple managed ${capability} accounts are mapped for ${userLabel}. Select one exact external account before launch.`,
      sourceType: "harness-connection"
    };
  }

  if (managedMatches.length === 1) {
    const account = managedMatches[0];
    return {
      resolved: null,
      status: "identity_unresolved",
      reason: `Managed ${capability} account ${account.handle} exists for ${describeManagedConnector(account)}, but it is not assigned to one exact external account yet. Add providerAccountId or claim the discovered account before launch.`,
      sourceType: "harness-connection"
    };
  }

  return {
    resolved: null,
    status: "identity_unresolved",
    reason: `Managed ${capability} accounts exist for ${userLabel}, but none is assigned to one exact external account yet. Claim the discovered account before launch.`,
    sourceType: "harness-connection"
  };
}

/**
 * @param {ReturnType<typeof buildResolvedAccount>} account
 */
function describeManagedConnector(account) {
  const runtime = account.harnessConnection?.runtime ?? "unknown-runtime";
  const connector = account.harnessConnection?.connector ?? "unknown-connector";
  return `${runtime}:${connector}`;
}
