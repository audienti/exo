#!/usr/bin/env node
// @ts-check

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildPreflightSummary } from "../src/lib/agent-preflight.js";

const DEFAULT_CODEX_HOME = path.join(os.homedir(), ".codex");
if (isMainModule(import.meta.url)) {
  main();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const stateDir = process.env.EXO_STATE_DIR ?? path.join(process.cwd(), ".exo");
  const codexHome = process.env.CODEX_HOME ?? DEFAULT_CODEX_HOME;
  const summary = buildPreflightSummary({ stateDir, codexHome });

  if (args.writePath) {
    fs.mkdirSync(path.dirname(args.writePath), { recursive: true });
    fs.writeFileSync(args.writePath, JSON.stringify(summary, null, 2));
  }

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (summary.browser.required) {
    console.log(`browserReady=${summary.browser.ready} browserTaskCount=${summary.queue.browserTaskCount}`);
    for (const reason of summary.browser.blockedReasons) {
      console.log(`blocked: ${reason}`);
    }
    return;
  }

  console.log(`browser preflight skipped: ${summary.browser.skipReason}`);
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const supported = new Set(["--json", "--write"]);
  let writePath = null;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--write") {
      writePath = argv[index + 1] ? path.resolve(argv[index + 1]) : null;
      index += 1;
      continue;
    }
    if (!supported.has(arg)) {
      throw new Error(`Unsupported argument: ${arg}`);
    }
  }
  return { json, writePath };
}

/** @param {string} moduleUrl */
function isMainModule(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(path.resolve(entry)).href === moduleUrl;
}
