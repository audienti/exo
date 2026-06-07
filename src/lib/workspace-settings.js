// @ts-check

import fs from "node:fs";
import path from "node:path";

export const WORKSPACE_SETTINGS_FILENAME = "exo.toml";
export const WORKSPACE_DIRECT_EMAIL_PROVIDER_ORDER = Object.freeze([
  "icypeas",
  "leadmagic",
  "prospeo",
  "findymail",
]);
export const WORKSPACE_EMAIL_VALIDATOR_ORDER = Object.freeze([
  "zerobounce",
]);
export const WORKSPACE_DIRECT_PHONE_PROVIDER_ORDER = Object.freeze([
  "icypeas",
  "leadmagic",
  "prospeo",
]);
export const WORKSPACE_ENRICHMENT_PROVIDER_CATALOG = Object.freeze([
  {
    key: "icypeas",
    label: "Icypeas",
    description: "Direct email and mobile enrichment provider.",
    lanes: ["email", "phone"],
  },
  {
    key: "leadmagic",
    label: "LeadMagic",
    description: "Direct email and mobile enrichment provider.",
    lanes: ["email", "phone"],
  },
  {
    key: "prospeo",
    label: "Prospeo",
    description: "Direct email and mobile enrichment provider.",
    lanes: ["email", "phone"],
  },
  {
    key: "findymail",
    label: "Findymail",
    description: "Direct email enrichment provider.",
    lanes: ["email"],
  },
  {
    key: "zerobounce",
    label: "Zerobounce",
    description: "Validation-only provider for direct-email checks.",
    lanes: ["validation"],
  },
]);

const DEFAULT_WORKSPACE_ENRICHMENT_POLICY = Object.freeze({
  email: {
    providers: [...WORKSPACE_DIRECT_EMAIL_PROVIDER_ORDER],
    validators: [...WORKSPACE_EMAIL_VALIDATOR_ORDER],
  },
  phone: {
    providers: [...WORKSPACE_DIRECT_PHONE_PROVIDER_ORDER],
    mobileOnly: true,
    preferWhatsappCapable: true,
  },
});

/**
 * @param {{ cwd?: string | null | undefined }} [options]
 */
export function readWorkspaceSettings(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const settingsPath = path.join(cwd, WORKSPACE_SETTINGS_FILENAME);

  if (!fs.existsSync(settingsPath)) {
    return buildWorkspaceSettingsResult({
      cwd,
      path: settingsPath,
      exists: false,
      raw: {},
    });
  }

  const raw = fs.readFileSync(settingsPath, "utf8");
  return buildWorkspaceSettingsResult({
    cwd,
    path: settingsPath,
    exists: true,
    raw: parseSimpleToml(raw),
  });
}

/**
 * @param {ReturnType<typeof readWorkspaceSettings> | null | undefined} settings
 */
