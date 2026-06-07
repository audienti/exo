// @ts-check

import fs from "node:fs";
import { readWorkspaceSettings, resolveWorkspaceEnrichmentPolicy } from "./workspace-settings.js";

const GUIDANCE_CACHE = new Map();

/**
 * @param {string} key
 * @param {Record<string, string | null | undefined>} [context]
 */
export function buildPlannerGuidance(key, context = {}) {
  const normalizedKey = normalizePlannerGuidanceKey(key);
  const relativePath = `docs/planner/${normalizedKey}.md`;
  const template = loadPlannerGuidance(relativePath);
  const promptSource = applyWorkspaceGuidancePolicy(
    normalizedKey,
    template.body || fallbackTaskPrompt(normalizedKey, context),
  );

  return {
    key: normalizedKey,
    docPath: relativePath,
    taskPrompt: interpolate(promptSource, context),
    principles: template.principles.map((item) => interpolate(item, context)),
    do: template.do.map((item) => interpolate(item, context)),
    avoid: template.avoid.map((item) => interpolate(item, context)),
    writeback: template.writeback.map((item) => interpolate(item, context))
  };
}

/**
 * @param {string} key
 * @param {string} promptSource
 */
function applyWorkspaceGuidancePolicy(key, promptSource) {
  if (key !== "find_contact_points") {
    return promptSource;
  }

  const policy = resolveWorkspaceEnrichmentPolicy(readWorkspaceSettings());
  const emailProviders = policy.email.providers.length
    ? policy.email.providers.join(", ")
    : "none";
  const validators = policy.email.validators.length
    ? policy.email.validators.join(", ")
    : "none";
  const phoneProviders = policy.phone.providers.length
    ? policy.phone.providers.join(", ")
    : "none";
  const phoneRules = [
    policy.phone.mobileOnly ? "mobile-only" : "not mobile-only",
    policy.phone.preferWhatsappCapable ? "prefer WhatsApp-capable evidence when a provider can prove it" : "do not prefer WhatsApp-capable evidence",
  ].join("; ");

  return [
    promptSource.trim(),
    `Workspace enrichment policy. The direct email provider order for this workspace is ${emailProviders}. The validation providers enabled for direct email are ${validators}. The direct phone provider order for this workspace is ${phoneProviders}. Phone rules: ${phoneRules}. Follow this workspace policy when choosing provider paths.`,
  ].join("\n\n");
}

/**
 * @param {string} value
 */
export function normalizePlannerGuidanceKey(value) {
  return value.toString().trim().toLowerCase();
}

/**
 * @param {string} relativePath
 */
function loadPlannerGuidance(relativePath) {
  if (GUIDANCE_CACHE.has(relativePath)) {
    return clonePlannerGuidance(GUIDANCE_CACHE.get(relativePath));
  }

  const fileUrl = new URL(`../../${relativePath}`, import.meta.url);

  if (!fs.existsSync(fileUrl)) {
    const empty = emptyPlannerGuidance();
    GUIDANCE_CACHE.set(relativePath, empty);
    return clonePlannerGuidance(empty);
  }

  const raw = fs.readFileSync(fileUrl, "utf8");
  const parsed = parsePlannerGuidance(raw);
  GUIDANCE_CACHE.set(relativePath, parsed);
  return clonePlannerGuidance(parsed);
}

function emptyPlannerGuidance() {
  return {
    principles: [],
    do: [],
    avoid: [],
    writeback: [],
    body: ""
  };
}

/**
 * @param {{ principles: string[], do: string[], avoid: string[], writeback: string[], body: string }} guidance
 */
function clonePlannerGuidance(guidance) {
  return {
    principles: [...guidance.principles],
    do: [...guidance.do],
    avoid: [...guidance.avoid],
    writeback: [...guidance.writeback],
    body: guidance.body
  };
}

/**
 * @param {string} raw
 */
function parsePlannerGuidance(raw) {
  const parsed = emptyPlannerGuidance();
  const lines = raw.split(/\r?\n/);

  if (lines[0]?.trim() !== "---") {
    parsed.body = raw.trim();
    return parsed;
  }

  /** @type {keyof Omit<typeof parsed, "body"> | null} */
  let currentKey = null;
  let index = 1;

  for (; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trim() === "---") {
      index += 1;
      break;
    }

    const keyMatch = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*$/);
    if (keyMatch) {
      const key = keyMatch[1];
      currentKey = key in parsed && key !== "body"
        ? /** @type {keyof Omit<typeof parsed, "body">} */ (key)
        : null;
      continue;
    }

    const itemMatch = line.match(/^\s*-\s+(.*)$/);
    if (itemMatch && currentKey) {
      parsed[currentKey].push(itemMatch[1].trim());
    }
  }

  parsed.body = lines.slice(index).join("\n").trim();
  return parsed;
}

/**
 * @param {string} template
 * @param {Record<string, string | null | undefined>} context
 */
function interpolate(template, context) {
  return template
    .replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key) => context[key] ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * @param {string} key
 * @param {Record<string, string | null | undefined>} context
 */
function fallbackTaskPrompt(key, context) {
  const target = context.prospectName
    ? `${context.prospectName}${context.companyName ? ` at ${context.companyName}` : ""}`
    : context.companyName ?? context.motionName ?? "the current governed path";

  return `Carry out the planner action "${key}" for ${target}. Use the stored Exo state as context, inspect the live surface that matters now, and write the resulting state change back into Exo when you are done.`;
}
