// @ts-check

import crypto from "node:crypto";

/**
 * Deterministic JSON serialization: object keys are sorted recursively so the
 * same logical value always produces the same string regardless of insertion
 * order. Used for contract-repair input/failure/contract hashing.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
  const seen = new WeakSet();

  /** @param {unknown} node @returns {string} */
  const serialize = (node) => {
    if (node === null || node === undefined) {
      return "null";
    }
    const nodeType = typeof node;
    if (nodeType === "number" || nodeType === "boolean") {
      return JSON.stringify(node);
    }
    if (nodeType === "string") {
      return JSON.stringify(node);
    }
    if (nodeType === "bigint" || nodeType === "function" || nodeType === "symbol") {
      throw new TypeError(`stableStringify cannot serialize a ${nodeType}`);
    }
    if (Array.isArray(node)) {
      if (seen.has(node)) {
        throw new TypeError("stableStringify cannot serialize a circular structure");
      }
      seen.add(node);
      const body = node.map((entry) => serialize(entry)).join(",");
      seen.delete(node);
      return `[${body}]`;
    }
    if (seen.has(/** @type {object} */ (node))) {
      throw new TypeError("stableStringify cannot serialize a circular structure");
    }
    seen.add(/** @type {object} */ (node));
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (node))
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${serialize(entryValue)}`);
    seen.delete(/** @type {object} */ (node));
    return `{${entries.join(",")}}`;
  };

  return serialize(value);
}

/**
 * @param {string} text
 * @returns {string}
 */
export function sha256Hex(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function hashJsonStable(value) {
  return sha256Hex(stableStringify(value));
}
