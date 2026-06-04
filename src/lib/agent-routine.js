// @ts-check

import os from "node:os";
import path from "node:path";

const DEFAULT_PATH = "/opt/homebrew/bin:/opt/homebrew/sbin:/Users/williamflanagan/.asdf/shims:/Users/williamflanagan/.npm-global/bin:/Users/williamflanagan/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const DEFAULT_CODEX_BIN = "/Applications/Codex.app/Contents/Resources/codex";
export const ROUTINE_ARTIFACT_VERSION = "2026-06-04-1";

/**
 * @param {string} interval
 */
export function parseRoutineInterval(interval) {
  const raw = String(interval ?? "15m").trim().toLowerCase();
  const match = raw.match(/^(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours)?$/);
  if (!match) {
    throw new Error(`Unsupported interval: ${interval}. Use forms like 15m or 1h.`);
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Unsupported interval: ${interval}. Use a positive integer.`);
  }

  const unit = match[2] ?? "m";
  if (unit.startsWith("h")) {
    const hours = value;
    return {
      raw,
      label: `${hours}h`,
      minutes: hours * 60,
      seconds: hours * 3600,
      cron: hours <= 23 ? `0 */${hours} * * *` : null,
    };
  }

  const minutes = value;
  const cron = minutes <= 59
    ? `*/${minutes} * * * *`
    : (minutes % 60 === 0 && minutes / 60 <= 23 ? `0 */${minutes / 60} * * *` : null);

  return {
    raw,
    label: `${minutes}m`,
    minutes,
    seconds: minutes * 60,
    cron,
  };
}

/**
 * @param {{
 *   runtime: string,
 *   scheduler?: string,
 *   platform?: NodeJS.Platform,
 * }} input
 */
export function resolveRoutineScheduler(input) {
  const runtime = input.runtime === "claude" ? "claude" : "codex";
  const requested = String(input.scheduler ?? "auto").trim().toLowerCase();
  const platform = input.platform ?? process.platform;

  if (!["auto", "cron", "launchd"].includes(requested)) {
    throw new Error(`Unsupported scheduler: ${requested}. Use auto, launchd, or cron.`);
  }

  if (requested === "launchd") {
    if (platform !== "darwin") {
      throw new Error("The launchd scheduler only works on macOS.");
    }
    if (runtime !== "codex") {
      throw new Error("The launchd scheduler is currently only supported for runtime=codex.");
    }
    return "launchd";
  }

  if (requested === "cron") return "cron";
  if (platform === "darwin" && runtime === "codex") return "launchd";
  return "cron";
}

/**
 * @param {string} username
 */
export function buildLaunchAgentLabel(username) {
  const safeUsername = String(username || "operator")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "operator";
  return `com.${safeUsername}.exo.queue-drainer`;
}

/**
 * @param {{
 *   repo: string,
 *   runtime: string,
 *   scheduler: "cron" | "launchd",
 *   stateDir: string,
 *   sendMode?: "live" | "verify" | "canary",
 * }} input
 */
export function buildDrainPrompt(input) {
  const repo = input.repo;
  const preflightPath = path.join(input.stateDir, "agent-preflight.json");
  const hostIntro = input.scheduler === "launchd"
    ? "You are running from the macOS host-local LaunchAgent path, not from cron and not from Codex app Automations."
    : "You are running from a scheduled shell routine.";

  const browserRule = input.runtime === "codex"
    ? "In Codex, prefer the native Chrome connector before any Playwright or Playwriter fallback."
    : "Use the runtime's native browser tools first.";

  return [
    "Run the Exo queue drainer in this workspace. Do exactly this, then stop.",
    hostIntro,
    browserRule,
    `0. Read ${preflightPath} first if it exists.`,
    "   If that file says browserReady == false, skip every browser-backed task in this pass.",
    "   Do not run connector diagnostics, do not open Chrome, do not ask for approval, and do not fall back to Playwriter or shell scraping.",
    "   Continue with any write_draft work and leave the blocked browser tasks in the queue.",
    `1. Working directory: ${repo}`,
    "2. Run: exo agent run",
    "3. Run: exo agent queue --json",
    "4. For EACH task where task.kind == run_inbound_sync:",
    "   a. Run task.contractCommand.",
    "   b. If the JSON response includes payload, send that payload to task.applyCommand via stdin.",
    "   c. If the JSON response includes transport.kind == agent_handoff, use the returned captureRequest and landingPlan as the full native-tools execution contract.",
    "      Perform the live capture with native tools only, then land the governed writeback exactly as the returned buildPayloadCommand/applyCommand instruct.",
    "      Before capture, do one lightweight Chrome connector setup check and one retry after 2 seconds if the first attempt cannot attach.",
    "      If it still cannot attach, stop that task immediately, record the exact blocked reason in your reply, and continue to the next task.",
    "      Do not run Chrome plugin diagnostics, do not open new Chrome windows, and do not improvise another browser harness.",
    "   d. After writeback, run task.verificationCommands and keep their literal outputs.",
    "5. Re-run: exo agent queue --json",
    "6. For EACH task where task.kind == write_draft:",
    "   a. Run task.briefCommand and write exactly one governed draft from that stored context.",
    "   b. Run task.writeback with <written-body> replaced by your final draft text.",
    "   c. If task.postWriteStatus == queued, that draft is now send-ready and should be picked up on the next queue refresh.",
    "7. Re-run: exo agent queue --json",
    "8. For EACH remaining task in the queue where task.kind != run_inbound_sync and task.kind != write_draft:",
    "   a. If task.kind == send_message, run: exo agent send <companyId> --motion <motionId> --prospect <prospectId> --json",
    "      → this is the governed message-send contract (pinned identity, recipient, verbatim message, executionPolicy).",
    "   b. Perform the browser action using your native browser tools on the task.recipientUrl as the pinned identity.",
    "      For send_message, do exactly what the governed send contract says. For withdraw/reject/unfollow tasks, perform that literal LinkedIn cleanup action and nothing broader.",
    "      Do not drift to another LinkedIn identity. Do not fall back to shell scraping.",
    "      If the Chrome connector cannot attach after one retry, stop that task immediately, record the exact blocked reason, and continue to the next task.",
    "      Do not run diagnostics, open Chrome windows, or switch to Playwriter in this unattended lane.",
    input.sendMode === "verify"
      ? "      This routine is in verification-only send mode. Reach a real writable composer and exact governed message, then stop before the final click and do not run writeback."
      : input.sendMode === "canary"
        ? "      This routine is in canary send mode. If this exact task already has a fresh verification proof, perform the real send and write back. Otherwise stop at ready_to_send, record proof, and stop the pass after that one send task."
        : "      This routine is in live send mode. When the governed browser action succeeds, continue to writeback immediately.",
    "   c. Only after the browser action actually happened, run the task's writeback command verbatim.",
    "9. Do not act on anyone who is not in the queue. If the queue is empty, do nothing.",
    "",
    "This pass is idempotent: a sent draft leaves the queue, so re-running never double-sends.",
  ].join("\n");
}

/**
 * @param {{
 *   label: string,
 *   runnerPath: string,
 *   repo: string,
 *   stateDir: string,
 *   codexHome: string,
 *   pathEnv: string,
 *   startInterval: number,
 *   stdoutLogPath: string,
 *   stderrLogPath: string,
 * }} input
 */
export function buildLaunchAgentPlist(input) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    `<!-- exo_agent_routine_version=${ROUTINE_ARTIFACT_VERSION} -->`,
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${escapeXml(input.label)}</string>`,
    "",
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${escapeXml(input.runnerPath)}</string>`,
    "  </array>",
    "",
    "  <key>WorkingDirectory</key>",
    `  <string>${escapeXml(input.repo)}</string>`,
    "",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "    <key>CODEX_HOME</key>",
    `    <string>${escapeXml(input.codexHome)}</string>`,
    "    <key>EXO_STATE_DIR</key>",
    `    <string>${escapeXml(input.stateDir)}</string>`,
    "    <key>PATH</key>",
    `    <string>${escapeXml(input.pathEnv)}</string>`,
    "  </dict>",
    "",
    "  <key>StartInterval</key>",
    `  <integer>${input.startInterval}</integer>`,
    "",
    "  <key>StandardOutPath</key>",
    `  <string>${escapeXml(input.stdoutLogPath)}</string>`,
    "",
    "  <key>StandardErrorPath</key>",
    `  <string>${escapeXml(input.stderrLogPath)}</string>`,
    "",
    "  <key>RunAtLoad</key>",
    "  <false/>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

/**
 * @param {{
 *   repo: string,
 *   stateDir: string,
 *   routinePath: string,
 *   logPath: string,
 *   lockDir: string,
 *   runnerPath: string,
 *   codexBin?: string,
 *   codexHome: string,
 *   pathEnv: string,
 *   label: string,
 *   sendMode?: "live" | "verify" | "canary",
 * }} input
 */
export function buildCodexHostRunner(input) {
  const codexBin = input.codexBin ?? DEFAULT_CODEX_BIN;
  const stateDir = input.stateDir;
  const preflightPath = path.join(stateDir, "agent-preflight.json");
  return [
    "#!/usr/bin/env bash",
    `# exo_agent_routine_version=${ROUTINE_ARTIFACT_VERSION}`,
    "set -euo pipefail",
    "",
    `ROOT=${quoteShell(input.repo)}`,
    `STATE_DIR=${quoteShell(stateDir)}`,
    `PROMPT=${quoteShell(input.routinePath)}`,
    `LOG_FILE=${quoteShell(input.logPath)}`,
    `LOCK_DIR=${quoteShell(input.lockDir)}`,
    "LOCK_PID_FILE=\"$LOCK_DIR/pid\"",
    `RUNNER_PATH=${quoteShell(input.runnerPath)}`,
    "PREFLIGHT_SCRIPT=\"$ROOT/scripts/preflight-agent-runtime.js\"",
    "PASS_RUNNER_SCRIPT=\"$ROOT/scripts/run-agent-host-pass.js\"",
    `PREFLIGHT_JSON=${quoteShell(preflightPath)}`,
    `CODEX_BIN=${quoteShell(codexBin)}`,
    `CODEX_HOME=\"\${CODEX_HOME:-${escapeShellDoubleQuoted(input.codexHome)}}\"`,
    `export PATH=${quoteShell(input.pathEnv || DEFAULT_PATH)}`,
    "export CODEX_HOME",
    "export CODEX_SHELL=1",
    "export EXO_STATE_DIR=\"$STATE_DIR\"",
    `export EXO_AGENT_SEND_MODE="${escapeShellDoubleQuoted(input.sendMode === "verify" ? "verify" : input.sendMode === "canary" ? "canary" : "live")}"`,
    input.sendMode === "verify"
      ? "export EXO_AGENT_SEND_DRY_RUN=\"${EXO_AGENT_SEND_DRY_RUN:-1}\""
      : "",
    "",
    "mkdir -p \"$STATE_DIR\"",
    "cd \"$ROOT\"",
    "",
    "if [[ ! -x \"$CODEX_BIN\" ]]; then",
    "  echo \"Missing Codex app runtime: $CODEX_BIN\" >&2",
    "  exit 2",
    "fi",
    "if [[ ! -f \"$PROMPT\" ]]; then",
    "  echo \"Missing Exo agent prompt: $PROMPT\" >&2",
    "  exit 2",
    "fi",
    "if [[ ! -f \"$PREFLIGHT_SCRIPT\" ]]; then",
    "  echo \"Missing Exo host preflight script: $PREFLIGHT_SCRIPT\" >&2",
    "  exit 2",
    "fi",
    "if [[ ! -f \"$PASS_RUNNER_SCRIPT\" ]]; then",
    "  echo \"Missing Exo host pass runner: $PASS_RUNNER_SCRIPT\" >&2",
    "  exit 2",
    "fi",
    "",
    "mkdir -p \"$(dirname \"$LOG_FILE\")\"",
    "acquire_lock() {",
    "  if mkdir \"$LOCK_DIR\" 2>/dev/null; then",
    "    printf '%s\\n' \"$$\" > \"$LOCK_PID_FILE\"",
    "    return 0",
    "  fi",
    "  holder_pid=\"\"",
    "  if [[ -f \"$LOCK_PID_FILE\" ]]; then",
    "    holder_pid=\"$(tr -cd '0-9' < \"$LOCK_PID_FILE\")\"",
    "  fi",
    "  if [[ -n \"$holder_pid\" ]] && kill -0 \"$holder_pid\" 2>/dev/null; then",
    "    echo \"Exo queue drainer already active (pid=$holder_pid); exiting.\" >> \"$LOG_FILE\"",
    "    return 1",
    "  fi",
    "  if [[ ! -e \"$LOCK_PID_FILE\" ]]; then",
    "    echo \"Detected incomplete Exo queue drainer lock; reclaiming $LOCK_DIR.\" >> \"$LOG_FILE\"",
    "  else",
    "    echo \"Detected stale Exo queue drainer lock; reclaiming $LOCK_DIR.\" >> \"$LOG_FILE\"",
    "  fi",
    "  rm -rf \"$LOCK_DIR\"",
    "  if mkdir \"$LOCK_DIR\" 2>/dev/null; then",
    "    printf '%s\\n' \"$$\" > \"$LOCK_PID_FILE\"",
    "    return 0",
    "  fi",
    "  echo \"Exo queue drainer could not acquire lock after stale-lock recovery; exiting.\" >> \"$LOG_FILE\"",
    "  return 1",
    "}",
    "if ! acquire_lock; then",
    "  exit 0",
    "fi",
    "trap 'rm -f \"$LOCK_PID_FILE\"; rmdir \"$LOCK_DIR\" 2>/dev/null || true' EXIT",
    "",
    "exec >> \"$LOG_FILE\" 2>&1",
    "",
    `echo \"== ${escapeShellDoubleQuoted(input.label)} host runner ==\"`,
    "echo \"started_at=$(date '+%Y-%m-%dT%H:%M:%S%z %Z')\"",
    "echo \"root=$ROOT\"",
    "echo \"state_dir=$STATE_DIR\"",
    "echo \"codex_bin=$CODEX_BIN\"",
    `echo "send_mode=${escapeShellDoubleQuoted(input.sendMode === "verify" ? "verify" : input.sendMode === "canary" ? "canary" : "live")}"`,
    "echo \"prompt=$PROMPT\"",
    "echo",
    "",
    "echo \"Running host preflight before Codex invocation...\"",
    "/usr/bin/env node \"$PREFLIGHT_SCRIPT\" --json --write \"$PREFLIGHT_JSON\"",
    "",
    "if [[ \"${EXO_AGENT_PREFLIGHT_ONLY:-}\" == \"1\" ]]; then",
    "  echo \"Preflight-only mode requested; exiting before Codex invocation.\"",
    "  exit 0",
    "fi",
    "",
    "echo \"Starting deterministic host pass...\"",
    "set +e",
    "/usr/bin/caffeinate -dimsu -t 7200 /usr/bin/env node \"$PASS_RUNNER_SCRIPT\"",
    "status=$?",
    "set -e",
    "echo \"finished_at=$(date '+%Y-%m-%dT%H:%M:%S%z %Z') status=$status\"",
    "exit \"$status\"",
    "",
  ].join("\n");
}

