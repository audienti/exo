// @ts-check

import { domainToASCII } from "node:url";

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
 * @param {string} rawValue
 * @returns {{ exact: string, canonicalVariant: string, role: boolean } | null}
 */
export function normalizeEmailAddress(rawValue) {
  let value = String(rawValue ?? "").trim().replace(/^mailto:/i, "");
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
 * @param {string | null | undefined} value
 * @returns {string[]}
 */
export function buildEmailIdentityValues(value) {
  if (!value) return [];
  const email = normalizeEmailAddress(value);
  if (!email) return [];
  const values = [email.exact];
  if (!email.role && email.canonicalVariant !== email.exact) {
    values.push(email.canonicalVariant);
  }
  return [...new Set(values)];
}

/**
 * @param {string} local
 * @param {string} domain
 */
function buildEmailVariant(local, domain) {
  if (domain !== "gmail.com" && domain !== "googlemail.com") return `${local}@${domain}`;
  return `${local.split("+")[0].replace(/\./g, "")}@gmail.com`;
}
