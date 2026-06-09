#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// @ts-check

import { Command } from "commander";
import { registerActions } from "./commands/actions.js";
import { registerAgent } from "./commands/agent.js";
import { registerCompanies } from "./commands/companies.js";
import { registerConfig } from "./commands/config.js";
import { registerDaily } from "./commands/daily.js";
import { registerInbound } from "./commands/inbound.js";
import { registerInbox } from "./commands/inbox.js";
import { registerMotion } from "./commands/motion.js";
import { registerOnboarding } from "./commands/onboarding.js";
import { registerNext } from "./commands/next.js";
import { registerPolicy } from "./commands/policy.js";
import { registerProfiles } from "./commands/profiles.js";
import { registerReport } from "./commands/report.js";
import { registerSetup } from "./commands/setup.js";
import { registerTransition } from "./commands/transition.js";
import { registerUi } from "./commands/ui.js";
import { registerUsers } from "./commands/users.js";
import { registerWhatIsThis } from "./commands/what-is-this.js";
import { EXO_VERSION } from "../lib/exo-version.js";

const program = new Command();

program
  .name("exo")
  .description("Exo agentic CRM and GTM motion system of record")
  .version(EXO_VERSION)
  .showHelpAfterError()
  .addHelpText(
    "after",
    `
Operating rules:
  - Run from the repo root when you want multiple shells or agent chats to share the same Exo state.
  - Or pin a shared state store explicitly with EXO_STATE_DIR=/absolute/path/to/.exo.
  - Prefer --json when Claude/Codex is calling Exo and needs structured output.
  - Prefer connected account and harness-connector paths over any browser profile path.
  - Browser profiles are legacy state only. They do not create a governed execution path.
  - Use exo users intake when the store is still missing its first managed execution user.
  - Use exo motion intake when an agent should ask one setup question at a time before launching a new motion.
  - Use exo setup intake when chat language might be introducing a new user or a new motion.

Common patterns:
  exo what-is-this --json
  exo users intake --json
  exo setup intake --message "We need a new motion for https://example.com/product" --json
  exo motion intake --json
  exo motion start --url https://example.com/product --premise "This offer matters when regulated lenders enter more complex credit-decision environments." --audience "Traditional FI risk owners" --signal "company::Is there recent evidence that this company expanded into a more complex lending segment?" --json
  exo motion start --url https://example.com/product --existing continue --json
  exo motion target <motion-id> --json
  exo report motion <motion-id>
  exo report workspace --user <user-id> --out ./motion-workspace.html
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
  exo inbound sync linkedin-live <user-id> --account <account-id> --runtime codex --apply --refresh --json
  exo inbound sync gmail <user-id> --account <account-id> --input ./gmail-capture.json --apply --refresh --json
  exo inbound sync gmail-live <user-id> --account <account-id> --apply --refresh --json
  exo inbound sync run <user-id> --input ./inbound-sync.json --refresh --json
  exo inbound review <user-id> --json
  exo inbound observations list <user-id> --json
  exo inbound observations add <user-id> --account <account-id> --surface linkedin-messaging-inbox --kind inbound_reply_received --observed-at 2026-05-28T14:00:00.000Z --summary "Prospect replied in LinkedIn" --json
  exo policy list --scope effective --json
  exo policy add --scope global --kind ignore_identity --actor-handle person@example.com --reason "Never show this sender again" --json
  exo policy add --scope local --kind hide_surface --capability linkedin --surface linkedin-received-invitations --reason "Hide inbound invites in this repo" --json
  exo inbox --user <user-id> --json
  exo daily --user <user-id> --json
  exo next --json
  exo actions list
  exo actions show connection_request
  exo actions result --action connection_request --result sent --company <company-id> --prospect <prospect-id> --occurred-at <iso-datetime> --json
  exo companies list
  exo companies find chainguard
  exo companies update <company-id> --website-url https://example.com
  exo companies motions <company-id>
  exo companies research-brief <company-id> --json
  exo companies signal-matches add <company-id> --signal <signal-id> --summary "Stored reason to talk"
  exo companies signal-matches show <company-id> --json
  exo companies prospects add <company-id> --name "Person Name" --title "Director Title" --email person@example.com --profile-viewed-at <iso-datetime> --live-signal-summary "Recent post shows channel activity" --why-relevant "Why this person matters now"
  exo companies prospects update <company-id> --prospect <prospect-id> --email person@example.com --source-url https://example.com/profile --observed-at <iso-datetime>
  exo companies cadence set <company-id> --prospect <prospect-id> --current-step connection-request --next-action "Send the first touch"
  exo users add --label operator-main --owner operator
  exo users harness probe <user-id> --runtime codex --json
  exo users accounts map-runtime <user-id> --runtime codex --apply --json
  exo users accounts add <user-id> --capability linkedin --handle operator-linkedin --runtime codex --connector <connector-from-probe> --provider-account-id <provider-account-id> --preferred --max-connection-requests 125
  exo users accounts add <user-id> --capability gmail --handle operator@example.com --runtime codex --connector gmail --provider-account-id <provider-account-id> --preferred
  exo users resolve <user-id> --capability gmail --json
  exo config export --out ./exo-config.json
  exo config import ./exo-config.json

Current state location:
  Single-store mode: EXO_STATE_DIR/exo.db or ./.exo/exo.db
  Layered mode: EXO_HOME_STATE_DIR/exo.db + EXO_STATE_DIR/exo.db + ./exo-policy.jsonl
`
  );

registerActions(program);
registerAgent(program);
registerCompanies(program);
registerConfig(program);
registerDaily(program);
registerInbound(program);
registerInbox(program);
registerMotion(program);
registerOnboarding(program);
registerNext(program);
registerPolicy(program);
registerProfiles(program);
registerReport(program);
registerSetup(program);
registerTransition(program);
registerUi(program);
registerUsers(program);
registerWhatIsThis(program);

await program.parseAsync(process.argv);
