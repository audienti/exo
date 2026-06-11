// @ts-check

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildAgentQueue } from "../core/build-agent-queue.js";
import { probeRuntimeConnectorAvailability } from "../core/probe-user-harness-connections.js";
import { BROWSER_TRANSPORT_TASK_KINDS } from "./agent-host-state.js";
import {
  listBrowserProfiles,
  listCompanies,
  listInboundCues,
  listInboundObservations,
  listMotions,
  listUsers,
} from "../db/database.js";

/**
 * @param {{ stateDir: string, codexHome: string }} input
 */
export function buildPreflightSummary(input) {
  const queue = buildAgentQueue({
    motions: listMotions(),
    companies: listCompanies(),
    profiles: listBrowserProfiles(),
    users: listUsers(),
    observations: listInboundObservations(),
    cues: listInboundCues(),
  });
  const draftTaskCount = queue.tasks.filter((task) => task.kind === "write_draft").length;
  const browserTasks = queue.tasks.filter((task) => BROWSER_TRANSPORT_TASK_KINDS.has(task.kind));
  const browserTaskCount = browserTasks.length;
  const checkedAt = new Date().toISOString();

  if (!browserTaskCount) {
    return {
      checkedAt,
      stateDir: input.stateDir,
      codexHome: input.codexHome,
      queue: {
        dueTaskCount: queue.tasks.length,
        waitingTaskCount: queue.waiting.length,
        blockerCount: (queue.blockers ?? []).length,
        draftTaskCount,
        browserTaskCount,
        browserTaskKinds: [],
      },
      browser: {
        required: false,
        ready: true,
        skipReason: "no_browser_tasks_due",
        blockedReasons: [],
      },
    };
  }

  const connectorProbe = probeRuntimeConnectorAvailability("codex", "chrome", {
    codexHome: input.codexHome,
  });
  const chromePluginRoot = resolveChromePluginRoot(input.codexHome);
  const checks = {
    chromeRunning: chromePluginRoot
      ? runNodeJson(path.join(chromePluginRoot, "scripts", "chrome-is-running.js"), ["--json"])
      : null,
    extensionInstalled: chromePluginRoot
      ? runNodeJson(path.join(chromePluginRoot, "scripts", "check-extension-installed.js"), ["--json"])
      : null,
    nativeHostManifest: chromePluginRoot
      ? runNodeJson(path.join(chromePluginRoot, "scripts", "check-native-host-manifest.js"), ["--json"])
      : null,
  };
  const chromeAppInstances = inspectChromeAppInstances();

  const blockedReasons = [];
  const warnings = [];
  if (connectorProbe.detectedStatus !== "available") {
    blockedReasons.push(connectorProbe.reason);
  }
  if (!chromePluginRoot) {
    blockedReasons.push(`Could not resolve the bundled Codex Chrome plugin under ${path.join(input.codexHome, "plugins", "cache", "openai-bundled", "chrome")}.`);
  }
  if (checks.chromeRunning?.ok === false) {
    blockedReasons.push(checks.chromeRunning.error);
  } else if (!checks.chromeRunning?.result?.running) {
    blockedReasons.push("Google Chrome is not running for the selected user session.");
  }
  if (checks.extensionInstalled?.ok === false) {
    blockedReasons.push(checks.extensionInstalled.error);
  } else if (!checks.extensionInstalled?.result?.enabled) {
    const selectedProfile = checks.extensionInstalled?.result?.selectedProfileDirectory ?? "selected Chrome profile";
    blockedReasons.push(`The Codex Chrome Extension is not enabled in ${selectedProfile}.`);
  }
  if (checks.nativeHostManifest?.ok === false) {
    blockedReasons.push(checks.nativeHostManifest.error);
  } else if (!checks.nativeHostManifest?.result?.correct) {
    blockedReasons.push(checks.nativeHostManifest?.result?.problem ?? "The Codex Chrome native host manifest is missing or invalid.");
  }
  if (chromeAppInstances.conflictingUserDataDirInstances.length) {
    warnings.push(`Additional Chrome app instance(s) are running with custom user-data-dir values: ${chromeAppInstances.conflictingUserDataDirInstances.map((instance) => `pid ${instance.pid}`).join(", ")}.`);
  }
  if (chromeAppInstances.instances.length > 1) {
    warnings.push(`Multiple Google Chrome app instances are running (${chromeAppInstances.instances.length} total). Detached Codex Chrome attach can become unstable in this state.`);
  }

  return {
    checkedAt,
    stateDir: input.stateDir,
    codexHome: input.codexHome,
    queue: {
      dueTaskCount: queue.tasks.length,
      waitingTaskCount: queue.waiting.length,
      blockerCount: (queue.blockers ?? []).length,
      draftTaskCount,
      browserTaskCount,
      browserTaskKinds: browserTasks.map((task) => task.kind),
    },
    browser: {
      required: true,
      ready: blockedReasons.length === 0,
      skipReason: null,
      blockedReasons,
      warnings,
      taskReadiness: buildBrowserTaskReadiness({
        blockedReasons,
        chromeAppInstances,
      }),
      connectorProbe,
      pluginRoot: chromePluginRoot,
      chromeRunning: checks.chromeRunning,
      extensionInstalled: checks.extensionInstalled,
      nativeHostManifest: checks.nativeHostManifest,
      chromeAppInstances,
    },
  };
}

