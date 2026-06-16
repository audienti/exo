// @ts-check

import { escapeAttr, escapeHtml } from "../lib/exo-ui-components.js";

/**
 * @param {string[] | null | undefined} accountRefs
 * @param {string} capability
 */
export function findExplicitCapabilityAccountRef(accountRefs, capability) {
  const prefix = `${capability}:`;
  return (accountRefs ?? []).find((ref) => typeof ref === "string" && ref.startsWith(prefix)) ?? null;
}

/**
 * @param {{ gmailOptions?: Array<{ ref?: string | null, handle?: string | null, label?: string | null }> | null } | null | undefined} user
 * @param {{ accountRefs?: string[] | null } | null | undefined} assignment
 */
export function buildExactGmailPickerModel(user, assignment) {
  const selectedRef = findExplicitCapabilityAccountRef(assignment?.accountRefs ?? [], "gmail");
  const seen = new Set();
  const options = [];

  for (const option of user?.gmailOptions ?? []) {
    const ref = normalizeNonEmptyString(option?.ref);
    if (!ref || seen.has(ref)) {
      continue;
    }
    seen.add(ref);
    options.push({
      ref,
      handle: normalizeNonEmptyString(option?.handle) ?? ref.slice("gmail:".length),
      label: normalizeNonEmptyString(option?.label) ?? normalizeNonEmptyString(option?.handle) ?? ref.slice("gmail:".length),
    });
  }

  return {
    options,
    selectedRef,
    showPicker: options.length > 1 || Boolean(selectedRef),
  };
}

/**
 * @param {{
 *   options: Array<{ ref: string, handle: string, label: string }>,
 *   selectedRef: string | null,
 *   showPicker: boolean,
 * }} picker
 * @param {{ helper: string, name?: string, emptyLabel?: string }} input
 */
export function renderExactGmailPicker(picker, input) {
  if (!picker.showPicker) {
    return "";
  }

  const fieldName = normalizeNonEmptyString(input.name) ?? "accountRef";
  const emptyLabel = normalizeNonEmptyString(input.emptyLabel) ?? "No exact Gmail inbox pinned";
  const options = [
    `<option value="">${escapeHtml(emptyLabel)}</option>`,
    ...picker.options.map((option) => {
      const selected = picker.selectedRef === option.ref ? " selected" : "";
      return `<option value="${escapeAttr(option.ref)}"${selected}>${escapeHtml(option.label)}</option>`;
    }),
  ].join("");

  return (
    `<label class="compose-field">` +
    `<span class="compose-label">Exact Gmail inbox</span>` +
    `<p class="premise-note">${escapeHtml(input.helper)}</p>` +
    `<select class="compose-input" name="${escapeAttr(fieldName)}">${options}</select>` +
    `</label>`
  );
}

/**
 * @param {string | null | undefined} value
 */
function normalizeNonEmptyString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}
