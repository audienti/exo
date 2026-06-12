// @ts-check

import fs from "node:fs";
import path from "node:path";
import { addUser } from "./add-user.js";
import { buildMotionIntake } from "./build-motion-intake.js";
import { buildUserIntake } from "./build-user-intake.js";
import { mapUserRuntimeAccounts } from "./map-user-runtime-accounts.js";
import {
  findUserById,
  findUserByLabel,
  insertUser,
  listBrowserProfiles,
  listCompanies,
  listMotions,
  listUsers,
  mutateUserById,
} from "../db/database.js";
import {
  getDefaultGlobalHomeStateDir,
  resolveStatePaths,
  writeWorkspaceStateConfig,
} from "../db/paths.js";

const ONBOARDING_SCOPE_OPTIONS = [
  {
    value: "local-folder",
    label: "Local folder",
    description: "Keep the governed Exo store inside this folder so the motion state travels with the project.",
  },
  {
    value: "global-install",
    label: "Global install",
    description: "Keep users and global policy in one shared home store, while this folder keeps its local motion state.",
  },
];

/**
 * @param {{
 *   rawUsers?: unknown[] | undefined,
 *   rawProfiles?: unknown[] | undefined,
 *   rawMotions?: unknown[] | undefined,
 *   rawCompanies?: unknown[] | undefined,
 *   preferredUserId?: string | null | undefined,
 *   motionInput?: Parameters<typeof buildMotionIntake>[0] | null | undefined,
 * }} [input]
 * @param {{ cwd?: string | null | undefined, env?: NodeJS.ProcessEnv | null | undefined }} [options]
 */
export function buildOnboardingState(input = {}, options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const rawUsers = input.rawUsers ?? listUsers();
  const rawProfiles = input.rawProfiles ?? listBrowserProfiles();
  const rawMotions = input.rawMotions ?? listMotions();
  const rawCompanies = input.rawCompanies ?? listCompanies();
  const statePaths = resolveStatePaths({ cwd, env });
  const scope = inferInstallScope({
    cwd,
    env,
    statePaths,
    motionCount: rawMotions.length,
    companyCount: rawCompanies.length,
    userCount: rawUsers.length,
  });
  const userIntake = buildUserIntake(
    { label: null },
    { rawUsers, rawProfiles },
  );
  const focusUser = resolveFocusUser(rawUsers, input.preferredUserId ?? null);
  const executionCapableCount = rawUsers.filter((user) => Array.isArray(user?.accounts) && user.accounts.length > 0).length;
  const motionIntake = buildMotionIntake(
    {
      url: input.motionInput?.url ?? null,
      premise: input.motionInput?.premise ?? null,
      audienceHypotheses: input.motionInput?.audienceHypotheses ?? [],
      signals: input.motionInput?.signals ?? [],
      targetingProfile: input.motionInput?.targetingProfile ?? {},
      suppressionPolicy: input.motionInput?.suppressionPolicy ?? {},
      launchUserId: focusUser?.id ?? null,
      existingStrategy: input.motionInput?.existingStrategy ?? null,
      sourceMotionId: input.motionInput?.sourceMotionId ?? null,
    },
    rawMotions,
  );
  const existingUsers = rawUsers.map((user) => ({
    id: String(user.id),
    label: String(user.label),
    accountCount: Array.isArray(user.accounts) ? user.accounts.length : 0,
  }));
  const status = scope.needsDecision
    ? "needs-scope"
    : rawUsers.length === 0
      ? "needs-user"
      : executionCapableCount === 0
        ? "needs-account-mapping"
        : rawMotions.length === 0
          ? "needs-motion"
          : "ready";
  const next = buildOnboardingNext({
    status,
    scope,
    userIntake,
    focusUser,
    motionIntake,
  });

  return {
    status,
    progress: {
      installScopeChosen: !scope.needsDecision,
      executionUserChosen: rawUsers.length > 0,
      executionAccountMapped: executionCapableCount > 0,
      firstMotionDefined: rawMotions.length > 0,
      readyForWorkspace: executionCapableCount > 0 && rawMotions.length > 0,
    },
    install: {
      ...scope,
      question: scope.needsDecision
        ? {
            key: "install-scope",
            prompt: "Should this folder keep its own Exo state, or attach to a shared global install?",
            options: ONBOARDING_SCOPE_OPTIONS.map((option) => ({
              ...option,
              localStateDir: statePaths.localStateDir,
              homeStateDir: option.value === "global-install" ? getDefaultGlobalHomeStateDir() : statePaths.localStateDir,
            })),
          }
        : null,
    },
    user: {
      focusUser,
      existingUsers,
      executionCapableCount,
      nextQuestion: status === "needs-user" ? userIntake.nextQuestion : null,
      discoveredSources: userIntake.discoveredSources,
    },
    motion: {
      intake: motionIntake,
      launchUserId: focusUser?.id ?? null,
    },
    next,
  };
}

