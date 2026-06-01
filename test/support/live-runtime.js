// @ts-check

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { buildNodeTestEnv } from "../../scripts/node-test-runtime.js";

export const repoRoot = path.resolve(import.meta.dirname, "..", "..");
export const cliPath = path.join(repoRoot, "src", "cli", "index.js");

const offerHtml = [
  "<html>",
  "<head>",
  "<title>Actico Risk Platform</title>",
  '<meta name="description" content="Credit and risk decisioning for regulated lenders." />',
  "</head>",
  "<body>ok</body>",
  "</html>"
].join("");

export const offerUrl = `data:text/html,${encodeURIComponent(offerHtml)}`;

/**
 * @param {string} tempDir
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [extraEnv]
 */
export function runCliText(tempDir, args, extraEnv = {}) {
  const mergedEnv = {
    ...process.env,
    ...extraEnv
  };
  if (!Object.prototype.hasOwnProperty.call(extraEnv, "CODEX_SHELL")) {
    delete mergedEnv.CODEX_SHELL;
  }

  return execFileSync("node", [cliPath, ...args], {
    cwd: tempDir,
    encoding: "utf8",
    env: buildNodeTestEnv(mergedEnv)
  });
}

/**
 * @param {string} tempDir
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [extraEnv]
 */
export function runCliJson(tempDir, args, extraEnv = {}) {
  return JSON.parse(runCliText(tempDir, args, extraEnv));
}

/**
 * @param {string} profilePath
 * @param {{ cookieHosts?: string[], historyUrls?: string[] }} input
 */
function seedBrowserEvidence(profilePath, input) {
  const cookiesDb = new DatabaseSync(path.join(profilePath, "Cookies"));
  cookiesDb.exec("CREATE TABLE cookies (host_key TEXT);");
  for (const host of input.cookieHosts ?? []) {
    cookiesDb.prepare("INSERT INTO cookies (host_key) VALUES (?)").run(host);
  }
  cookiesDb.close();

  const historyDb = new DatabaseSync(path.join(profilePath, "History"));
  historyDb.exec("CREATE TABLE urls (url TEXT);");
  for (const url of input.historyUrls ?? []) {
    historyDb.prepare("INSERT INTO urls (url) VALUES (?)").run(url);
  }
  historyDb.close();
}

/**
 * @param {string} tempDir
 * @param {{
 *   profileDirectory?: string,
 *   profileName?: string,
 *   cookieHosts?: string[],
 *   historyUrls?: string[]
 * }} [options]
 */
export function setupReadyChromeProfile(tempDir, options = {}) {
  const userDataDir = path.join(tempDir, "Chrome");
  const profileDirectory = options.profileDirectory ?? "Profile 4";
  const profileName = options.profileName ?? "LinkedIn Main";
  const profilePath = path.join(userDataDir, profileDirectory);
  const browserCommand = path.join(tempDir, `fake-chrome-${profileDirectory.replace(/\s+/g, "-").toLowerCase()}`);

  fs.mkdirSync(profilePath, { recursive: true });
  fs.writeFileSync(browserCommand, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(browserCommand, 0o755);
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [profileDirectory]: { name: profileName }
        }
      }
    })
  );
  fs.writeFileSync(path.join(profilePath, "Preferences"), JSON.stringify({ profile: { name: profileName } }));
  seedBrowserEvidence(profilePath, {
    cookieHosts: options.cookieHosts ?? [".linkedin.com"],
    historyUrls: options.historyUrls ?? ["https://www.linkedin.com/feed/"]
  });

  return {
    userDataDir,
    profileDirectory,
    profilePath,
    profileName,
    browserCommand
  };
}

/**
 * @param {string} filePath
 * @param {unknown} capture
 * @param {{ exitCode?: number | null }} [options]
 */
