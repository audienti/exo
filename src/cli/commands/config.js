#!/usr/bin/env node
// @ts-check

import fs from "node:fs";
import path from "node:path";
import { renderConfigExportSummary, renderConfigImportSummary } from "../../artifacts/render-config.js";
import { exportConfigBundle } from "../../core/export-config.js";
import { importConfigBundle } from "../../core/import-config.js";

/**
 * @param {import("commander").Command} program
 */
export function registerConfig(program) {
  const config = program
    .command("config")
    .description("Export and import Exo configuration state.")
    .addHelpText(
      "after",
      `
Canonical config interface:
  exo config export
  exo config import

Rules:
  - Treat config export/import as first-class infrastructure, not a one-off migration tool.
  - Browser profiles are re-tested on import so stale ready-status cannot travel silently.
  - Prefer --json when another agent is carrying the bundle forward.
`
    );

  config
    .command("export")
    .description("Export motions, companies, and browser profiles as a portable Exo config bundle.")
    .option("--out <path>", "Write the bundle to a file instead of stdout")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo config export --json
  exo config export --out ./exo-config.json

Notes:
  - The export bundle includes motions, companies, and browser profiles.
  - Browser profile paths are preserved exactly as stored.
  - Use this to move Exo state between chats, shells, or alpha-user setups.
`
    )
    .action((options) => {
      const bundle = exportConfigBundle();
      const payload = JSON.stringify(bundle, null, 2);

      if (options.out) {
        const outputPath = path.resolve(process.cwd(), options.out);
        fs.writeFileSync(outputPath, `${payload}\n`, "utf8");

        if (options.json) {
          console.log(payload);
          return;
        }

        console.log(`${renderConfigExportSummary(bundle)}\nFile: ${outputPath}`);
        return;
      }

      console.log(payload);
    });

  config
    .command("import")
    .description("Import an Exo config bundle from a file.")
    .argument("<file>", "Path to an Exo config JSON file")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo config import ./exo-config.json
  exo config import ./exo-config.json --json

Notes:
  - Import upserts motions, companies, and browser profiles by id or local identity.
  - Browser profiles are always re-tested on import.
  - Import does not delete local state that is absent from the bundle.
`
    )
    .action((file, options) => {
      const inputPath = path.resolve(process.cwd(), file);
      const raw = fs.readFileSync(inputPath, "utf8");
      const result = importConfigBundle(JSON.parse(raw));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`${renderConfigImportSummary(result)}\nFile: ${inputPath}`);
    });
}
