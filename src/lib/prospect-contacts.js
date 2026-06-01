// @ts-check

const EMAIL_KIND = "email";
const LINKEDIN_KIND = "linkedin_profile";
const LINKEDIN_PUBLIC_ID_KIND = "linkedin_public_id";
const LINKEDIN_MEMBER_ID_KIND = "linkedin_member_id";

/**
 * @param {{
 *   kind: string,
 *   value: string
 * }} point
 */
export function contactPointKey(point) {
  return `${point.kind}:${normalizeContactValue(point.kind, point.value)}`;
}

/**
 * @param {string} kind
 * @param {string} value
 */
export function normalizeContactValue(kind, value) {
  const normalized = value.toString().trim();
  if (!normalized) {
    return normalized;
  }

  if (
    kind === EMAIL_KIND
    || kind.endsWith("_profile")
    || kind === "website"
    || kind === LINKEDIN_PUBLIC_ID_KIND
    || kind === LINKEDIN_MEMBER_ID_KIND
  ) {
    return normalized.toLowerCase();
  }

  return normalized;
}

/**
 * @param {string | null | undefined} value
 */
export function extractLinkedinPublicId(value) {
  const normalized = value?.toString().trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match?.[1]) {
    return null;
  }

  return normalizeContactValue(LINKEDIN_PUBLIC_ID_KIND, match[1]);
}

/**
 * @param {string | null | undefined} value
 */
export function buildLinkedinProfileUrlFromPublicId(value) {
  const normalized = normalizeContactValue(LINKEDIN_PUBLIC_ID_KIND, value ?? "");
  if (!normalized) {
    return null;
  }

  return `https://www.linkedin.com/in/${normalized}/`;
}

/**
 * @param {{
 *   linkedinProfileUrl?: string | null,
 *   email?: string | null,
 *   sourceUrl?: string | null,
 *   observedAt?: string | null,
 *   profileViewedAt?: string | null,
 *   contactPoints?: Array<Record<string, any>>
 * }} prospect
 */
export function withDerivedProspectContacts(prospect) {
  const explicitPoints = (Array.isArray(prospect.contactPoints) ? prospect.contactPoints : [])
    .filter((point) => point?.source !== "legacy-email-field" && point?.source !== "legacy-linkedin-field");
  const legacyPoints = [];

  if (prospect.linkedinProfileUrl) {
    legacyPoints.push({
      id: `legacy-linkedin:${normalizeContactValue(LINKEDIN_KIND, prospect.linkedinProfileUrl)}`,
      kind: LINKEDIN_KIND,
      value: prospect.linkedinProfileUrl,
      label: "Primary LinkedIn profile",
      matchStatus: "same_person_verified",
      verificationStatus: "observed",
      confidence: "high",
      source: "legacy-linkedin-field",
      sourceUrl: prospect.sourceUrl ?? prospect.linkedinProfileUrl,
      observedAt: prospect.profileViewedAt ?? prospect.observedAt ?? null,
      notes: null,
      evidence: [],
      usableForOutreach: true,
      usableForResearch: true,
      usableForWarmup: true
    });
  }

  if (prospect.email) {
    legacyPoints.push({
      id: `legacy-email:${normalizeContactValue(EMAIL_KIND, prospect.email)}`,
      kind: EMAIL_KIND,
      value: prospect.email,
      label: "Stored direct email",
      matchStatus: "same_person_verified",
      verificationStatus: "verified",
      confidence: "high",
      source: "legacy-email-field",
      sourceUrl: prospect.sourceUrl ?? null,
      observedAt: prospect.observedAt ?? null,
      notes: null,
      evidence: [],
      usableForOutreach: true,
      usableForResearch: true,
      usableForWarmup: false
    });
  }

  const contactPoints = mergeContactPointLists(legacyPoints, explicitPoints);
  const bestEmail = selectBestEmailContactPoint({ ...prospect, contactPoints });
  const bestLinkedin = selectBestLinkedinContactPoint({ ...prospect, contactPoints });

  return {
    ...prospect,
    contactPoints,
    email: bestEmail?.value ?? prospect.email ?? null,
    linkedinProfileUrl: bestLinkedin?.value ?? prospect.linkedinProfileUrl ?? null
  };
}

/**
 * @param {Array<Record<string, any>> | undefined} existing
 * @param {Array<Record<string, any>> | undefined} additions
 */
export function mergeContactPointLists(existing = [], additions = []) {
  /** @type {Map<string, Record<string, any>>} */
  const merged = new Map();

  for (const point of existing) {
    if (!point || typeof point !== "object") continue;
    merged.set(contactPointKey(/** @type {{ kind: string, value: string }} */ (point)), { ...point });
  }

  for (const point of additions) {
    if (!point || typeof point !== "object") continue;
    const key = contactPointKey(/** @type {{ kind: string, value: string }} */ (point));
    const current = merged.get(key);
    merged.set(key, current ? mergeContactPoint(current, point) : { ...point });
  }

  return [...merged.values()];
}

/**
 * @param {Record<string, any>} existing
 * @param {Record<string, any>} next
 */