/**
 * @param {{ scope: string }} input
 * @param {{ cwd?: string | null | undefined }} [options]
 */
export function applyInstallScope(input, options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const scope = normalizeInstallScope(input.scope);
  if (!scope) {
    throw new Error("Install scope must be local-folder or global-install.");
  }

  if (scope === "local-folder") {
    writeWorkspaceStateConfig({ installScope: "local-folder" }, { cwd });
  } else {
    writeWorkspaceStateConfig({
      installScope: "global-install",
      homeStateDir: getDefaultGlobalHomeStateDir(),
    }, { cwd });
  }

  ensureLocalStateIgnored(cwd);

  return {
    scope,
    statePaths: resolveStatePaths({ cwd }),
  };
}

/**
 * @param {{
 *   userId?: string | null | undefined,
 *   label?: string | null | undefined,
 *   owner?: string | null | undefined,
 *   runtime?: string | null | undefined,
 * }} input
 */
export function completeOnboardingUser(input) {
  const runtime = normalizeOptionalString(input.runtime) ?? "codex";
  const existingById = normalizeOptionalString(input.userId)
    ? findUserById(normalizeOptionalString(input.userId))
    : null;
  const existingByLabel = !existingById && normalizeOptionalString(input.label)
    ? findUserByLabel(normalizeOptionalString(input.label))
    : null;

  let user = existingById ?? existingByLabel;
  let created = false;

  if (!user) {
    const label = normalizeOptionalString(input.label);
    if (!label) {
      throw new Error("Onboarding user label is required.");
    }
    user = addUser({
      label,
      owner: normalizeOptionalString(input.owner),
      notes: null,
    });
    insertUser(user);
    created = true;
  }

  // Serialize the apply through mutateUserById so concurrent CLI-driven
  // claims against the same user cannot drop the LinkedIn or Gmail accounts
  // that onboarding has just mapped.
  const { result: mapping } = mutateUserById(user.id, (latestRaw) => {
    const next = mapUserRuntimeAccounts(latestRaw, {
      runtime,
      apply: true,
      preferManaged: true,
      codexHome: process.env.CODEX_HOME ?? null,
      claudeCli: process.env.EXO_CLAUDE_CLI ?? null,
    });
    return { user: next.updatedUser, result: next };
  });

  const mappedCount = mapping.counts.mappedCount + mapping.counts.alreadyMappedCount;
  return {
    created,
    user: mapping.updatedUser,
    runtime,
    mapping,
    warnings: Array.isArray(mapping.warnings) ? mapping.warnings : [],
    message: mappedCount > 0
      ? created
        ? `Registered ${mapping.updatedUser.label} and mapped managed account coverage.`
        : `Updated ${mapping.updatedUser.label} with managed account coverage.`
      : created
        ? `Registered ${mapping.updatedUser.label}. Managed account mapping still needs a real connected runtime.`
        : `Rechecked ${mapping.updatedUser.label}. Managed account mapping is still blocked.`,
  };
}