/**
 * @param {{
 *   repo: string,
 *   stateDir: string,
 *   routinePath: string,
 *   logPath: string,
 *   lockDir: string,
 *   runnerPath: string,
 *   pathEnv: string,
 *   label: string,
 *   sendMode?: "live" | "verify" | "canary",
 * }} input
 */
function buildDeterministicHostRunner(input) {
  const stateDir = input.stateDir;
  const preflightPath = path.join(stateDir, "agent-preflight.json");
  return [
    "#!/usr/bin/env bash",
    `# exo_agent_routine_version=${ROUTINE_ARTIFACT_VERSION}`,
    "set -euo pipefail",
    "",
    `ROOT=${quoteShell(input.repo)}`,
    `STATE_DIR=${quoteShell(stateDir)}`,
    `PROMPT=${quoteShell(input.routinePath)}`,
    `LOG_FILE=${quoteShell(input.logPath)}`,
    `LOCK_DIR=${quoteShell(input.lockDir)}`,
    "LOCK_PID_FILE=\"$LOCK_DIR/pid\"",
    `RUNNER_PATH=${quoteShell(input.runnerPath)}`,
    "PREFLIGHT_SCRIPT=\"$ROOT/scripts/preflight-agent-runtime.js\"",
    "PASS_RUNNER_SCRIPT=\"$ROOT/scripts/run-agent-host-pass.js\"",
    `PREFLIGHT_JSON=${quoteShell(preflightPath)}`,
    `export PATH=${quoteShell(input.pathEnv || DEFAULT_PATH)}`,
    "export EXO_STATE_DIR=\"$STATE_DIR\"",
    `export EXO_AGENT_SEND_MODE="${escapeShellDoubleQuoted(input.sendMode === "verify" ? "verify" : input.sendMode === "canary" ? "canary" : "live")}"`,
    input.sendMode === "verify"
      ? "export EXO_AGENT_SEND_DRY_RUN=\"${EXO_AGENT_SEND_DRY_RUN:-1}\""
      : "",
    "",
    "mkdir -p \"$STATE_DIR\"",
    "cd \"$ROOT\"",
    "",
    "if [[ ! -f \"$PROMPT\" ]]; then",
    "  echo \"Missing Exo agent prompt: $PROMPT\" >&2",
    "  exit 2",
    "fi",
    "if [[ ! -f \"$PREFLIGHT_SCRIPT\" ]]; then",
    "  echo \"Missing Exo host preflight script: $PREFLIGHT_SCRIPT\" >&2",
    "  exit 2",
    "fi",
    "if [[ ! -f \"$PASS_RUNNER_SCRIPT\" ]]; then",
    "  echo \"Missing Exo host pass runner: $PASS_RUNNER_SCRIPT\" >&2",
    "  exit 2",
    "fi",
    "",
    "mkdir -p \"$(dirname \"$LOG_FILE\")\"",
    "acquire_lock() {",
    "  if mkdir \"$LOCK_DIR\" 2>/dev/null; then",
    "    printf '%s\\n' \"$$\" > \"$LOCK_PID_FILE\"",
    "    return 0",
    "  fi",
    "  holder_pid=\"\"",
    "  if [[ -f \"$LOCK_PID_FILE\" ]]; then",
    "    holder_pid=\"$(tr -cd '0-9' < \"$LOCK_PID_FILE\")\"",
    "  fi",
    "  if [[ -n \"$holder_pid\" ]] && kill -0 \"$holder_pid\" 2>/dev/null; then",
    "    echo \"Exo queue drainer already active (pid=$holder_pid); exiting.\" >> \"$LOG_FILE\"",
    "    return 1",
    "  fi",
    "  if [[ ! -e \"$LOCK_PID_FILE\" ]]; then",
    "    echo \"Detected incomplete Exo queue drainer lock; reclaiming $LOCK_DIR.\" >> \"$LOG_FILE\"",
    "  else",
    "    echo \"Detected stale Exo queue drainer lock; reclaiming $LOCK_DIR.\" >> \"$LOG_FILE\"",
    "  fi",
    "  rm -rf \"$LOCK_DIR\"",
    "  if mkdir \"$LOCK_DIR\" 2>/dev/null; then",
    "    printf '%s\\n' \"$$\" > \"$LOCK_PID_FILE\"",
    "    return 0",
    "  fi",
    "  echo \"Exo queue drainer could not acquire lock after stale-lock recovery; exiting.\" >> \"$LOG_FILE\"",
    "  return 1",
    "}",
    "if ! acquire_lock; then",
    "  exit 0",
    "fi",
    "trap 'rm -f \"$LOCK_PID_FILE\"; rmdir \"$LOCK_DIR\" 2>/dev/null || true' EXIT",
    "",
    "exec >> \"$LOG_FILE\" 2>&1",
    "",
    `echo \"== ${escapeShellDoubleQuoted(input.label)} host runner ==\"`,
    "echo \"started_at=$(date '+%Y-%m-%dT%H:%M:%S%z %Z')\"",
    "echo \"root=$ROOT\"",
    "echo \"state_dir=$STATE_DIR\"",
    `echo "send_mode=${escapeShellDoubleQuoted(input.sendMode === "verify" ? "verify" : input.sendMode === "canary" ? "canary" : "live")}"`,
    "echo \"prompt=$PROMPT\"",
    "echo",
    "",
    "echo \"Running host preflight before deterministic pass...\"",
    "/usr/bin/env node \"$PREFLIGHT_SCRIPT\" --json --write \"$PREFLIGHT_JSON\"",
    "",
    "if [[ \"${EXO_AGENT_PREFLIGHT_ONLY:-}\" == \"1\" ]]; then",
    "  echo \"Preflight-only mode requested; exiting before deterministic pass.\"",
    "  exit 0",
    "fi",
    "",
    "echo \"Starting deterministic host pass...\"",
    "set +e",
    "/usr/bin/env node \"$PASS_RUNNER_SCRIPT\"",
    "status=$?",
    "set -e",
    "echo \"finished_at=$(date '+%Y-%m-%dT%H:%M:%S%z %Z') status=$status\"",
    "exit \"$status\"",
    "",
  ].join("\n");
}

