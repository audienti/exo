// @ts-check

import { domainToASCII } from "node:url";
import { getLocalDatabase } from "./database.js";
import {
  NORMALIZED_SCHEMA_VERSION,
  createEntityId,
  fromSqlBoolean,
  normalizeOptionalString,
  parsePayload,
  toPayloadJson,
} from "./normalized-utils.js";

const ROLE_MAILBOX_LOCAL_PARTS = new Set([
  "admin",
  "billing",
  "contact",
  "hello",
  "info",
  "office",
  "sales",
  "support",
  "team",
]);

/**
 * @typedef {{
 *   kind: string,
 *   value: string,
 *   verificationStatus?: "verified" | "observed" | "inferred" | "rejected" | "unknown",
 *   confidence?: number | null,
 *   source?: string | null,
 *   observedAt?: string | null
 * }} RawContactPoint
 */

/**
 * @param {string} kind
 * @param {string} rawValue
 */
export function normalizeContactValue(kind, rawValue) {
  const normalizedKind = kind.trim().toLowerCase();
  if (normalizedKind === "email") return normalizeEmail(rawValue)?.exact ?? null;

  if (normalizedKind === "linkedin_profile_url" || normalizedKind === "linkedin_profile" || normalizedKind === "linkedin_public_id") {
    return extractLinkedinIdentifiers(rawValue).publicId;
  }

  if (normalizedKind === "linkedin_sales_url" || normalizedKind === "linkedin_member_id") {
    return extractLinkedinIdentifiers(rawValue).memberId ?? normalizeOpaqueLinkedinId(rawValue);
  }

  return normalizeOptionalString(rawValue);
}

/**
 * @param {{
 *   name: string,
 *   contactPoints: RawContactPoint[],
 *   now?: string,
 *   id?: string
 * }} input
 */
export function resolvePersonIdentity(input) {
  const database = getLocalDatabase();
  const now = input.now ?? new Date().toISOString();
  const points = normalizeContactPoints(input.contactPoints);
  const memberId = firstValue(points, "linkedin_member_id");
  const publicId = firstValue(points, "linkedin_public_id");
  const mergeEmail = firstMergeGradeEmail(points);

  const matched = findPersonCandidate({ memberId, publicId, email: mergeEmail?.value ?? null });
  if (!matched) {
    const person = insertPerson({
      id: input.id ?? createEntityId("person"),
      name: input.name,
      linkedinMemberId: memberId,
      linkedinPublicId: publicId,
      primaryEmail: mergeEmail?.value ?? null,
      now,
    });
    const storedPoints = storeContactPoints(person.id, points, {
      mergeEmail: mergeEmail?.value ?? null,
      reviewOnly: false,
      now,
    });
    return {
      person,
      created: true,
      matchedBy: null,
      reviewRequired: storedPoints.some((point) => point.matchStatus !== "same_person_verified"),
      reviewContactPoints: storedPoints.filter((point) => point.matchStatus !== "same_person_verified"),
    };
  }

  const candidate = matched.person;
  const reviewPoints = [];
  const updates = {
    linkedinMemberId: candidate.linkedinMemberId,
    linkedinPublicId: candidate.linkedinPublicId,
    primaryEmail: candidate.primaryEmail,
  };

  if (memberId) {
    if (!candidate.linkedinMemberId) {
      updates.linkedinMemberId = memberId;
    } else if (candidate.linkedinMemberId !== memberId && matched.matchedBy !== "linkedin_member_id") {
      reviewPoints.push(toStoredContactPoint(candidate.id, {
        kind: "linkedin_member_id",
        value: memberId,
        verificationStatus: "observed",
        matchStatus: "same_person_possible",
        now,
      }));
    }
  }

  if (publicId) {
    if (!candidate.linkedinPublicId) {
      updates.linkedinPublicId = publicId;
    } else if (candidate.linkedinPublicId !== publicId && matched.matchedBy === "linkedin_member_id") {
      storeContactPoint(candidate.id, {
        kind: "linkedin_public_id",
        value: candidate.linkedinPublicId,
        verificationStatus: "observed",
        matchStatus: "same_person_verified",
        now,
      });
      updates.linkedinPublicId = publicId;
    } else if (candidate.linkedinPublicId !== publicId) {
      reviewPoints.push(toStoredContactPoint(candidate.id, {
        kind: "linkedin_public_id",
        value: publicId,
        verificationStatus: "observed",
        matchStatus: "same_person_possible",
        now,
      }));
    }
  }

  if (mergeEmail?.value) {
    if (!candidate.primaryEmail) {
      updates.primaryEmail = mergeEmail.value;
    } else if (candidate.primaryEmail !== mergeEmail.value) {
      reviewPoints.push(toStoredContactPoint(candidate.id, {
        kind: "email",
        value: mergeEmail.value,
        verificationStatus: mergeEmail.verificationStatus,
        matchStatus: "same_person_possible",
        confidence: mergeEmail.confidence,
        now,
      }));
    }
  }

  const updated = updatePersonIdentity(candidate, updates, now);
  const storedPoints = storeContactPoints(updated.id, points, {
    mergeEmail: mergeEmail?.value ?? null,
    reviewOnly: false,
    now,
  });
  for (const point of reviewPoints) {
    storeContactPoint(updated.id, point);
  }

  const reviewContactPoints = [
    ...storedPoints.filter((point) => point.matchStatus !== "same_person_verified"),
    ...reviewPoints,
  ];

  return {
    person: updated,
    created: false,
    matchedBy: matched.matchedBy,
    reviewRequired: reviewContactPoints.length > 0,
    reviewContactPoints,
  };
}