/**
 * @param {string} cwd
 */
function ensureLocalStateIgnored(cwd) {
  const gitignorePath = path.join(cwd, ".gitignore");
  const ignoreLine = ".exo/";
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  const lines = existing.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(ignoreLine)) {
    return;
  }

  const next = existing.length && !existing.endsWith("\n")
    ? `${existing}\n${ignoreLine}\n`
    : `${existing}${ignoreLine}\n`;
  fs.writeFileSync(gitignorePath, next, "utf8");
}

/**
 * @param {{
 *   cwd: string,
 *   env: NodeJS.ProcessEnv,
 *   statePaths: ReturnType<typeof resolveStatePaths>,
 *   motionCount: number,
 *   companyCount: number,
 *   userCount: number,
 * }} input
 */
function inferInstallScope(input) {
  const explicitHome = normalizeOptionalString(input.env.EXO_HOME_STATE_DIR);
  const explicitLocal = normalizeOptionalString(input.env.EXO_STATE_DIR);
  const workspaceConfig = input.statePaths.workspaceConfig ?? null;
  const persistedScope = resolvePersistedInstallScope(workspaceConfig, input.statePaths.localStateDir);
  const freshStore = input.motionCount === 0 && input.companyCount === 0 && input.userCount === 0;
  const needsDecision = freshStore && !explicitHome && !persistedScope;

  if (needsDecision) {
    return {
      choice: null,
      source: "unconfigured",
      needsDecision: true,
      layered: false,
      localStateDir: input.statePaths.localStateDir,
      homeStateDir: input.statePaths.homeStateDir,
      workspaceConfigPath: input.statePaths.workspaceConfigPath,
      globalHomeStateDir: getDefaultGlobalHomeStateDir(),
    };
  }

  if (input.statePaths.layered) {
    return {
      choice: "global-install",
      source: explicitHome ? "env:EXO_HOME_STATE_DIR" : persistedScope ? "workspace-config" : "inferred-layered",
      needsDecision: false,
      layered: true,
      localStateDir: input.statePaths.localStateDir,
      homeStateDir: input.statePaths.homeStateDir,
      workspaceConfigPath: input.statePaths.workspaceConfigPath,
      globalHomeStateDir: getDefaultGlobalHomeStateDir(),
    };
  }

  return {
    choice: "local-folder",
    source: persistedScope === "local-folder"
      ? "workspace-config"
      : explicitLocal
        ? "env:EXO_STATE_DIR"
        : "default-local",
    needsDecision: false,
    layered: false,
    localStateDir: input.statePaths.localStateDir,
    homeStateDir: input.statePaths.homeStateDir,
    workspaceConfigPath: input.statePaths.workspaceConfigPath,
    globalHomeStateDir: getDefaultGlobalHomeStateDir(),
  };
}

/**
 * @param {unknown[]} rawUsers
 * @param {string | null} preferredUserId
 */
function resolveFocusUser(rawUsers, preferredUserId) {
  /**
   * @param {any} user
   */
  const summarize = (user) => {
    const accounts = Array.isArray(user.accounts) ? user.accounts : [];
    const managedCapabilities = [...new Set(accounts
      .filter((account) => account?.sourceType === "harness-connection" && typeof account?.capability === "string")
      .map((account) => String(account.capability)))];
    const browserCapabilities = [...new Set(accounts
      .filter((account) => account?.sourceType === "browser-profile" && typeof account?.capability === "string")
      .map((account) => String(account.capability)))];

    return {
      id: String(user.id),
      label: String(user.label),
      accountCount: accounts.length,
      managedCapabilities,
      browserCapabilities,
    };
  };

  if (preferredUserId) {
    const matched = rawUsers.find((user) => String(user.id) === preferredUserId);
    if (matched) {
      return summarize(matched);
    }
  }

  const first = rawUsers[0] ?? null;
  if (!first) {
    return null;
  }

  return summarize(first);
}