/**
 * @param {{
 *   repo: string,
 *   stateDir: string,
 *   runtime?: string,
 *   interval?: string,
 *   scheduler?: string,
 *   platform?: NodeJS.Platform,
 *   homeDir?: string,
 *   username?: string,
 *   uid?: number | null,
 *   pathEnv?: string,
 *   codexHome?: string,
 *   codexBin?: string,
 *   sendMode?: string,
 * }} input
 */
export function buildRoutinePlan(input) {
  const runtime = input.runtime === "claude" ? "claude" : "codex";
  const scheduler = resolveRoutineScheduler({
    runtime,
    scheduler: input.scheduler ?? "auto",
    platform: input.platform ?? process.platform,
  });
  const interval = parseRoutineInterval(input.interval ?? "15m");
  const rawSendMode = String(input.sendMode ?? "verify").trim().toLowerCase();
  const sendMode = rawSendMode === "verify"
    ? "verify"
    : rawSendMode === "canary"
      ? "canary"
      : "live";

  if (scheduler === "cron" && !interval.cron) {
    throw new Error(`Interval ${interval.label} is not representable as a cron cadence. Use a whole-hour interval or switch to --scheduler launchd on macOS.`);
  }

  const homeDir = input.homeDir ?? os.homedir();
  const username = input.username ?? os.userInfo().username;
  const uid = input.uid ?? process.getuid?.() ?? null;
  const pathEnv = input.pathEnv ?? process.env.PATH ?? DEFAULT_PATH;
  const codexHome = input.codexHome ?? process.env.CODEX_HOME ?? path.join(homeDir, ".codex");
  const label = buildLaunchAgentLabel(username);
  const routinePath = path.join(input.stateDir, "agent-routine.md");
  const logPath = path.join(input.stateDir, "agent.log");
  const hostRunnerPath = path.join(input.stateDir, "run-agent-host.sh");
  const lockDir = path.join("/tmp", `${label}.lock`);
  const prompt = buildDrainPrompt({ repo: input.repo, runtime, scheduler, stateDir: input.stateDir, sendMode });
  const artifacts = [
    { path: routinePath, content: prompt, mode: 0o644 },
  ];

  if (scheduler === "cron") {
    const runner = buildDeterministicHostRunner({
      repo: input.repo,
      stateDir: input.stateDir,
      routinePath,
      logPath,
      lockDir,
      runnerPath: hostRunnerPath,
      pathEnv,
      label,
      sendMode,
    });
    artifacts.push({ path: hostRunnerPath, content: runner, mode: 0o755 });
    return {
      runtime,
      scheduler,
      sendMode,
      label,
      interval,
      routinePath,
      logPath,
      prompt,
      artifacts,
      cronLine: `${interval.cron} ${hostRunnerPath}`,
      launchAgent: null,
      hostRunnerPath,
    };
  }

  const launchAgentSourcePath = path.join(input.stateDir, "agent-launchd.plist");
  const launchAgentInstallPath = path.join(homeDir, "Library", "LaunchAgents", `${label}.plist`);
  const launchAgentTarget = uid === null ? label : `gui/${uid}/${label}`;
  const stdoutLogPath = path.join(input.stateDir, "agent-launchd.out.log");
  const stderrLogPath = path.join(input.stateDir, "agent-launchd.err.log");
  const hostRunner = buildCodexHostRunner({
    repo: input.repo,
    stateDir: input.stateDir,
    routinePath,
    logPath,
    lockDir,
    runnerPath: hostRunnerPath,
    codexBin: input.codexBin ?? DEFAULT_CODEX_BIN,
    codexHome,
    pathEnv,
    label,
    sendMode,
  });
  const plist = buildLaunchAgentPlist({
    label,
    runnerPath: hostRunnerPath,
    repo: input.repo,
    stateDir: input.stateDir,
    codexHome,
    pathEnv,
    startInterval: interval.seconds,
    stdoutLogPath,
    stderrLogPath,
  });

  artifacts.push(
    { path: hostRunnerPath, content: hostRunner, mode: 0o755 },
    { path: launchAgentSourcePath, content: plist, mode: 0o644 },
  );

  return {
    runtime,
    scheduler,
    sendMode,
    label,
    interval,
    routinePath,
    logPath,
    prompt,
    artifacts,
    cronLine: null,
    hostRunnerPath,
    launchAgent: {
      sourcePath: launchAgentSourcePath,
      installPath: launchAgentInstallPath,
      target: launchAgentTarget,
      bootstrapDomain: uid === null ? null : `gui/${uid}`,
      bootstrapCommand: uid === null ? null : `launchctl bootstrap gui/${uid} ${launchAgentInstallPath}`,
      bootoutCommand: uid === null ? null : `launchctl bootout ${launchAgentTarget}`,
      enableCommand: uid === null ? null : `launchctl enable ${launchAgentTarget}`,
      printCommand: uid === null ? null : `launchctl print ${launchAgentTarget}`,
      kickstartCommand: uid === null ? null : `launchctl kickstart -k ${launchAgentTarget}`,
      stdoutLogPath,
      stderrLogPath,
      plist,
    },
  };
}

/**
 * @param {string} value
 */
function quoteShell(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * @param {string} value
 */
function quoteShellForCommand(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * @param {string} value
 */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * @param {string} value
 */
function escapeShellDoubleQuoted(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}