function buildBrowserTaskReadiness(input) {
  const baseBlockedReasons = Array.isArray(input.blockedReasons)
    ? input.blockedReasons.filter((reason) => typeof reason === "string" && reason.trim().length)
    : [];

  const retrievalBlockedReasons = [...baseBlockedReasons];
  const sendBlockedReasons = [...baseBlockedReasons];
  const maintenanceBlockedReasons = [...baseBlockedReasons];
  return {
    run_inbound_sync: {
      ready: retrievalBlockedReasons.length === 0,
      blockedReasons: retrievalBlockedReasons,
    },
    company_research: {
      ready: retrievalBlockedReasons.length === 0,
      blockedReasons: retrievalBlockedReasons,
    },
    send_message: {
      ready: sendBlockedReasons.length === 0,
      blockedReasons: sendBlockedReasons,
    },
    reconcile_connection_request_status: {
      ready: maintenanceBlockedReasons.length === 0,
      blockedReasons: maintenanceBlockedReasons,
    },
    reject_connection_request: {
      ready: maintenanceBlockedReasons.length === 0,
      blockedReasons: maintenanceBlockedReasons,
    },
    withdraw_connection: {
      ready: maintenanceBlockedReasons.length === 0,
      blockedReasons: maintenanceBlockedReasons,
    },
  };
}

/**
 * @param {string} codexHome
 */
function resolveChromePluginRoot(codexHome) {
  const root = path.join(codexHome, "plugins", "cache", "openai-bundled", "chrome");
  if (!fs.existsSync(root)) return null;
  const versions = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  return versions.length ? path.join(root, versions[0]) : null;
}

/**
 * @param {string} scriptPath
 * @param {string[]} args
 */
function runNodeJson(scriptPath, args) {
  try {
    const output = execFileSync(process.execPath, [scriptPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      ok: true,
      result: JSON.parse(output),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function inspectChromeAppInstances() {
  try {
    const output = execFileSync("ps", ["-axo", "pid=,ppid=,command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const instances = String(output).split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
        if (!match) return null;
        const [, pidRaw, ppidRaw, command] = match;
        if (!command.startsWith("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")) {
          return null;
        }
        const userDataDirMatch = command.match(/--user-data-dir=([^\s]+)/);
        return {
          pid: Number(pidRaw),
          ppid: Number(ppidRaw),
          command,
          userDataDir: userDataDirMatch?.[1] ?? null,
        };
      })
      .filter(Boolean);
    const conflictingUserDataDirInstances = instances.filter((instance) => instance.userDataDir && !instance.userDataDir.includes("/Library/Application Support/Google/Chrome"));
    return {
      instanceCount: instances.length,
      instances,
      conflictingUserDataDirInstances,
    };
  } catch (error) {
    return {
      instanceCount: 0,
      instances: [],
      conflictingUserDataDirInstances: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
