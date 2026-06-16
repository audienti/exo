// @ts-check

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {string[] | null | undefined} rawAccountRefs
 */
export function resolveAssignmentAccountRefs(user, rawAccountRefs) {
  const availableRefs = buildAvailableAssignmentRefs(user);
  const defaultRefsByCapability = buildDefaultAssignmentRefsByCapability(user);
  const providedRefs = (rawAccountRefs ?? [])
    .map((value) => normalizeNullableString(value))
    .filter(Boolean);

  /** @type {Map<string, string>} */
  const explicitRefsByCapability = new Map();

  for (const ref of providedRefs) {
    const capability = availableRefs.get(ref);
    if (!capability) {
      throw new Error(`User ${user.label} does not have a connected account for ${ref}.`);
    }

    const existing = explicitRefsByCapability.get(capability);
    if (existing && existing !== ref) {
      throw new Error(
        `User ${user.label} has multiple ${capability} account refs on one assignment. Keep only one exact ${capability} account per assignment.`,
      );
    }

    explicitRefsByCapability.set(capability, ref);
  }

  const refs = [];
  for (const [capability, ref] of defaultRefsByCapability.entries()) {
    if (!explicitRefsByCapability.has(capability)) {
      refs.push(ref);
    }
  }
  for (const ref of explicitRefsByCapability.values()) {
    refs.push(ref);
  }

  return refs;
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 */
function buildAvailableAssignmentRefs(user) {
  /** @type {Map<string, string>} */
  const refs = new Map();
  for (const account of user.accounts) {
    const ref = buildAccountRef(account.capability, account.handle);
    if (!refs.has(ref)) {
      refs.set(ref, account.capability);
    }
  }
  return refs;
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 */
function buildDefaultAssignmentRefsByCapability(user) {
  /** @type {Map<string, Set<string>>} */
  const refsByCapability = new Map();

  for (const account of user.accounts) {
    const ref = buildAccountRef(account.capability, account.handle);
    const refs = refsByCapability.get(account.capability) ?? new Set();
    refs.add(ref);
    refsByCapability.set(account.capability, refs);
  }

  /** @type {Map<string, string>} */
  const defaults = new Map();
  for (const [capability, refs] of refsByCapability.entries()) {
    if (refs.size !== 1) {
      continue;
    }

    const [ref] = refs;
    defaults.set(capability, ref);
  }
  return defaults;
}

/**
 * @param {string} capability
 * @param {string} handle
 */
function buildAccountRef(capability, handle) {
  return `${capability}:${handle}`;
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function normalizeNullableString(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}