function mergeContactPoint(existing, next) {
  return {
    ...existing,
    ...next,
    id: next.id ?? existing.id,
    kind: next.kind ?? existing.kind,
    value: next.value ?? existing.value,
    label: next.label ?? existing.label ?? null,
    matchStatus: next.matchStatus ?? existing.matchStatus ?? "same_person_possible",
    verificationStatus: next.verificationStatus ?? existing.verificationStatus ?? "unknown",
    confidence: next.confidence ?? existing.confidence ?? "unknown",
    source: next.source ?? existing.source ?? null,
    sourceUrl: next.sourceUrl ?? existing.sourceUrl ?? null,
    observedAt: next.observedAt ?? existing.observedAt ?? null,
    notes: next.notes ?? existing.notes ?? null,
    evidence: mergeEvidenceLists(existing.evidence, next.evidence),
    usableForOutreach:
      next.usableForOutreach === undefined ? Boolean(existing.usableForOutreach) : Boolean(next.usableForOutreach),
    usableForResearch:
      next.usableForResearch === undefined ? Boolean(existing.usableForResearch) : Boolean(next.usableForResearch),
    usableForWarmup:
      next.usableForWarmup === undefined ? Boolean(existing.usableForWarmup) : Boolean(next.usableForWarmup)
  };
}

/**
 * @param {Array<Record<string, any>> | undefined} existing
 * @param {Array<Record<string, any>> | undefined} additions
 */
function mergeEvidenceLists(existing = [], additions = []) {
  /** @type {Map<string, Record<string, any>>} */
  const merged = new Map();

  for (const evidence of [...existing, ...additions]) {
    if (!evidence || typeof evidence !== "object") continue;
    const key = [
      evidence.type ?? "",
      evidence.summary ?? "",
      evidence.sourceUrl ?? "",
      evidence.observedAt ?? ""
    ].join("|");
    if (!merged.has(key)) {
      merged.set(key, { ...evidence });
    }
  }

  return [...merged.values()];
}

/**
 * @param {{
 *   email?: string | null,
 *   contactPoints?: Array<Record<string, any>>
 * }} prospect
 */
export function selectBestEmailContactPoint(prospect) {
  return (prospect.contactPoints ?? [])
    .filter((point) =>
      point.kind === EMAIL_KIND
      && point.matchStatus !== "rejected"
      && point.verificationStatus !== "rejected"
      && (point.usableForOutreach || point.verificationStatus === "verified" || point.verificationStatus === "observed")
    )
    .sort(compareContactPoints)[0] ?? null;
}

/**
 * @param {{
 *   linkedinProfileUrl?: string | null,
 *   contactPoints?: Array<Record<string, any>>
 * }} prospect
 */
export function selectBestLinkedinContactPoint(prospect) {
  return (prospect.contactPoints ?? [])
    .filter((point) =>
      point.kind === LINKEDIN_KIND
      && point.matchStatus !== "rejected"
      && point.verificationStatus !== "rejected"
    )
    .sort(compareContactPoints)[0] ?? null;
}

/**
 * @param {{
 *   contactPoints?: Array<Record<string, any>>
 * }} prospect
 */
export function hasUsableEmailFallback(prospect) {
  return Boolean(selectBestEmailContactPoint(prospect));
}

/**
 * @param {{
 *   contactEnrichmentState?: { status?: string | null }
 * }} prospect
 */
export function hasExhaustedEnrichmentState(prospect) {
  return prospect.contactEnrichmentState?.status === "exhausted";
}

/**
 * @param {Record<string, any>} left
 * @param {Record<string, any>} right
 */
function compareContactPoints(left, right) {
  return (
    compareScore(Boolean(right.usableForOutreach), Boolean(left.usableForOutreach))
    || compareScore(Boolean(right.usableForResearch), Boolean(left.usableForResearch))
    || compareScore(verificationRank(right.verificationStatus), verificationRank(left.verificationStatus))
    || compareScore(matchRank(right.matchStatus), matchRank(left.matchStatus))
    || compareScore(confidenceRank(right.confidence), confidenceRank(left.confidence))
    || compareIsoDates(right.observedAt, left.observedAt)
  );
}

/**
 * @param {string | null | undefined} value
 */
function verificationRank(value) {
  switch (value) {
    case "verified":
      return 4;
    case "observed":
      return 3;
    case "inferred":
      return 2;
    case "unknown":
      return 1;
    default:
      return 0;
  }
}

/**
 * @param {string | null | undefined} value
 */
function matchRank(value) {
  switch (value) {
    case "same_person_verified":
      return 4;
    case "same_person_probable":
      return 3;
    case "same_person_possible":
      return 2;
    default:
      return 0;
  }
}

/**
 * @param {string | null | undefined} value
 */
function confidenceRank(value) {
  switch (value) {
    case "high":
      return 4;
    case "moderate":
      return 3;
    case "low":
      return 2;
    case "unknown":
      return 1;
    default:
      return 0;
  }
}

/**
 * @param {number | boolean} left
 * @param {number | boolean} right
 */
function compareScore(left, right) {
  return Number(left) - Number(right);
}

/**
 * @param {string | null | undefined} left
 * @param {string | null | undefined} right
 */
function compareIsoDates(left, right) {
  const leftTime = left ? Date.parse(left) : 0;
  const rightTime = right ? Date.parse(right) : 0;
  return leftTime - rightTime;
}
