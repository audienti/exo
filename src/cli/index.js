#!/usr/bin/env node
// @ts-check

import { Command } from "commander";
import { registerActions } from "./commands/actions.js";
import { registerCompanies } from "./commands/companies.js";
import { registerConfig } from "./commands/config.js";
import { registerDaily } from "./commands/daily.js";
import { registerInbound } from "./commands/inbound.js";
import { registerInbox } from "./commands/inbox.js";
import { registerMotion } from "./commands/motion.js";
import { registerNext } from "./commands/next.js";
import { registerProfiles } from "./commands/profiles.js";
import { registerReport } from "./commands/report.js";
import { registerUsers } from "./commands/users.js";
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
  - Use exo motion intake when an agent should ask one setup question at a time before launching a new motion.

Common patterns:
  exo what-is-this --json
  exo motion intake --json
  exo motion start --url https://example.com/product --premise "This offer matters when regulated lenders enter more complex credit-decision environments." --audience "Traditional FI risk owners" --signal "company::Is there recent evidence that this company expanded into a more complex lending segment?" --json
  exo motion start --url https://example.com/product --existing continue --json
  exo motion target <motion-id> --json
  exo report motion <motion-id>
  exo motion clone <motion-id> --audience "BNPL modernization leaders" --segment bnpl --json
  exo motion update <motion-id> --audience "Traditional FI risk owners" --title "Chief Risk Officer" --segment traditional-fi --json
  exo motion add --config ./actico.motion.json --json
  exo motion list
  exo motion show <motion-id>
  exo motion actions <motion-id> --prospect <prospect-id> --json
  exo motion action-brief <motion-id> --prospect <prospect-id> --action connection_request --json
  exo motion remove <motion-id>
  exo inbound surfaces --json
  exo inbound sync show <user-id> --json
  exo inbound sync plan <user-id> --mode quick --json
  exo inbound sync linkedin <user-id> --account <account-id> --input ./linkedin-capture.json --apply --refresh --json
  exo inbound sync gmail <user-id> --account <account-id> --input ./gmail-capture.json --apply --refresh --json
  exo inbound sync run <user-id> --input ./inbound-sync.json --refresh --json
  exo inbound review <user-id> --json
  exo inbound observations list <user-id> --json
  exo inbound observations add <user-id> --account <account-id> --surface linkedin-messaging-inbox --kind inbound_reply_received --observed-at 2026-05-28T14:00:00.000Z --summary "Prospect replied in LinkedIn" --json
  exo inbox --user <user-id> --json
  exo daily --user <user-id> --json
  exo next --json
  exo actions list
  exo actions show connection_request
  exo companies list
  exo companies find chainguard
  exo companies update <company-id> --website-url https://example.com
  exo companies motions <company-id>
  exo companies research-brief <company-id> --json
  exo companies signal-matches add <company-id> --signal <signal-id> --summary "Stored reason to talk"
  exo companies signal-matches show <company-id> --json
  exo companies prospects add <company-id> --name "Person Name" --title "Director Title" --email person@example.com --profile-viewed-at <iso-datetime> --live-signal-summary "Recent post shows channel activity" --why-relevant "Why this person matters now"
  exo companies prospects update <company-id> --prospect <prospect-id> --email person@example.com --source-url https://example.com/profile --observed-at <iso-datetime>
  exo companies through-line set <company-id> --prospect <prospect-id> --signal-match <signal-match-id> --specific-to-them "Specific to them" --shared-problem "Shared problem" --why-now "Why now" --legitimate-wedge "Why they would reply" --compression-line "One sentence"
  exo companies opening-plan set <company-id> --prospect <prospect-id> --signal-match <signal-match-id> --why-now "Reason to talk now" --angle "Opening angle" --reply-path "Why this person would legitimately reply now" --primary-channel connection-request --fallback-channel email --fallback-trigger "Use email if LinkedIn is blocked or there is no reply." --preflight-action "View the prospect profile" --first-move "First move" --first-message-goal "Desired response"
  exo companies cadence set <company-id> --prospect <prospect-id> --current-step connection-request --next-action "Send the first touch"
  exo companies profile assign <company-id> --profile <profile-id> --reason "Use one identity consistently"
  exo profiles discover --json
  exo profiles add --browser chrome --label work-linkedin --profile-directory "Profile 2" --capability linkedin --capability sales-navigator
  exo profiles claim <profile-id> --label audienti-main --workspace audienti --account linkedin:wflanagan@audienti.com --max-connection-requests 40 --max-inmail-messages 20
  exo profiles list
  exo profiles capabilities --json
  exo profiles resolve --capability linkedin --json
  exo profiles test <profile-id>
  exo users add --label william-main --owner william
  exo users accounts add <user-id> --capability linkedin --handle wflanagan@audienti.com --profile <profile-id> --preferred
  exo users accounts add <user-id> --capability gmail --handle william@audienti.com --runtime codex --connector gmail --preferred
  exo users resolve <user-id> --capability gmail --json
  exo config export --out ./exo-config.json
  exo config import ./exo-config.json

Current state location:
  EXO_STATE_DIR/exo.db or ./.exo/exo.db
`
  );

registerActions(program);
registerCompanies(program);
registerConfig(program);
registerDaily(program);
registerInbound(program);
registerInbox(program);
registerMotion(program);
registerNext(program);
registerProfiles(program);
registerReport(program);
registerUsers(program);
registerWhatIsThis(program);

await program.parseAsync(process.argv);
