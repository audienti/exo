#!/usr/bin/env node
// @ts-check

import { Command } from "commander";
import { registerMotion } from "./commands/motion.js";
import { registerProfiles } from "./commands/profiles.js";
import { registerWhatIsThis } from "./commands/what-is-this.js";

const program = new Command();

program
  .name("exo")
  .description("Exo GTM operating kernel CLI")
  .version("0.1.0")
  .showHelpAfterError()
  .addHelpText(
    "after",
    `
Operating rules:
  - Run from the repo root when you want multiple shells or agent chats to share the same Exo state.
  - Or pin a shared state store explicitly with EXO_STATE_DIR=/absolute/path/to/.exo.
  - Prefer --json when Claude/Codex is calling Exo and needs structured output.
  - Register and test a browser profile before any browser-backed work.
  - Treat profile status as a gate, not a hint.

Common patterns:
  exo what-is-this --json
  exo motion add --url https://example.com/product --geo "United States" --title "Chief Risk Officer"
  exo motion add --url https://example.com/product --icp regulated-enterprise --industry banking,lending --json
  exo motion list
  exo motion show <motion-id>
  exo profiles add --browser chrome --label work-linkedin --profile-directory "Profile 2" --capability linkedin --capability sales-navigator
  exo profiles list
  exo profiles test <profile-id>

Current state location:
  EXO_STATE_DIR/exo.db or ./.exo/exo.db
`
  );

registerMotion(program);
registerProfiles(program);
registerWhatIsThis(program);

await program.parseAsync(process.argv);