export function resolveWorkspaceLinkedinConnectionRequestTarget(settings) {
  const value = settings?.workspace?.targets?.linkedin?.connectionRequestsPerDay ?? null;
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * @param {ReturnType<typeof readWorkspaceSettings> | null | undefined} settings
 */
export function resolveWorkspaceEnrichmentPolicy(settings) {
  return settings?.workspace?.enrichment ?? cloneJson(DEFAULT_WORKSPACE_ENRICHMENT_POLICY);
}

/**
 * @param {{
 *   cwd?: string | null | undefined,
 *   lane: "email" | "phone" | "validation",
 *   provider: string,
 *   enabled: boolean
 * }} input
 */
export function toggleWorkspaceEnrichmentProvider(input) {
  const settings = readWorkspaceSettings({ cwd: input.cwd ?? null });
  const policy = resolveWorkspaceEnrichmentPolicy(settings);
  const provider = normalizeProviderKey(input.provider);
  const enabled = Boolean(input.enabled);

  if (input.lane === "validation") {
    const validators = enabled
      ? addOrderedValue(policy.email.validators, provider, WORKSPACE_EMAIL_VALIDATOR_ORDER)
      : removeOrderedValue(policy.email.validators, provider);
    return writeWorkspaceSettings({
      cwd: settings.cwd,
      raw: mergeWorkspaceSettingsRaw(settings.raw, {
        enrichment: {
          email: {
            providers: policy.email.providers,
            validators,
          },
          phone: policy.phone,
        },
      }),
    });
  }

  const allowedOrder = input.lane === "email"
    ? WORKSPACE_DIRECT_EMAIL_PROVIDER_ORDER
    : WORKSPACE_DIRECT_PHONE_PROVIDER_ORDER;
  const current = input.lane === "email" ? policy.email.providers : policy.phone.providers;
  const updated = enabled
    ? addOrderedValue(current, provider, allowedOrder)
    : removeOrderedValue(current, provider);

  return writeWorkspaceSettings({
    cwd: settings.cwd,
    raw: mergeWorkspaceSettingsRaw(settings.raw, {
      enrichment: {
        email: {
          providers: input.lane === "email" ? updated : policy.email.providers,
          validators: policy.email.validators,
        },
        phone: {
          providers: input.lane === "phone" ? updated : policy.phone.providers,
          mobileOnly: policy.phone.mobileOnly,
          preferWhatsappCapable: policy.phone.preferWhatsappCapable,
        },
      },
    }),
  });
}

/**
 * @param {{
 *   cwd?: string | null | undefined,
 *   mobileOnly?: boolean | null | undefined,
 *   preferWhatsappCapable?: boolean | null | undefined
 * }} input
 */
export function updateWorkspacePhoneEnrichmentPolicy(input) {
  const settings = readWorkspaceSettings({ cwd: input.cwd ?? null });
  const policy = resolveWorkspaceEnrichmentPolicy(settings);
  const nextPhone = {
    providers: [...policy.phone.providers],
    mobileOnly:
      input.mobileOnly === undefined || input.mobileOnly === null
        ? policy.phone.mobileOnly
        : Boolean(input.mobileOnly),
    preferWhatsappCapable:
      input.preferWhatsappCapable === undefined || input.preferWhatsappCapable === null
        ? policy.phone.preferWhatsappCapable
        : Boolean(input.preferWhatsappCapable),
  };

  return writeWorkspaceSettings({
    cwd: settings.cwd,
    raw: mergeWorkspaceSettingsRaw(settings.raw, {
      enrichment: {
        email: policy.email,
        phone: nextPhone,
      },
    }),
  });
}

/**
 * @param {{ cwd: string, raw: Record<string, any> }} input
 */
export function writeWorkspaceSettings(input) {
  const cwd = path.resolve(input.cwd);
  const settingsPath = path.join(cwd, WORKSPACE_SETTINGS_FILENAME);
  const raw = cloneJson(input.raw ?? {});
  const serialized = serializeSimpleToml(raw);
  fs.writeFileSync(settingsPath, serialized, "utf8");
  return readWorkspaceSettings({ cwd });
}

/**
 * @param {{
 *   cwd: string,
 *   path: string,
 *   exists: boolean,
 *   raw: Record<string, any>
 * }} input
 */
function buildWorkspaceSettingsResult(input) {
  const connectionRequestsPerDay = normalizePositiveInteger(
    input.raw?.workspace?.targets?.linkedin?.connection_requests_per_day,
  );
  const rawEmailProviders = getNestedValue(input.raw, ["workspace", "enrichment", "email", "providers"]);
  const rawValidators = getNestedValue(input.raw, ["workspace", "enrichment", "email", "validators"]);
  const rawPhoneProviders = getNestedValue(input.raw, ["workspace", "enrichment", "phone", "providers"]);
  const rawMobileOnly = getNestedValue(input.raw, ["workspace", "enrichment", "phone", "mobile_only"]);
  const rawPreferWhatsapp = getNestedValue(input.raw, ["workspace", "enrichment", "phone", "prefer_whatsapp_capable"]);

  return {
    cwd: input.cwd,
    path: input.path,
    exists: input.exists,
    raw: cloneJson(input.raw ?? {}),
    workspace: {
      targets: {
        linkedin: {
          connectionRequestsPerDay,
        },
      },
      enrichment: {
        email: {
          providers: normalizeProviderList(rawEmailProviders, WORKSPACE_DIRECT_EMAIL_PROVIDER_ORDER),
          validators: normalizeProviderList(rawValidators, WORKSPACE_EMAIL_VALIDATOR_ORDER),
        },
        phone: {
          providers: normalizeProviderList(rawPhoneProviders, WORKSPACE_DIRECT_PHONE_PROVIDER_ORDER),
          mobileOnly: normalizeBoolean(rawMobileOnly, DEFAULT_WORKSPACE_ENRICHMENT_POLICY.phone.mobileOnly),
          preferWhatsappCapable: normalizeBoolean(
            rawPreferWhatsapp,
            DEFAULT_WORKSPACE_ENRICHMENT_POLICY.phone.preferWhatsappCapable,
          ),
        },
      },
    },
  };
}

/**
 * Minimal TOML parser for Exo workspace settings.
 * Supports dotted table headers and scalar string/boolean/integer values.
 *
 * @param {string} raw
 */
function parseSimpleToml(raw) {
  const root = {};
  let currentPath = [];

  for (const sourceLine of raw.split(/\r?\n/)) {
    const line = stripComments(sourceLine).trim();
    if (!line) {
      continue;
    }

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentPath = sectionMatch[1]
        .split(".")
        .map((part) => part.trim())
        .filter(Boolean);
      ensurePath(root, currentPath);
      continue;
    }

    const keyValueMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!keyValueMatch) {
      continue;
    }

    const [, rawKey, rawValue] = keyValueMatch;
    const target = ensurePath(root, currentPath);
    target[rawKey] = parseTomlValue(rawValue.trim());
  }

  return root;
}

