// @ts-check

import { getLocalDatabase } from "./database.js";
import {
  NORMALIZED_SCHEMA_VERSION,
  createEntityId,
  normalizeLowerString,
  normalizeOptionalString,
  parsePayload,
  toPayloadJson,
} from "./normalized-utils.js";

/**
 * @param {{
 *   id?: string,
 *   name: string,
 *   domain?: string | null,
 *   linkedinCompanyUrl?: string | null,
 *   websiteUrl?: string | null,
 *   now?: string
 * }} input
 */
export function findOrCreateCompany(input) {
  const database = getLocalDatabase();
  const now = input.now ?? new Date().toISOString();
  const identity = normalizeCompanyIdentity(input);
  const existing = (input.id ? findCompanyRowById(input.id) : null) ?? findCompanyRowByIdentity(identity);

  if (existing) {
    const company = companyFromRow(existing);
    const updated = {
      ...company,
      name: company.name || input.name,
      domain: company.domain ?? identity.domain,
      linkedinCompanyUrl: company.linkedinCompanyUrl ?? identity.linkedinCompanyUrl,
      websiteUrl: company.websiteUrl ?? identity.websiteUrl,
      updatedAt: now,
    };
    persistCompany(updated);
    return updated;
  }

  const company = {
    id: input.id ?? createEntityId("company"),
    name: normalizeOptionalString(input.name) ?? "Unnamed company",
    domain: identity.domain,
    linkedinCompanyUrl: identity.linkedinCompanyUrl,
    websiteUrl: identity.websiteUrl,
    createdAt: now,
    updatedAt: now,
  };

  database.prepare(`
    INSERT INTO companies (
      id,
      name,
      search_name,
      domain,
      linkedin_company_url,
      website_url,
      schema_version,
      created_at,
      updated_at,
      payload_json
    )
    VALUES (
      @id,
      @name,
      @searchName,
      @domain,
      @linkedinCompanyUrl,
      @websiteUrl,
      @schemaVersion,
      @createdAt,
      @updatedAt,
      @payloadJson
    )
  `).run({
    id: company.id,
    name: company.name,
    searchName: company.name.toLowerCase(),
    domain: company.domain,
    linkedinCompanyUrl: company.linkedinCompanyUrl,
    websiteUrl: company.websiteUrl,
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
    payloadJson: toPayloadJson(company),
  });

  return company;
}

/**
 * @param {string} id
 */
export function findNormalizedCompanyById(id) {
  const row = getLocalDatabase()
    .prepare("SELECT * FROM companies WHERE id = ?")
    .get(id);
  return row ? companyFromRow(row) : null;
}

/**
 * @param {{ domain: string | null, linkedinCompanyUrl: string | null }} identity
 */
function findCompanyRowByIdentity(identity) {
  if (identity.domain) {
    const row = getLocalDatabase()
      .prepare("SELECT * FROM companies WHERE domain = ? LIMIT 1")
      .get(identity.domain);
    if (row) return row;
  }

  if (identity.linkedinCompanyUrl) {
    return getLocalDatabase()
      .prepare("SELECT * FROM companies WHERE linkedin_company_url = ? LIMIT 1")
      .get(identity.linkedinCompanyUrl);
  }

  return null;
}

/**
 * @param {string} id
 */
function findCompanyRowById(id) {
  return getLocalDatabase()
    .prepare("SELECT * FROM companies WHERE id = ? LIMIT 1")
    .get(id);
}

/**
 * @param {{
 *   name: string,
 *   domain?: string | null,
 *   linkedinCompanyUrl?: string | null,
 *   websiteUrl?: string | null
 * }} input
 */
function normalizeCompanyIdentity(input) {
  const websiteUrl = normalizeWebsiteUrl(input.websiteUrl ?? null);
  return {
    domain: normalizeDomain(input.domain ?? null) ?? normalizeDomain(websiteUrl),
    linkedinCompanyUrl: normalizeLinkedinCompanyUrl(input.linkedinCompanyUrl ?? null),
    websiteUrl,
  };
}

/**
 * @param {string | null | undefined} value
 */
export function normalizeDomain(value) {
  const raw = normalizeOptionalString(value);
  if (!raw) return null;
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    return stripWww(url.hostname.toLowerCase());
  } catch {
    return stripWww(raw.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase());
  }
}

/**
 * @param {string | null | undefined} value
 */
export function normalizeWebsiteUrl(value) {
  const raw = normalizeOptionalString(value);
  if (!raw) return null;
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * @param {string | null | undefined} value
 */
export function normalizeLinkedinCompanyUrl(value) {
  const raw = normalizeOptionalString(value);
  if (!raw) return null;
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`https://www.linkedin.com/company/${raw}`);
    const parts = url.pathname.split("/").filter(Boolean);
    const companyIndex = parts.findIndex((part) => part.toLowerCase() === "company");
    const slug = companyIndex >= 0 ? parts[companyIndex + 1] : parts[0];
    if (!slug) return null;
    return `https://www.linkedin.com/company/${decodeURIComponent(slug).toLowerCase()}/`;
  } catch {
    return `https://www.linkedin.com/company/${raw.toLowerCase()}/`;
  }
}

/**
 * @param {string} value
 */
function stripWww(value) {
  return value.replace(/^www\./, "");
}

/**
 * @param {any} row
 */
function companyFromRow(row) {
  const payload = parsePayload(row);
  return {
    ...payload,
    id: row.id,
    name: row.name,
    domain: row.domain ?? null,
    linkedinCompanyUrl: row.linkedin_company_url ?? null,
    websiteUrl: row.website_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {{
 *   id: string,
 *   name: string,
 *   domain: string | null,
 *   linkedinCompanyUrl: string | null,
 *   websiteUrl: string | null,
 *   createdAt: string,
 *   updatedAt: string
 * }} company
 */
function persistCompany(company) {
  getLocalDatabase().prepare(`
    UPDATE companies
    SET name = @name,
        search_name = @searchName,
        domain = @domain,
        linkedin_company_url = @linkedinCompanyUrl,
        website_url = @websiteUrl,
        schema_version = @schemaVersion,
        updated_at = @updatedAt,
        payload_json = @payloadJson
    WHERE id = @id
  `).run({
    id: company.id,
    name: company.name,
    searchName: normalizeLowerString(company.name),
    domain: company.domain,
    linkedinCompanyUrl: company.linkedinCompanyUrl,
    websiteUrl: company.websiteUrl,
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    updatedAt: company.updatedAt,
    payloadJson: toPayloadJson(company),
  });
}