/**
 * @param {string} personId
 */
export function findPersonById(personId) {
  const row = getLocalDatabase()
    .prepare("SELECT * FROM people WHERE id = ?")
    .get(personId);
  return row ? personFromRow(row) : null;
}

/**
 * @param {string} personId
 */
export function listContactPointsForPerson(personId) {
  return getLocalDatabase()
    .prepare(`
      SELECT *
      FROM contact_points
      WHERE person_id = ?
      ORDER BY created_at ASC
    `)
    .all(personId)
    .map(contactPointFromRow);
}

/**
 * @param {{
 *   personId: string,
 *   companyId: string,
 *   title?: string | null,
 *   source: string,
 *   observedAt?: string | null,
 *   now?: string
 * }} input
 */
export function upsertEmployment(input) {
  const database = getLocalDatabase();
  const now = input.now ?? new Date().toISOString();
  const observedAt = input.observedAt ?? now;

  database.prepare(`
    UPDATE employments
    SET is_current = 0,
        ended_observed_at = @observedAt,
        updated_at = @now
    WHERE person_id = @personId
      AND company_id != @companyId
      AND is_current = 1
  `).run({
    personId: input.personId,
    companyId: input.companyId,
    observedAt,
    now,
  });

  const existing = database
    .prepare("SELECT * FROM employments WHERE person_id = @personId AND company_id = @companyId")
    .get({
      personId: input.personId,
      companyId: input.companyId,
    });

  if (existing) {
    database.prepare(`
      UPDATE employments
      SET title = @title,
          is_current = 1,
          source = @source,
          observed_at = @observedAt,
          ended_observed_at = NULL,
          schema_version = @schemaVersion,
          updated_at = @now,
          payload_json = @payloadJson
      WHERE id = @id
    `).run({
      id: existing.id,
      title: input.title ?? null,
      source: input.source,
      observedAt,
      schemaVersion: NORMALIZED_SCHEMA_VERSION,
      now,
      payloadJson: toPayloadJson({
        id: existing.id,
        personId: input.personId,
        companyId: input.companyId,
        title: input.title ?? null,
        source: input.source,
        observedAt,
      }),
    });
    return employmentFromRow(database.prepare("SELECT * FROM employments WHERE id = ?").get(existing.id));
  }

  const employment = {
    id: createEntityId("employment"),
    personId: input.personId,
    companyId: input.companyId,
    title: input.title ?? null,
    isCurrent: true,
    source: input.source,
    observedAt,
    endedObservedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  database.prepare(`
    INSERT INTO employments (
      id,
      person_id,
      company_id,
      title,
      is_current,
      source,
      observed_at,
      ended_observed_at,
      schema_version,
      created_at,
      updated_at,
      payload_json
    )
    VALUES (
      @id,
      @personId,
      @companyId,
      @title,
      1,
      @source,
      @observedAt,
      NULL,
      @schemaVersion,
      @createdAt,
      @updatedAt,
      @payloadJson
    )
  `).run({
    id: employment.id,
    personId: employment.personId,
    companyId: employment.companyId,
    title: employment.title,
    source: employment.source,
    observedAt: employment.observedAt,
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    createdAt: employment.createdAt,
    updatedAt: employment.updatedAt,
    payloadJson: toPayloadJson(employment),
  });
  return employment;
}

/**
 * @param {string} personId
 */
export function selectPrimaryEmployment(personId) {
  const row = getLocalDatabase()
    .prepare(`
      SELECT *
      FROM employments
      WHERE person_id = ?
        AND is_current = 1
      ORDER BY observed_at DESC, updated_at DESC
      LIMIT 1
    `)
    .get(personId);
  return row ? employmentFromRow(row) : null;
}

/**
 * @param {RawContactPoint[]} rawPoints
 */
function normalizeContactPoints(rawPoints) {
  return rawPoints.flatMap((point) => {
    const kind = point.kind.trim().toLowerCase();
    if (kind.startsWith("linkedin_")) {
      const ids = extractLinkedinIdentifiers(point.value);
      const points = [];
      if (ids.memberId) {
        points.push(normalizedPoint(point, "linkedin_member_id", ids.memberId));
      }
      if (ids.publicId) {
        points.push(normalizedPoint(point, "linkedin_public_id", ids.publicId));
      }
      return points;
    }

    const value = normalizeContactValue(kind, point.value);
    if (!value) return [];
    return [normalizedPoint(point, kind, value)];
  });
}

/**
 * @param {RawContactPoint} point
 * @param {string} kind
 * @param {string} value
 */
function normalizedPoint(point, kind, value) {
  const email = kind === "email" ? normalizeEmail(value) : null;
  return {
    kind,
    value,
    verificationStatus: point.verificationStatus ?? "observed",
    confidence: point.confidence ?? null,
    source: point.source ?? null,
    observedAt: point.observedAt ?? null,
    mergeGrade: kind === "email" ? isMergeGradeEmail(email, point) : true,
    emailRole: email?.role ?? false,
  };
}

/**
 * @param {ReturnType<typeof normalizeContactPoints>} points
 * @param {string} kind
 */
function firstValue(points, kind) {
  return points.find((point) => point.kind === kind)?.value ?? null;
}

/**
 * @param {ReturnType<typeof normalizeContactPoints>} points
 */
function firstMergeGradeEmail(points) {
  return points.find((point) => point.kind === "email" && point.mergeGrade) ?? null;
}

/**
 * @param {{ memberId: string | null, publicId: string | null, email: string | null }} input
 */
function findPersonCandidate(input) {
  if (input.memberId) {
    const person = findPersonByColumnOrContactPoint("linkedin_member_id", input.memberId);
    if (person) return { person, matchedBy: "linkedin_member_id" };
  }

  if (input.publicId) {
    const person = findPersonByColumnOrContactPoint("linkedin_public_id", input.publicId);
    if (person) return { person, matchedBy: "linkedin_public_id" };
  }

  if (input.email) {
    const person = findPersonByColumnOrContactPoint("primary_email", input.email);
    if (person) return { person, matchedBy: "email" };
  }

  return null;
}

/**
 * @param {"linkedin_member_id" | "linkedin_public_id" | "primary_email"} column
 * @param {string} value
 */
function findPersonByColumnOrContactPoint(column, value) {
  const database = getLocalDatabase();
  const direct = database
    .prepare(`SELECT * FROM people WHERE ${column} = ? LIMIT 1`)
    .get(value);
  if (direct) return personFromRow(direct);

  const contactKind = column === "primary_email" ? "email" : column;
  const contact = database
    .prepare(`
      SELECT people.*
      FROM contact_points
      JOIN people ON people.id = contact_points.person_id
      WHERE contact_points.kind = @kind
        AND contact_points.value = @value
        AND contact_points.match_status IN ('same_person_verified', 'same_person_probable')
      LIMIT 1
    `)
    .get({ kind: contactKind, value });
  return contact ? personFromRow(contact) : null;
}

/**
 * @param {{
 *   id: string,
 *   name: string,
 *   linkedinMemberId: string | null,
 *   linkedinPublicId: string | null,
 *   primaryEmail: string | null,
 *   now: string
 * }} input
 */
function insertPerson(input) {
  const person = {
    id: input.id,
    name: input.name.trim(),
    linkedinMemberId: input.linkedinMemberId,
    linkedinPublicId: input.linkedinPublicId,
    primaryEmail: input.primaryEmail,
    createdAt: input.now,
    updatedAt: input.now,
  };
  getLocalDatabase().prepare(`
    INSERT INTO people (
      id,
      name,
      linkedin_member_id,
      linkedin_public_id,
      primary_email,
      schema_version,
      created_at,
      updated_at,
      payload_json
    )
    VALUES (
      @id,
      @name,
      @linkedinMemberId,
      @linkedinPublicId,
      @primaryEmail,
      @schemaVersion,
      @createdAt,
      @updatedAt,
      @payloadJson
    )
  `).run({
    id: person.id,
    name: person.name,
    linkedinMemberId: person.linkedinMemberId,
    linkedinPublicId: person.linkedinPublicId,
    primaryEmail: person.primaryEmail,
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    createdAt: person.createdAt,
    updatedAt: person.updatedAt,
    payloadJson: toPayloadJson(person),
  });
  return person;
}

/**
 * @param {ReturnType<typeof personFromRow>} person
 * @param {{ linkedinMemberId: string | null, linkedinPublicId: string | null, primaryEmail: string | null }} updates
 * @param {string} now
 */
function updatePersonIdentity(person, updates, now) {
  const updated = {
    ...person,
    linkedinMemberId: updates.linkedinMemberId,
    linkedinPublicId: updates.linkedinPublicId,
    primaryEmail: updates.primaryEmail,
    updatedAt: now,
  };
  getLocalDatabase().prepare(`
    UPDATE people
    SET linkedin_member_id = @linkedinMemberId,
        linkedin_public_id = @linkedinPublicId,
        primary_email = @primaryEmail,
        schema_version = @schemaVersion,
        updated_at = @updatedAt,
        payload_json = @payloadJson
    WHERE id = @id
  `).run({
    id: updated.id,
    linkedinMemberId: updated.linkedinMemberId,
    linkedinPublicId: updated.linkedinPublicId,
    primaryEmail: updated.primaryEmail,
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    updatedAt: updated.updatedAt,
    payloadJson: toPayloadJson(updated),
  });
  return updated;
}

/**
 * @param {string} personId
 * @param {ReturnType<typeof normalizeContactPoints>} points
 * @param {{ mergeEmail: string | null, reviewOnly: boolean, now: string }} options
 */
function storeContactPoints(personId, points, options) {
  return points.map((point) => {
    const matchStatus = point.kind === "email" && point.value !== options.mergeEmail
      ? "same_person_possible"
      : "same_person_verified";
    return storeContactPoint(personId, {
      ...point,
      matchStatus,
      now: options.now,
    });
  });
}

/**
 * @param {string} personId
 * @param {{
 *   kind: string,
 *   value: string,
 *   verificationStatus?: string,
 *   matchStatus: string,
 *   confidence?: number | null,
 *   source?: string | null,
 *   observedAt?: string | null,
 *   now?: string
 * }} point
 */
function storeContactPoint(personId, point) {
  const stored = toStoredContactPoint(personId, point);
  getLocalDatabase().prepare(`
    INSERT INTO contact_points (
      id,
      person_id,
      kind,
      value,
      verification_status,
      match_status,
      confidence,
      source,
      observed_at,
      schema_version,
      created_at,
      updated_at,
      payload_json
    )
    VALUES (
      @id,
      @personId,
      @kind,
      @value,
      @verificationStatus,
      @matchStatus,
      @confidence,
      @source,
      @observedAt,
      @schemaVersion,
      @createdAt,
      @updatedAt,
      @payloadJson
    )
    ON CONFLICT(kind, value) DO UPDATE SET
      verification_status = excluded.verification_status,
      match_status = CASE
        WHEN contact_points.person_id = excluded.person_id THEN excluded.match_status
        ELSE contact_points.match_status
      END,
      confidence = excluded.confidence,
      source = excluded.source,
      observed_at = excluded.observed_at,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run({
    id: stored.id,
    personId: stored.personId,
    kind: stored.kind,
    value: stored.value,
    verificationStatus: stored.verificationStatus,
    matchStatus: stored.matchStatus,
    confidence: stored.confidence,
    source: stored.source,
    observedAt: stored.observedAt,
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    payloadJson: toPayloadJson(stored),
  });
  return stored;
}

/**
 * @param {string} personId
 * @param {{
 *   kind: string,
 *   value: string,
 *   verificationStatus?: string,
 *   matchStatus: string,
 *   confidence?: number | null,
 *   source?: string | null,
 *   observedAt?: string | null,
 *   now?: string
 * }} point
 */
function toStoredContactPoint(personId, point) {
  const now = point.now ?? new Date().toISOString();
  return {
    id: createEntityId("contact"),
    personId,
    kind: point.kind,
    value: point.value,
    verificationStatus: point.verificationStatus ?? "observed",
    matchStatus: point.matchStatus,
    confidence: point.confidence ?? null,
    source: point.source ?? null,
    observedAt: point.observedAt ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * @param {string} rawValue
 */
function extractLinkedinIdentifiers(rawValue) {
  const raw = normalizeOptionalString(rawValue);
  if (!raw) return { memberId: null, publicId: null };
  const decoded = decodeOne(raw);
  const urnId = extractLinkedinIdFromUrn(decoded);
  if (urnId) return { memberId: normalizeOpaqueLinkedinId(urnId), publicId: extractPublicIdFromUrl(decoded) };

  try {
    const url = decoded.includes("://") ? new URL(decoded) : null;
    if (url) {
      const minedUrn = url.searchParams.get("miniProfileUrn") ?? url.searchParams.get("profileUrn");
      const minedId = minedUrn ? extractLinkedinIdFromUrn(decodeOne(minedUrn)) : null;
      const salesId = extractSalesNavigatorId(url);
      return {
        memberId: normalizeOpaqueLinkedinId(minedId ?? salesId ?? ""),
        publicId: extractPublicIdFromUrl(decoded),
      };
    }
  } catch {
    // Fall through to raw identifier normalization.
  }

  return {
    memberId: looksLikeMemberId(decoded) ? normalizeOpaqueLinkedinId(decoded) : null,
    publicId: looksLikeMemberId(decoded) ? null : normalizePublicSlug(decoded),
  };
}

/**
 * @param {string} value
 */
function extractLinkedinIdFromUrn(value) {
  const match = value.match(/urn:li:[^:]+:([^/?#]+)/i);
  return match?.[1] ?? null;
}

/**
 * @param {URL} url
 */
function extractSalesNavigatorId(url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const salesIndex = parts.findIndex((part) => part.toLowerCase() === "sales");
  const type = salesIndex >= 0 ? parts[salesIndex + 1]?.toLowerCase() : null;
  if (type !== "lead" && type !== "people") return null;
  return parts[salesIndex + 2]?.split(",")[0] ?? null;
}

/**
 * @param {string} value
 */
function extractPublicIdFromUrl(value) {
  try {
    const url = value.includes("://") ? new URL(value) : null;
    if (!url || !url.hostname.toLowerCase().endsWith("linkedin.com")) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const inIndex = parts.findIndex((part) => part.toLowerCase() === "in");
    return inIndex >= 0 ? normalizePublicSlug(parts[inIndex + 1] ?? "") : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} value
 */
function normalizeOpaqueLinkedinId(value) {
  const normalized = stripCopiedUrlLeakage(stripLeadingGlyphs(decodeOne(value).trim()));
  return looksLikeMemberId(normalized) ? normalized : null;
}

/**
 * @param {string} value
 */
function normalizePublicSlug(value) {
  const normalized = stripCopiedUrlLeakage(stripLeadingGlyphs(decodeOne(value).trim()));
  return normalized ? normalized.toLowerCase() : null;
}

/**
 * @param {string} value
 */
function stripCopiedUrlLeakage(value) {
  return value.replace(/(%5c|%2f|[\\/])+$/i, "");
}

/**
 * @param {string} value
 */
function stripLeadingGlyphs(value) {
  return value.replace(/^[^\p{L}\p{N}]+/u, "");
}

/**
 * @param {string} value
 */
function decodeOne(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * @param {string} value
 */
function looksLikeMemberId(value) {
  return /^AC[A-Za-z0-9_-]{8,}/.test(value);
}

/**
 * @param {string} rawValue
 */
function normalizeEmail(rawValue) {
  let value = rawValue.trim().replace(/^mailto:/i, "");
  const angle = value.match(/<([^>]+)>/);
  if (angle) value = angle[1];
  value = value.replace(/^["']|["']$/g, "").replace(/[>),.;\s]+$/g, "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return null;
  const local = value.slice(0, at);
  const domain = domainToASCII(value.slice(at + 1));
  if (!domain) return null;
  const exact = `${local}@${domain}`;
  return {
    exact,
    canonicalVariant: buildEmailVariant(local, domain),
    role: ROLE_MAILBOX_LOCAL_PARTS.has(local),
  };
}

/**
 * @param {string} local
 * @param {string} domain
 */
function buildEmailVariant(local, domain) {
  if (domain !== "gmail.com" && domain !== "googlemail.com") return `${local}@${domain}`;
  return `${local.split("+")[0].replace(/\./g, "")}@gmail.com`;
}

/**
 * @param {ReturnType<typeof normalizeEmail>} email
 * @param {RawContactPoint} point
 */
function isMergeGradeEmail(email, point) {
  if (!email || email.role) return false;
  if ((point.verificationStatus ?? "observed") === "inferred") return false;
  if (typeof point.confidence === "number" && point.confidence < 0.7) return false;
  return email.exact === email.canonicalVariant;
}

/**
 * @param {any} row
 */
function personFromRow(row) {
  const payload = parsePayload(row);
  return {
    ...payload,
    id: row.id,
    name: row.name,
    linkedinMemberId: row.linkedin_member_id ?? null,
    linkedinPublicId: row.linkedin_public_id ?? null,
    primaryEmail: row.primary_email ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {any} row
 */
function contactPointFromRow(row) {
  const payload = parsePayload(row);
  return {
    ...payload,
    id: row.id,
    personId: row.person_id,
    kind: row.kind,
    value: row.value,
    verificationStatus: row.verification_status,
    matchStatus: row.match_status,
    confidence: row.confidence ?? null,
    source: row.source ?? null,
    observedAt: row.observed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {any} row
 */
function employmentFromRow(row) {
  const payload = parsePayload(row);
  return {
    ...payload,
    id: row.id,
    personId: row.person_id,
    companyId: row.company_id,
    title: row.title ?? null,
    isCurrent: fromSqlBoolean(row.is_current),
    source: row.source,
    observedAt: row.observed_at ?? null,
    endedObservedAt: row.ended_observed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