/**
 * @param {{
 *   status: string,
 *   scope: ReturnType<typeof inferInstallScope>,
 *   userIntake: ReturnType<typeof buildUserIntake>,
 *   focusUser: { id: string, label: string, accountCount: number } | null,
 *   motionIntake: ReturnType<typeof buildMotionIntake>,
 * }} input
 */
function buildOnboardingNext(input) {
  if (input.status === "needs-scope") {
    return {
      headline: "Choose how this folder should hold Exo state before first-run setup.",
      prompt: "Is this a local folder workspace or a global install?",
      reason: "A true empty folder should not silently fall into one storage mode. Exo should make the install scope explicit before it creates durable governed state.",
      commands: [
        "exo onboarding --scope local-folder --apply --json",
        "exo onboarding --scope global-install --apply --json",
      ],
    };
  }

  if (input.status === "needs-user") {
    return {
      headline: "Register the first execution user for outreach.",
      prompt: input.userIntake.nextQuestion?.prompt ?? "Who is the first user we're managing in Exo?",
      reason: "Before the operator workspace, cadence, or inbound surfaces can mean anything, Exo needs the first governed execution identity.",
      commands: [
        "exo onboarding --label operator-main --apply --json",
        "exo users intake --json",
      ],
    };
  }

  if (input.status === "needs-account-mapping") {
    return {
      headline: `Map the first managed account onto ${input.focusUser?.label ?? "the existing execution user"}.`,
      prompt: "Which discovered runtime account should Exo treat as the first governed outreach identity?",
      reason: "Execution users exist, but none of them owns a governed connected account path yet. The workspace is still half-wired until a real managed account is mapped.",
      commands: [
        `exo onboarding --user ${input.focusUser?.id ?? "<user-id>"} --apply --json`,
        `exo users accounts map-runtime ${input.focusUser?.id ?? "<user-id>"} --runtime codex --apply --json`,
      ],
    };
  }

  if (input.status === "needs-motion") {
    return {
      headline: `Define the first motion for ${input.focusUser?.label ?? "the execution user"} and let Exo prepare the first pass.`,
      prompt: input.motionIntake.nextQuestion?.prompt ?? "What are we promoting first?",
      reason: "A governed execution identity exists now, but Exo still needs the first offer, premise, audience, and signals before it can prepare the operator workspace around real work.",
      commands: [
        "exo setup intake --message \"We need a new motion for https://example.com/product\" --json",
        `exo onboarding --user ${input.focusUser?.id ?? "<user-id>"} --url https://example.com/product --premise "This offer matters when ..." --audience "Primary ICP" --signal "company::Is there recent evidence that ...?" --apply --json`,
      ],
    };
  }

  return {
    headline: "Onboarding is complete.",
    prompt: "Open the live operator workspace and continue the governed path.",
    reason: "Exo has an execution-capable user and at least one governed motion, so it can serve the real workspace instead of the bootstrap flow.",
    commands: [
      "exo ui",
      "exo next --json",
    ],
  };
}

/**
 * @param {string | null | undefined} value
 */
function normalizeInstallScope(value) {
  const normalized = normalizeOptionalString(value)?.toLowerCase() ?? null;
  if (normalized === "local-folder" || normalized === "global-install") {
    return normalized;
  }
  return null;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeOptionalString(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {{ homeStateDir?: string | null | undefined, installScope?: string | null | undefined } | null} workspaceConfig
 * @param {string} localStateDir
 * @returns {"local-folder" | "global-install" | null}
 */
function resolvePersistedInstallScope(workspaceConfig, localStateDir) {
  if (!workspaceConfig) {
    return null;
  }

  if (workspaceConfig.installScope === "local-folder" || workspaceConfig.installScope === "global-install") {
    return workspaceConfig.installScope;
  }

  const persistedHome = normalizeOptionalString(workspaceConfig.homeStateDir);
  if (!persistedHome) {
    return null;
  }

  return path.resolve(persistedHome) === path.resolve(localStateDir)
    ? "local-folder"
    : "global-install";
}