export function writeFakeCodexCaptureScript(filePath, capture, options = {}) {
  const exitCode = options.exitCode ?? null;
  const lines = [
    "#!/bin/sh",
    'out=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    -o|--output-last-message)',
    '      out="$2"',
    "      shift 2",
    "      ;;",
    '    *)',
    "      shift",
    "      ;;",
    "  esac",
    "done",
    'if [ -z "$out" ]; then',
    '  echo "missing output file" >&2',
    "  exit 2",
    "fi"
  ];

  if (exitCode !== null) {
    lines.push(`exit ${exitCode}`);
  } else {
    lines.push(`cat > "$out" <<'JSON'`);
    lines.push(JSON.stringify(capture, null, 2));
    lines.push("JSON");
  }

  lines.push("");
  fs.writeFileSync(filePath, lines.join("\n"));
  fs.chmodSync(filePath, 0o755);
}

/**
 * @param {string} filePath
 * @param {{
 *   plugins?: string[],
 *   mcpLines?: string[],
 *   structuredOutput?: unknown
 * }} [options]
 */
export function writeFakeClaudeScript(filePath, options = {}) {
  const plugins = options.plugins ?? [];
  const mcpLines = options.mcpLines ?? [];
  const structuredOutput = options.structuredOutput ?? { mode: "quick", status: "failed", checkedAt: null, itemCount: 0, error: "missing structured output", threads: [] };

  const lines = [
    "#!/bin/sh",
    'if [ "$1" = "plugins" ] && [ "$2" = "list" ]; then',
    '  echo "Installed plugins:"'
  ];

  for (const plugin of plugins) {
    lines.push(`  echo "  ❯ ${plugin}"`);
  }

  lines.push("  exit 0");
  lines.push("fi");
  lines.push('if [ "$1" = "mcp" ] && [ "$2" = "list" ]; then');
  if (mcpLines.length) {
    for (const line of mcpLines) {
      lines.push(`  echo '${line.replace(/'/g, "'\\''")}'`);
    }
  } else {
    lines.push('  echo "No MCP servers configured"');
  }
  lines.push("  exit 0");
  lines.push("fi");
  lines.push('if [ "$1" = "-p" ]; then');
  lines.push("  cat <<'JSON'");
  lines.push(JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    structured_output: structuredOutput
  }));
  lines.push("JSON");
  lines.push("  exit 0");
  lines.push("fi");
  lines.push('echo "unsupported fake claude invocation" >&2');
  lines.push("exit 2");
  lines.push("");

  fs.writeFileSync(filePath, lines.join("\n"));
  fs.chmodSync(filePath, 0o755);
}

/**
 * @param {string} tempDir
 * @param {{
 *   premise: string,
 *   signal: string,
 *   prospectName: string,
 *   prospectTitle: string,
 *   whyRelevant: string,
 *   email?: string,
 *   linkedinProfileUrl?: string
 * }} input
 */
export function createLinkedProspectContext(tempDir, input) {
  const motion = runCliJson(tempDir, [
    "motion",
    "add",
    "--url",
    offerUrl,
    "--premise",
    input.premise,
    "--audience",
    "Revenue leaders",
    "--signal",
    input.signal,
    "--json"
  ]);

  const company = runCliJson(tempDir, [
    "companies",
    "add",
    "--name",
    "BuyerCo",
    "--domain",
    "buyer.example",
    "--motion",
    motion.id,
    "--json"
  ]);

  const prospectArgs = [
    "companies",
    "prospects",
    "add",
    company.id,
    "--motion",
    motion.id,
    "--name",
    input.prospectName,
    "--title",
    input.prospectTitle,
    "--buying-committee-role",
    "primary_business_owner",
    "--decision-authority",
    "influences",
    "--why-relevant",
    input.whyRelevant
  ];

  if (input.email) {
    prospectArgs.push("--email", input.email);
  }

  if (input.linkedinProfileUrl) {
    prospectArgs.push("--linkedin-profile-url", input.linkedinProfileUrl);
  }

  prospectArgs.push("--json");

  const prospectResult = runCliJson(tempDir, prospectArgs);
  return {
    motion,
    company,
    prospect: prospectResult.prospects[0]
  };
}