/**
 * @param {string} line
 */
function stripComments(line) {
  let inQuote = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\\" && inQuote && !escaped) {
      escaped = true;
      continue;
    }
    if (character === "\"" && !escaped) {
      inQuote = !inQuote;
      continue;
    }
    if (character === "#" && !inQuote) {
      return line.slice(0, index);
    }
    escaped = false;
  }

  return line;
}

/**
 * @param {Record<string, any>} root
 * @param {string[]} pathParts
 */
function ensurePath(root, pathParts) {
  let cursor = root;

  for (const part of pathParts) {
    if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }

  return cursor;
}

/**
 * @param {string} rawValue
 */
function parseTomlValue(rawValue) {
  if (/^\[.*\]$/.test(rawValue)) {
    return parseTomlArray(rawValue);
  }
  return parseTomlScalar(rawValue);
}

/**
 * @param {string} rawValue
 */
function parseTomlScalar(rawValue) {
  if (/^".*"$/.test(rawValue)) {
    return rawValue.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }

  if (/^(true|false)$/i.test(rawValue)) {
    return rawValue.toLowerCase() === "true";
  }

  if (/^[+-]?\d+$/.test(rawValue)) {
    return Number.parseInt(rawValue, 10);
  }

  return rawValue;
}

/**
 * @param {unknown} value
 */
function normalizePositiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? Number(value) : null;
}

/**
 * @param {unknown} value
 * @param {boolean} fallback
 */
function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * @param {unknown} value
 * @param {readonly string[]} fallback
 */
function normalizeProviderList(value, fallback) {
  if (Array.isArray(value)) {
    return dedupeStringList(value);
  }
  return [...fallback];
}

/**
 * @param {unknown[]} value
 */
