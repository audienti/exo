#!/usr/bin/env node
// @ts-check

import { Command } from "commander";
import { registerDefineMotion } from "./commands/define-motion.js";
import { registerShowMotion } from "./commands/show-motion.js";
import { registerListMotions } from "./commands/list-motions.js";

const program = new Command();

program
  .name("exo")
  .description("Exo GTM operating kernel CLI")
  .version("0.1.0");

registerDefineMotion(program);
registerShowMotion(program);
registerListMotions(program);

await program.parseAsync(process.argv);