function dedupeStringList(value) {
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const normalized = normalizeProviderKey(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/**
 * @param {unknown} value
 */
function normalizeProviderKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * @param {string[]} current
 * @param {string} nextValue
 * @param {readonly string[]} preferredOrder
 */
function addOrderedValue(current, nextValue, preferredOrder) {
  const allowed = new Set(preferredOrder.map((value) => value.toLowerCase()));
  if (!allowed.has(nextValue)) {
    throw new Error(`Unsupported enrichment provider: ${nextValue}`);
  }
  const merged = new Set([...current, nextValue]);
  return preferredOrder.filter((value) => merged.has(value));
}

/**
 * @param {string[]} current
 * @param {string} value
 */
function removeOrderedValue(current, value) {
  return current.filter((item) => item !== value);
}

/**
 * @param {Record<string, any>} raw
 * @param {{
 *   enrichment: {
 *     email: { providers: string[], validators: string[] },
 *     phone: { providers: string[], mobileOnly: boolean, preferWhatsappCapable: boolean }
 *   }
 * }} input
 */
function mergeWorkspaceSettingsRaw(raw, input) {
  const next = cloneJson(raw ?? {});
  const workspace = ensurePath(next, ["workspace"]);
  const enrichment = ensurePath(workspace, ["enrichment"]);
  const email = ensurePath(enrichment, ["email"]);
  const phone = ensurePath(enrichment, ["phone"]);

  email.providers = [...input.enrichment.email.providers];
  email.validators = [...input.enrichment.email.validators];
  phone.providers = [...input.enrichment.phone.providers];
  phone.mobile_only = Boolean(input.enrichment.phone.mobileOnly);
  phone.prefer_whatsapp_capable = Boolean(input.enrichment.phone.preferWhatsappCapable);

  return next;
}

/**
 * @param {Record<string, any>} raw
 */
function serializeSimpleToml(raw) {
  const lines = [];
  const scalars = [];
  const tables = [];

  for (const key of Object.keys(raw ?? {})) {
    const value = raw[key];
    if (isPlainObject(value)) {
      tables.push([key, value]);
    } else {
      scalars.push([key, value]);
    }
  }

  for (const [key, value] of scalars) {
    lines.push(`${key} = ${serializeTomlValue(value)}`);
  }
  if (scalars.length && tables.length) {
    lines.push("");
  }

  tables.forEach(([key, value], index) => {
    lines.push(...serializeTomlTable([key], value));
    if (index < tables.length - 1) {
      lines.push("");
    }
  });

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

/**
 * @param {string[]} pathParts
 * @param {Record<string, any>} table
 */
function serializeTomlTable(pathParts, table) {
  const lines = [`[${pathParts.join(".")}]`];
  const scalars = [];
  const children = [];

  for (const key of Object.keys(table ?? {})) {
    const value = table[key];
    if (isPlainObject(value)) {
      children.push([key, value]);
    } else {
      scalars.push([key, value]);
    }
  }

  for (const [key, value] of scalars) {
    lines.push(`${key} = ${serializeTomlValue(value)}`);
  }

  children.forEach(([key, value]) => {
    lines.push("");
    lines.push(...serializeTomlTable([...pathParts, key], value));
  });

  return lines;
}

/**
 * @param {unknown} value
 */
function serializeTomlValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeTomlValue(item)).join(", ")}]`;
  }
  if (typeof value === "string") {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}`;
  }
  return "\"\"";
}

/**
 * @param {string} rawValue
 */
function parseTomlArray(rawValue) {
  const inner = rawValue.slice(1, -1).trim();
  if (!inner) {
    return [];
  }

  const out = [];
  let current = "";
  let inQuote = false;
  let escaped = false;

  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index];
    if (character === "\\" && inQuote && !escaped) {
      current += character;
      escaped = true;
      continue;
    }
    if (character === "\"" && !escaped) {
      inQuote = !inQuote;
      current += character;
      continue;
    }
    if (character === "," && !inQuote) {
      out.push(parseTomlScalar(current.trim()));
      current = "";
      escaped = false;
      continue;
    }
    current += character;
    escaped = false;
  }

  if (current.trim()) {
    out.push(parseTomlScalar(current.trim()));
  }

  return out;
}

/**
 * @param {unknown} value
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

/**
 * @param {Record<string, any>} root
 * @param {string[]} pathParts
 */
function getNestedValue(root, pathParts) {
  let cursor = root;
  for (const part of pathParts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || !(part in cursor)) {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}
