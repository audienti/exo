#!/usr/bin/env node
// @ts-check

import fs from "node:fs";
import path from "node:path";
import {
  renderCompanyList,
  renderCompanyMotions,
  renderCompanyResearchBrief,
  renderCompanySummary
} from "../../artifacts/render-company.js";
import { addCompany } from "../../core/add-company.js";
import { assignCompanyProfile } from "../../core/assign-company-profile.js";
import { assignCompanyUser } from "../../core/assign-company-user.js";
import { buildCompanyExecutionView } from "../../core/build-company-execution-view.js";
import { buildCompanyRollup } from "../../core/build-company-rollup.js";
import { buildLiveLinkedinProfileEnrichmentView } from "../../core/build-live-linkedin-profile-enrichment.js";
import { buildMotionDraftBrief } from "../../core/build-motion-draft-view.js";
import { buildCompanyResearchBrief } from "../../core/build-company-research-brief.js";
import { claimMotionProspectPacket } from "../../core/claim-motion-prospect-packet.js";
import { claimMotionTargetAccountPacket } from "../../core/claim-target-account-packet.js";
import { completeMotionProspectPacket } from "../../core/complete-motion-prospect-packet.js";
import { completeMotionTargetAccountPacket } from "../../core/complete-target-account-packet.js";
import { warmImageProxy } from "../../lib/image-proxy.js";
import { isAutonomousSendReadyDraft, isSendableDraftStatus } from "../../lib/draft-policy.js";
import { approveMotionProspectDraft, markMotionProspectDraftSent, setMotionProspectDraft } from "../../core/set-prospect-draft.js";
import { recordActionResult } from "../../core/record-action-result.js";
import { recordMotionProspect, updateMotionProspect } from "../../core/record-prospect.js";
import { recordMotionProspectTouch } from "../../core/record-prospect-touch.js";
import { recordMotionSignalMatch } from "../../core/record-signal-match.js";
import { selectLinkedinPublicEngagementTarget } from "../../core/select-linkedin-public-engagement.js";
import { setMotionTargetAccountQueue } from "../../core/set-target-account-queue.js";
import { setMotionProspectCadence } from "../../core/set-prospect-cadence.js";
import { updateCompanyRecord } from "../../core/update-company.js";
import { rehydrateMotion } from "../../core/rehydrate-motion.js";
import {
  findBrowserProfileById,
  findCompanyById,
  findCompanyByIdentity,
  findMotionAccountByMotionAndCompany,
  findMotionById,
  findUserById,
  insertCompany,
  listBrowserProfiles,
  listCompanies,
  listMotions,
  listUsers,
  searchCompanies,
  setAccountDisposition,
  setProspectDisposition,
  updateCompany,
  updateMotion
} from "../../db/database.js";
import { dispositionValues } from "../../db/lifecycle-state.js";
import { browserProfileCapabilitySchema, browserProfileSchema } from "../../schema/browser-profile.js";
import { normalizeRepeatedStringList, normalizeStringList } from "../../lib/collections.js";
import { buildMotionQueueSummary, isMotionQueueStatus, withDerivedTargetAccountQueueState } from "../../lib/motion-queue.js";
import { findActionResultForTouch } from "../../lib/action-result-catalog.js";
import { companySchema } from "../../schema/company.js";
import { motionSchema } from "../../schema/motion.js";
import { linkedinProfileSnapshotSchema } from "../../schema/target-account.js";
import {
  buildLinkedinProfileUrlFromPublicId,
  extractLinkedinPublicId
} from "../../lib/prospect-contacts.js";

/**
 * @param {import("commander").Command} program
 */
export function registerCompanies(program) {
  const companies = program
    .command("companies")
    .description("Manage canonical companies and their linked motions.")
    .addHelpText(
      "after",
      `
Canonical companies interface:
  exo companies add
  exo companies list
  exo companies find <term>
  exo companies show <company-id>
  exo companies update <company-id>
  exo companies motions <company-id>
  exo companies research-brief <company-id>
  exo companies execution show <company-id>
  exo companies queue show <company-id>
  exo companies queue set <company-id>
  exo companies queue claim <company-id>
  exo companies queue complete <company-id>
  exo companies signal-matches show <company-id>
  exo companies signal-matches add <company-id>
  exo companies prospects show <company-id>
  exo companies prospects add <company-id>
  exo companies prospects update <company-id>
  exo companies prospects enrich-linkedin-profile <company-id>
  exo companies prospects claim <company-id>
  exo companies prospects complete <company-id>
  exo companies cadence show <company-id>
  exo companies cadence set <company-id>
  exo companies touches show <company-id>
  exo companies touches add <company-id>
  exo companies profile show <company-id>
  exo companies profile assign <company-id> --profile <profile-id>
  exo companies user show <company-id>
  exo companies user assign <company-id> --user <user-id>

Rules:
  - Keep the noun consistent. Use exo companies ..., not mixed singular/plural command paths.
  - A company is canonical identity. Motion linkage explains why it matters right now.
  - Once outreach starts, pin one execution user to the company so follow-up work stays consistent and governed connector resolution stays explicit.
  - Use exo companies research-brief before live account research so the agent works from signals, recent evidence, and best-fit prospect fallback.
  - Persist signal matches on the motion-owned target account, not on the canonical company itself.
  - Persist the chosen prospects and their cadence state on the same motion-owned target account.
  - Persist the real engagement touch history on the same prospect record so later draft cases can stay contextually grounded.
  - Treat stored signal matches, prospect identity/enrichment, cadence state, and touch history as the writing and engagement source of truth.
  - Richer motion-account state comes later; this surface is the first real company registry.
`
    );

  companies
    .command("add")
    .description("Add a canonical company record and optionally link it to motions.")
    .requiredOption("--name <name>", "Company name")
    .option("--domain <domain>", "Company domain")
    .option("--website-url <url>", "Company website URL")
    .option("--linkedin-company-url <url>", "LinkedIn company URL")
    .option("--logo-source-url <url>", "Source image URL for the company logo")
    .option("--tag <tag>", "Company tag", collect, [])
    .option("--motion <motion-id>", "Linked motion id", collect, [])
    .option("--notes <notes>", "Freeform notes")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies add --name Chainguard --domain chainguard.dev --motion <motion-id>
  exo companies add --name Procore --domain procore.com --tag public-company --tag construction

Notes:
  - Use this for manually-added strategic accounts until motion retrieval can populate companies directly.
  - Linked motion ids must already exist.
`
    )
    .action((options) => {
      for (const motionId of normalizeStringList(options.motion)) {
        if (!findMotionById(motionId)) {
          console.error(`Motion not found: ${motionId}`);
          process.exitCode = 1;
          return;
        }
      }

      const existing = findCompanyByIdentity(options.name, options.domain ?? null);
      if (existing) {
        const company = companySchema.parse(existing);
        console.error(`Company already exists: ${company.id} (${company.name})`);
        process.exitCode = 1;
        return;
      }

      const company = addCompany({
        name: options.name,
        domain: options.domain ?? null,
        websiteUrl: options.websiteUrl ?? null,
        linkedinCompanyUrl: options.linkedinCompanyUrl ?? null,
        logoSourceUrl: options.logoSourceUrl ?? null,
        notes: options.notes ?? null,
        tags: normalizeStringList(options.tag),
        motionIds: normalizeStringList(options.motion)
      });

      insertCompany(company);

      if (options.json) {
        console.log(JSON.stringify(company, null, 2));
        return;
      }

      console.log(renderCompanySummary(company));
    });

  companies
    .command("list")
    .description("List canonical companies.")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Use this command when a human or agent needs the current company registry.
`
    )
    .action((options) => {
      const companies = listCompanies().map((item) => companySchema.parse(item));

      if (options.json) {
        console.log(JSON.stringify(companies, null, 2));
        return;
      }

      console.log(renderCompanyList(companies));
    });

  companies
    .command("find")
    .description("Find companies by name or domain.")
    .argument("<term>", "Search term")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies find chainguard
  exo companies find procore.com --json
`
    )
    .action((term, options) => {
      const companies = searchCompanies(term).map((item) => companySchema.parse(item));

      if (options.json) {
        console.log(JSON.stringify(companies, null, 2));
        return;
      }

      console.log(renderCompanyList(companies));
    });

  const companyProfile = companies
    .command("profile")
    .description("Inspect or assign the sticky browser profile for a company.");

  const companyUser = companies
    .command("user")
    .description("Inspect or assign the sticky execution user for a company.");

  const companyExecution = companies
    .command("execution")
    .description("Resolve the exact execution identity and transport plan for one company capability.");

  companyProfile
    .command("assign")
    .description("Assign one registered browser profile to a company for sticky engagement identity.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--profile <profile-id>", "Browser profile identifier")
    .option("--by <actor>", "Who made the assignment")
    .option("--reason <reason>", "Why this profile is being assigned")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies profile assign <company-id> --profile <profile-id> --reason "Use Audienti identity for all prospect engagement"

Rules:
  - The profile must already be registered in Exo.
  - The profile must be ready before it can be assigned.
  - Once assigned, profile resolution for this company should stay sticky.
`
    )
    .action((companyId, options) => {
      const rawCompany = findCompanyById(companyId);
      if (!rawCompany) {
        console.error(`Company not found: ${companyId}`);
        process.exitCode = 1;
        return;
      }

      const rawProfile = findBrowserProfileById(options.profile);
      if (!rawProfile) {
        console.error(`Browser profile not found: ${options.profile}`);
        process.exitCode = 1;
        return;
      }

      const profile = browserProfileSchema.parse(rawProfile);
      if (profile.status !== "ready") {
        console.error(`Browser profile is not ready: ${profile.id} (${profile.status})`);
        process.exitCode = 1;
        return;
      }

      const updated = assignCompanyProfile(rawCompany, profile, {
        assignedBy: options.by ?? null,
        reason: options.reason ?? null
      });
      updateCompany(updated);

      if (options.json) {
        console.log(JSON.stringify(updated, null, 2));
        return;
      }

      console.log(renderCompanySummary(updated));
    });

  companyUser
    .command("assign")
    .description("Assign one execution user to a company so each capability can resolve through the right account.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--user <user-id>", "Execution user identifier")
    .option("--by <actor>", "Who made the assignment")
    .option("--reason <reason>", "Why this user is being assigned")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies user assign <company-id> --user <user-id> --reason "Use one human identity across LinkedIn and email"
  exo companies user assign <company-id> --user <user-id> --account linkedin:williamflanagan --account gmail:william@customer-a.com --reason "Assign William plus the correct inbox"

Rules:
  - The user must already exist in Exo.
  - The user can own multiple governed accounts across capabilities.
  - Use repeated --account capability:handle refs when one user owns more than one exact account for a capability, such as multiple Gmail inboxes.
  - Legacy browser-profile mappings are not projected into a governed execution path.
`
    )
    .option("--account <capability:handle>", "Assign one exact account ref for this assignment; repeat for multiple capabilities", collect, [])
    .action((companyId, options) => {
      const rawCompany = findCompanyById(companyId);
      if (!rawCompany) {
        console.error(`Company not found: ${companyId}`);
        process.exitCode = 1;
        return;
      }

      const rawUser = findUserById(options.user);
      if (!rawUser) {
        console.error(`User not found: ${options.user}`);
        process.exitCode = 1;
        return;
      }

      const updated = assignCompanyUser(rawCompany, rawUser, listBrowserProfiles(), {
        assignedBy: options.by ?? null,
        reason: options.reason ?? null,
        accountRefs: normalizeStringList(options.account)
      });
      updateCompany(updated);

      if (options.json) {
        console.log(JSON.stringify(updated, null, 2));
        return;
      }

      console.log(renderCompanySummary(updated));
    });

  companyExecution
    .command("show")
    .description("Show the resolved execution plan for one company capability.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--capability <capability>", "generic-web | linkedin | sales-navigator | gmail | hubspot")
    .option("--motion <motion-id>", "Honor a motion-level execution default when the company itself is not assigned")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies execution show <company-id> --capability linkedin
  exo companies execution show <company-id> --motion <motion-id> --capability linkedin
  exo companies execution show <company-id> --capability linkedin --json

Use this before live browser-backed work when you need one canonical answer to:
  - which user and profile are assigned to this company?
  - whether the company is inheriting its sticky identity from a motion default instead of a company assignment
  - which transport should I try first in this runtime?
  - what recovery pattern should I use if Chrome or the relay fails?
`
    )
    .action((companyId, options) => {
      const rawCompany = findCompanyById(companyId);
      if (!rawCompany) {
        console.error(`Company not found: ${companyId}`);
        process.exitCode = 1;
        return;
      }

      const company = companySchema.parse(rawCompany);
      const rawMotion = options.motion ? findMotionById(options.motion) : null;
      if (options.motion && !rawMotion) {
        console.error(`Motion not found: ${options.motion}`);
        process.exitCode = 1;
        return;
      }
      if (rawMotion && !company.motionIds.includes(rawMotion.id)) {
        console.error(`Company ${company.name} is not linked to motion ${rawMotion.id}.`);
        process.exitCode = 1;
        return;
      }

      const motion = rawMotion ? motionSchema.parse(rawMotion) : null;
      const rawUser = company.engagementUserAssignment
        ? findUserById(company.engagementUserAssignment.userId)
        : motion?.engagementUserAssignment
          ? findUserById(motion.engagementUserAssignment.userId)
          : null;
      const rawUsers = rawMotion || !rawUser
        ? listUsers()
        : [rawUser];
      const execution = buildCompanyExecutionView(rawCompany, rawUser, listBrowserProfiles(), {
        capability: browserProfileCapabilitySchema.parse(options.capability),
        rawMotion,
        rawUsers
      });

      if (options.json) {
        console.log(JSON.stringify(execution, null, 2));
        return;
      }

      console.log(renderCompanyExecutionPlan(execution));
    });

  companies
    .command("show")
    .description("Show one canonical company record with cross-motion rollup context.")
    .argument("<company-id>", "Company identifier")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies show <company-id>
  exo companies show <company-id> --json

This view rolls up linked motions, people, signals, and recent touch history while keeping the canonical company object at the top level.
`
    )
    .action((companyId, options) => {
      const raw = findCompanyById(companyId);
      if (!raw) {
        console.error(`Company not found: ${companyId}`);
        process.exitCode = 1;
        return;
      }

      const company = companySchema.parse(raw);
      const motions = loadCompanyLinkedMotions(company);
      const rollup = buildCompanyRollup(company, motions);

      if (options.json) {
        console.log(JSON.stringify({
          ...company,
          rollup
        }, null, 2));
        return;
      }

      console.log(renderCompanySummary(company, rollup));
    });

  companies
    .command("update")
    .description("Update a canonical company record in place.")
    .argument("<company-id>", "Company identifier")
    .option("--name <name>", "Company name")
    .option("--domain <domain>", "Company domain")
    .option("--website-url <url>", "Company website URL")
    .option("--linkedin-company-url <url>", "LinkedIn company URL")
    .option("--logo-source-url <url>", "Source image URL for the company logo")
    .option("--tag <tag>", "Replace company tags with the provided set", collect, [])
    .option("--motion <motion-id>", "Replace linked motion ids with the provided set", collect, [])
    .option("--notes <notes>", "Freeform notes")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies update <company-id> --website-url https://www.billease.ph --json
  exo companies update <company-id> --linkedin-company-url https://www.linkedin.com/company/billease --json

Rules:
  - Only the slices you pass are replaced.
  - Use this to store the canonical corporate website once research finds it.
`
    )
    .action((companyId, options) => {
      const raw = findCompanyById(companyId);
      if (!raw) {
        console.error(`Company not found: ${companyId}`);
        process.exitCode = 1;
        return;
      }

      const patch = {};

      if (options.name !== undefined) {
        patch.name = options.name;
      }
      if (options.domain !== undefined) {
        patch.domain = options.domain;
      }
      if (options.websiteUrl !== undefined) {
        patch.websiteUrl = options.websiteUrl;
      }
      if (options.linkedinCompanyUrl !== undefined) {
        patch.linkedinCompanyUrl = options.linkedinCompanyUrl;
      }
      if (options.logoSourceUrl !== undefined) {
        patch.logoSourceUrl = options.logoSourceUrl;
      }
      if (options.notes !== undefined) {
        patch.notes = options.notes;
      }
      if (options.tag.length) {
        patch.tags = normalizeStringList(options.tag);
      }
      if (options.motion.length) {
        const motionIds = normalizeStringList(options.motion);
        for (const motionId of motionIds) {
          if (!findMotionById(motionId)) {
            console.error(`Motion not found: ${motionId}`);
            process.exitCode = 1;
            return;
          }
        }
        patch.motionIds = motionIds;
      }

      const updated = updateCompanyRecord(raw, patch);
      updateCompany(updated);

      if (options.json) {
        console.log(JSON.stringify(updated, null, 2));
        return;
      }

      console.log(renderCompanySummary(updated));
    });

  const signalMatches = companies
    .command("signal-matches")
    .description("Inspect or add motion-specific signal matches for one company.");

  signalMatches
    .command("show")
    .description("Show stored motion-specific signal matches for one company.")
    .argument("<company-id>", "Company identifier")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies signal-matches show <company-id>
  exo companies signal-matches show <company-id> --motion <motion-id> --json

Use this when writing or follow-up logic needs the stored reason-to-talk evidence for a company.
`
    )
    .action((companyId, options) => {
      const rawCompany = findCompanyById(companyId);
      if (!rawCompany) {
        console.error(`Company not found: ${companyId}`);
        process.exitCode = 1;
        return;
      }

      const company = companySchema.parse(rawCompany);
      const selectedMotionId = resolveResearchMotionId(company, options.motion);
      if (!selectedMotionId) {
        process.exitCode = 1;
        return;
      }

      const rawMotion = findMotionById(selectedMotionId);
      if (!rawMotion) {
        console.error(`Motion not found: ${selectedMotionId}`);
        process.exitCode = 1;
        return;
      }

      const motion = motionSchema.parse(rawMotion);
      const account = motion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;
      const result = {
        company,
        motion: {
          id: motion.id,
          name: motion.name
        },
        account,
        signalMatches: account?.signalMatches ?? []
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!account || !account.signalMatches.length) {
        console.log(`No stored signal matches for ${company.name} in motion ${motion.name}.`);
        return;
      }

      console.log(
        [
          `Signal Matches: ${company.name}`,
          `Motion: ${motion.name}`,
          ...account.signalMatches.map((match) => {
            const subject = match.subject.type === "person"
              ? `${match.subject.personName ?? "unknown person"}${match.subject.personTitle ? ` (${match.subject.personTitle})` : ""}`
              : company.name;
            return `- ${match.id}  ${match.signalName} [${match.confidence}] on ${subject}: ${match.summary}${match.sourceUrl ? ` (${match.sourceUrl})` : ""}`;
          })
        ].join("\n")
      );
    });

  signalMatches
    .command("add")
    .description("Persist one motion-specific signal match for a company.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--signal <signal-id>", "Signal identifier from the motion")
    .requiredOption("--summary <text>", "Synthesized writer-ready signal line")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--source-url <url>", "Source URL for the evidence")
    .option("--source-label <label>", "Short source label")
    .option("--observed-at <datetime>", "Observed event timestamp in ISO-8601 format")
    .option("--confidence <level>", "Signal confidence: low, moderate, high, or unknown")
    .option("--evidence-snippet <text>", "Short evidence snippet or excerpt")
    .option("--notes <notes>", "Optional notes about this match")
    .option("--person-name <name>", "Person name for a person-scoped match")
    .option("--person-title <title>", "Person title for a person-scoped match")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies signal-matches add <company-id> --motion <motion-id> --signal <signal-id> --summary "Expanded in-store merchant acceptance through new POS integration" --source-url https://example.com/news
  exo companies signal-matches add <company-id> --motion <motion-id> --signal <signal-id> --summary "New Head of Risk joined" --person-name "Minh Le" --person-title "Head of Risk"

Rules:
  - Signal matches are motion-specific and are stored on the motion-owned target account.
  - Do not record every scrap of research. Only store the strongest recent signals you would actually use in writing.
  - --summary should be a synthesized, concise, writer-usable line, not a research dump or raw note.
  - Person-scoped signals require a person name or title.
  - Store the source URL and observed date whenever you have them. The writer will need them later.
`
    )
    .action((companyId, options) => {
      const rawCompany = findCompanyById(companyId);
      if (!rawCompany) {
        console.error(`Company not found: ${companyId}`);
        process.exitCode = 1;
        return;
      }

      const company = companySchema.parse(rawCompany);
      const selectedMotionId = resolveResearchMotionId(company, options.motion);
      if (!selectedMotionId) {
        process.exitCode = 1;
        return;
      }

      const rawMotion = findMotionById(selectedMotionId);
      if (!rawMotion) {
        console.error(`Motion not found: ${selectedMotionId}`);
        process.exitCode = 1;
        return;
      }

      try {
        const updatedMotion = recordMotionSignalMatch(rawMotion, company, {
          signalId: options.signal,
          summary: options.summary,
          sourceUrl: options.sourceUrl ?? null,
          sourceLabel: options.sourceLabel ?? null,
          observedAt: options.observedAt ?? null,
          confidence: normalizeConfidence(options.confidence),
          evidenceSnippet: options.evidenceSnippet ?? null,
          notes: options.notes ?? null,
          personName: options.personName ?? null,
          personTitle: options.personTitle ?? null
        });
        const storedMotion = updatedMotion;
        const account = storedMotion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;
        const result = {
          company,
          motion: {
            id: storedMotion.id,
            name: storedMotion.name
          },
          account,
          signalMatches: account?.signalMatches ?? []
        };

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (!account) {
          console.log(`No target-account state was stored for ${company.name}.`);
          return;
        }

        const newestMatch = account.signalMatches[account.signalMatches.length - 1];
        console.log(
          [
            `Recorded Signal Match: ${company.name}`,
            `Motion: ${storedMotion.name}`,
            `Signal: ${newestMatch.signalName}`,
            `Signal Match ID: ${newestMatch.id}`,
            `Writing Signal: ${newestMatch.summary}`,
            `Confidence: ${newestMatch.confidence}`,
            `Observed At: ${newestMatch.observedAt ?? "unknown"}`,
            `Source URL: ${newestMatch.sourceUrl ?? "none"}`
          ].join("\n")
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  const disposition = companies
    .command("disposition")
    .description("Set or reactivate a motion-account lifecycle disposition.");

  disposition
    .command("set")
    .description("Set the lifecycle disposition for one motion-linked account.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--motion <motion-id>", "Motion identifier for the account")
    .requiredOption("--disposition <disposition>", "Disposition: nurture, not_a_fit, no_longer_target, exhausted, or active")
    .requiredOption("--reason <reason>", "Reason for the disposition change")
    .option("--actor <actor>", "Disposition actor: operator, agent, or system", "operator")
    .option("--json", "Emit machine-readable JSON")
    .action((companyId, options) => {
      try {
        const result = setCompanyDispositionFromOptions(companyId, options);
        emitCompanyDispositionResult(result, options.json, "Updated Account Disposition");
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  disposition
    .command("reactivate")
    .description("Return one motion-linked account to active disposition.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--motion <motion-id>", "Motion identifier for the account")
    .option("--reason <reason>", "Reason for reactivation")
    .option("--actor <actor>", "Disposition actor: operator, agent, or system", "operator")
    .option("--json", "Emit machine-readable JSON")
    .action((companyId, options) => {
      try {
        const result = setCompanyDispositionFromOptions(companyId, {
          ...options,
          disposition: "active",
          reason: options.reason ?? "Reactivated by operator."
        });
        emitCompanyDispositionResult(result, options.json, "Reactivated Account");
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  const prospects = companies
    .command("prospects")
    .description("Inspect or add motion-specific prospects for one company.");

  prospects
    .command("show")
    .description("Show stored motion-specific prospects for one company.")
    .argument("<company-id>", "Company identifier")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--prospect <prospect-id>", "Specific prospect identifier")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies prospects show <company-id>
  exo companies prospects show <company-id> --motion <motion-id> --prospect <prospect-id> --json

Use this when the agent needs the chosen people of record before writing or browser-backed engagement.
`
    )
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) {
        process.exitCode = 1;
        return;
      }

      const { company, motion, account } = context;
      const selectedProspect = options.prospect
        ? account?.prospects.find((prospect) => prospect.id === options.prospect) ?? null
        : null;
      const result = {
        company,
        motion: {
          id: motion.id,
          name: motion.name,
          prospectTargetCount: motion.targetingProfile.stakeholderTargetCount
        },
        account,
        prospects: account?.prospects ?? [],
        prospect: selectedProspect
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!account || !account.prospects.length) {
        console.log(`No stored prospects for ${company.name} in motion ${motion.name}.`);
        return;
      }

      if (selectedProspect) {
        console.log(renderProspectDetail(company.name, motion.name, selectedProspect));
        return;
      }

      console.log(renderProspectList(company.name, motion.name, motion.targetingProfile.stakeholderTargetCount, account.prospects));
    });

  const prospectDisposition = prospects
    .command("disposition")
    .description("Set or reactivate one motion prospect lifecycle disposition.");

  prospectDisposition
    .command("set")
    .description("Set the lifecycle disposition for one motion prospect.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--motion <motion-id>", "Motion identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier")
    .requiredOption("--disposition <disposition>", "Disposition: nurture, not_a_fit, no_longer_target, exhausted, or active")
    .requiredOption("--reason <reason>", "Reason for the disposition change")
    .option("--actor <actor>", "Disposition actor: operator, agent, or system", "operator")
    .option("--json", "Emit machine-readable JSON")
    .action((companyId, options) => {
      try {
        const result = setProspectDispositionFromOptions(companyId, options);
        emitProspectDispositionResult(result, options.json, "Updated Prospect Disposition");
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  prospectDisposition
    .command("reactivate")
    .description("Return one motion prospect to active disposition.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--motion <motion-id>", "Motion identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier")
    .option("--reason <reason>", "Reason for reactivation")
    .option("--actor <actor>", "Disposition actor: operator, agent, or system", "operator")
    .option("--json", "Emit machine-readable JSON")
    .action((companyId, options) => {
      try {
        const result = setProspectDispositionFromOptions(companyId, {
          ...options,
          disposition: "active",
          reason: options.reason ?? "Reactivated by operator."
        });
        emitProspectDispositionResult(result, options.json, "Reactivated Prospect");
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  prospects
    .command("add")
    .description("Persist one chosen prospect on the motion-owned target account.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--name <name>", "Prospect name")
    .requiredOption("--title <title>", "Prospect title")
    .requiredOption("--why-relevant <text>", "Short reason this person matters for the motion")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--linkedin-profile-url <url>", "LinkedIn profile URL")
    .option("--avatar-source-url <url>", "Source image URL for the prospect avatar")
    .option("--email <email>", "Direct email when known")
    .option("--buying-committee-role <role>", "Buying committee role")
    .option("--decision-authority <authority>", "Decision authority: buys, blocks, sponsors, influences, observes, unknown")
    .option("--fit-confidence <level>", "Prospect fit confidence: low, moderate, high, or unknown")
    .option("--signal-match <signal-match-id>", "Supporting signal-match id; repeat for multiple", collect, [])
    .option("--source-url <url>", "Source URL for this prospect evidence")
    .option("--observed-at <datetime>", "Observed timestamp in ISO-8601 format")
    .option("--profile-viewed-at <datetime>", "When the profile was actually viewed in ISO-8601 format")
    .option("--role-description <text>", "Current role description text")
    .option("--role-summary <text>", "Role truth summary")
    .option("--operating-mode <text>", "Operating mode, for example building or leading")
    .option("--scope <text>", "Scope of responsibility, for example regional or global")
    .option("--role-evidence <text>", "Additional role-truth evidence; repeat for multiple", collect, [])
    .option("--trigger-summary <text>", "Trigger-window summary")
    .option("--tenure-months <number>", "Tenure in current role, in months")
    .option("--tenure-band <band>", "Tenure band: under-6-months, 6-to-24-months, 24-to-60-months, 60-plus-months, unknown")
    .option("--why-now-anchor <text>", "Best current why-now anchor for this person")
    .option("--person-trigger <text>", "Person-level trigger; repeat for multiple", collect, [])
    .option("--company-trigger <text>", "Company-level trigger; repeat for multiple", collect, [])
    .option("--identity-summary <text>", "Identity-tells summary")
    .option("--headline <text>", "Profile headline or tagline")
    .option("--about-quote <text>", "Quoted phrase from the profile or about section; repeat for multiple", collect, [])
    .option("--framework <text>", "Named framework; repeat for multiple", collect, [])
    .option("--certification <text>", "Certification or credential; repeat for multiple", collect, [])
    .option("--quantified-receipt <text>", "Quantified receipt; repeat for multiple", collect, [])
    .option("--self-image-verb <text>", "Self-image verb; repeat for multiple", collect, [])
    .option("--metaphor <text>", "Metaphor system; repeat for multiple", collect, [])
    .option("--active-channel <channel>", "Primary active channel seen in live signal evidence")
    .option("--activity-type <type>", "Live-signal activity type, for example own-post or reshare")
    .option("--live-signal-summary <text>", "Short synthesized summary of the most useful recent live signal")
    .option("--live-signal-url <url>", "URL for the recent activity or live signal")
    .option("--live-signal-observed-at <datetime>", "Observed timestamp for the live signal in ISO-8601 format")
    .option("--freshness-band <band>", "Freshness band: 0-14-days, 15-30-days, 31-60-days, 61-90-days, stale, unknown")
    .option("--hook-strength <level>", "Live-signal hook strength: low, moderate, high, or unknown")
    .option("--engagement-rationale <text>", "Why the live signal matters for legitimate engagement")
    .option("--contact-point <json>", "Structured contact point JSON; repeat for multiple", collect, [])
    .option("--enrichment-status <status>", "Contact enrichment status: pending, in_progress, complete, exhausted")
    .option("--source-tried <source>", "Enrichment source attempted; repeat for multiple", collect, [])
    .option("--missing-channel <channel>", "Still-missing contact channel; repeat for multiple", collect, [])
    .option("--best-direct-channel <channel>", "Best direct channel currently available; repeat for multiple", collect, [])
    .option("--last-enriched-at <datetime>", "Last contact-enrichment timestamp in ISO-8601 format")
    .option("--enrichment-notes <notes>", "Contact-enrichment notes")
    .option("--queue-status <status>", "Prospect queue status: discovered, queued_for_research, researched, selected, ready, suppressed, exhausted")
    .option("--queue-notes <notes>", "Prospect queue notes")
    .option("--pre-connect-bypass-reason <text>", "Why a high-signal direct connection request should bypass public warmup")
    .option("--clear-pre-connect-decision", "Clear a stored manual pre-connect decision")
    .option("--notes <notes>", "Optional notes")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies prospects add <company-id> --motion <motion-id> --name "Minh Le" --title "Head of Risk" --buying-committee-role primary_business_owner --decision-authority influences --why-relevant "Best-fit owner for the LenderLink and decisioning-complexity story"
  exo companies prospects add <company-id> --motion <motion-id> --name "Jared Barreda" --title "Head of Collections Analytics" --signal-match <signal-match-id> --email jared@example.com --profile-viewed-at 2026-05-26T16:00:00.000Z --active-channel linkedin --activity-type own-post --live-signal-summary "Recent post on merchant-growth analytics suggests active LinkedIn use." --live-signal-url https://www.linkedin.com/posts/example --engagement-rationale "Recent public posting is positive evidence this channel is live enough for legitimate engagement." --why-relevant "Expanded product surfaces create downstream monitoring pressure"
  exo companies prospects add <company-id> --motion <motion-id> --name "Jared Barreda" --title "Head of Collections Analytics" --why-relevant "Expanded merchant and borrower coverage creates monitoring and segmentation pressure downstream." --contact-point '{"kind":"x_profile","value":"https://x.com/jaredrisk","matchStatus":"same_person_probable","verificationStatus":"observed","confidence":"moderate","source":"public-web","usableForResearch":true,"usableForWarmup":true}'

Rules:
  - Prospects are motion-specific and live on the motion-owned target account.
  - Keep the chosen set tight. The motion's stakeholderTargetCount is enforced here.
  - Store why this person matters now, not just a title scrape.
  - Link the prospect to the strongest supporting signal matches when you have them.
  - If you view the profile, write that back. Do not assume it happened.
  - Store only the strongest recent live signal that changes how you would reach out.
  - If you find a direct email, store it so the motion has a fallback when LinkedIn is blocked or cold.
  - Use structured contact points to store additional socials, phones, weak hints, and rejected candidates instead of flattening everything into one email field.
`
    )
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) {
        process.exitCode = 1;
        return;
      }

      const { company, rawMotion } = context;

      try {
        const storedMotion = recordMotionProspect(rawMotion, company, buildProspectInputFromOptions(options));
        const account = storedMotion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;
        const result = {
          company,
          motion: {
            id: storedMotion.id,
            name: storedMotion.name,
            prospectTargetCount: storedMotion.targetingProfile.stakeholderTargetCount
          },
          account,
          prospects: account?.prospects ?? []
        };

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const storedProspect = account?.prospects.find((prospect) => {
          if (options.linkedinProfileUrl && prospect.linkedinProfileUrl) {
            return prospect.linkedinProfileUrl === options.linkedinProfileUrl;
          }

          return prospect.name === options.name && prospect.title === options.title;
        });

        if (!storedProspect) {
          console.log(`No prospect state was stored for ${company.name}.`);
          return;
        }

        console.log(
          [
            `Recorded Prospect: ${company.name}`,
            `Motion: ${storedMotion.name}`,
            `Person: ${storedProspect.name}`,
            `Prospect ID: ${storedProspect.id}`,
            `Title: ${storedProspect.title}`,
            `Buying Committee Role: ${storedProspect.buyingCommitteeRole}`,
            `Decision Authority: ${storedProspect.decisionAuthority}`,
            `Why Relevant: ${storedProspect.whyRelevant}`,
            `Email: ${storedProspect.email ?? "none"}`,
            `Profile Viewed: ${storedProspect.profileViewedAt ?? "not recorded"}`,
            `Live Signal: ${storedProspect.liveSignal.summary ?? "none"}`,
            `Contact Points: ${storedProspect.contactPoints.length}`,
            `Contact Enrichment: ${storedProspect.contactEnrichmentState.status}`,
            `Queue: ${storedProspect.queueState.status}`
          ].join("\n")
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  prospects
    .command("update")
    .description("Update one existing motion-specific prospect by prospect id.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier to update")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--name <name>", "Prospect name")
    .option("--title <title>", "Prospect title")
    .option("--why-relevant <text>", "Short reason this person matters for the motion")
    .option("--linkedin-profile-url <url>", "LinkedIn profile URL")
    .option("--avatar-source-url <url>", "Source image URL for the prospect avatar")
    .option("--email <email>", "Direct email when known")
    .option("--buying-committee-role <role>", "Buying committee role")
    .option("--decision-authority <authority>", "Decision authority: buys, blocks, sponsors, influences, observes, unknown")
    .option("--fit-confidence <level>", "Prospect fit confidence: low, moderate, high, or unknown")
    .option("--signal-match <signal-match-id>", "Supporting signal-match id; repeat for multiple", collect, [])
    .option("--source-url <url>", "Source URL for this prospect evidence")
    .option("--observed-at <datetime>", "Observed timestamp in ISO-8601 format")
    .option("--profile-viewed-at <datetime>", "When the profile was actually viewed in ISO-8601 format")
    .option("--role-description <text>", "Current role description text")
    .option("--role-summary <text>", "Role truth summary")
    .option("--operating-mode <text>", "Operating mode, for example building or leading")
    .option("--scope <text>", "Scope of responsibility, for example regional or global")
    .option("--role-evidence <text>", "Additional role-truth evidence; repeat for multiple", collect, [])
    .option("--trigger-summary <text>", "Trigger-window summary")
    .option("--tenure-months <number>", "Tenure in current role, in months")
    .option("--tenure-band <band>", "Tenure band: under-6-months, 6-to-24-months, 24-to-60-months, 60-plus-months, unknown")
    .option("--why-now-anchor <text>", "Best current why-now anchor for this person")
    .option("--person-trigger <text>", "Person-level trigger; repeat for multiple", collect, [])
    .option("--company-trigger <text>", "Company-level trigger; repeat for multiple", collect, [])
    .option("--identity-summary <text>", "Identity-tells summary")
    .option("--headline <text>", "Profile headline or tagline")
    .option("--about-quote <text>", "Quoted phrase from the profile or about section; repeat for multiple", collect, [])
    .option("--framework <text>", "Named framework; repeat for multiple", collect, [])
    .option("--certification <text>", "Certification or credential; repeat for multiple", collect, [])
    .option("--quantified-receipt <text>", "Quantified receipt; repeat for multiple", collect, [])
    .option("--self-image-verb <text>", "Self-image verb; repeat for multiple", collect, [])
    .option("--metaphor <text>", "Metaphor system; repeat for multiple", collect, [])
    .option("--active-channel <channel>", "Primary active channel seen in live signal evidence")
    .option("--activity-type <type>", "Live-signal activity type, for example own-post or reshare")
    .option("--live-signal-summary <text>", "Short synthesized summary of the most useful recent live signal")
    .option("--live-signal-url <url>", "URL for the recent activity or live signal")
    .option("--live-signal-observed-at <datetime>", "Observed timestamp for the live signal in ISO-8601 format")
    .option("--freshness-band <band>", "Freshness band: 0-14-days, 15-30-days, 31-60-days, 61-90-days, stale, unknown")
    .option("--hook-strength <level>", "Live-signal hook strength: low, moderate, high, or unknown")
    .option("--engagement-rationale <text>", "Why the live signal matters for legitimate engagement")
    .option("--contact-point <json>", "Structured contact point JSON; repeat for multiple", collect, [])
    .option("--enrichment-status <status>", "Contact enrichment status: pending, in_progress, complete, exhausted")
    .option("--source-tried <source>", "Enrichment source attempted; repeat for multiple", collect, [])
    .option("--missing-channel <channel>", "Still-missing contact channel; repeat for multiple", collect, [])
    .option("--best-direct-channel <channel>", "Best direct channel currently available; repeat for multiple", collect, [])
    .option("--last-enriched-at <datetime>", "Last contact-enrichment timestamp in ISO-8601 format")
    .option("--enrichment-notes <notes>", "Contact-enrichment notes")
    .option("--queue-status <status>", "Prospect queue status: discovered, queued_for_research, researched, selected, ready, suppressed, exhausted")
    .option("--queue-notes <notes>", "Prospect queue notes")
    .option("--pre-connect-bypass-reason <text>", "Why a high-signal direct connection request should bypass public warmup")
    .option("--clear-pre-connect-decision", "Clear a stored manual pre-connect decision")
    .option("--notes <notes>", "Optional notes")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies prospects update <company-id> --motion <motion-id> --prospect <prospect-id> --email minh@example.com --source-url https://example.com/profile --observed-at 2026-05-28T10:00:00.000Z --json
  exo companies prospects update <company-id> --motion <motion-id> --prospect <prospect-id> --live-signal-summary "Recent post confirms active LinkedIn use." --live-signal-url https://www.linkedin.com/posts/example --freshness-band 0-14-days --json
  exo companies prospects update <company-id> --motion <motion-id> --prospect <prospect-id> --contact-point '{"kind":"reddit_profile","value":"https://www.reddit.com/u/example","matchStatus":"same_person_possible","verificationStatus":"observed","confidence":"low","source":"public-web","usableForResearch":true,"usableForWarmup":false}' --enrichment-status exhausted --source-tried gmail --source-tried public-web --missing-channel email --json

Rules:
  - Use this when the prospect already exists and you are enriching or correcting that exact person.
  - Prefer updating by prospect id over re-adding a person when contact enrichment or live-surface checks produce new evidence.
  - This path preserves the existing prospect record and its cadence state, enrichment, and touches.
  - Structured contact points are the place for additional socials, phones, direct emails, weak hints, and rejected candidates.
`
    )
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) {
        process.exitCode = 1;
        return;
      }

      const { company, rawMotion } = context;

      try {
        const storedMotion = updateMotionProspect(rawMotion, company, {
          prospectId: options.prospect,
          ...buildProspectInputFromOptions(options)
        });
        const account = storedMotion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;
        const storedProspect = account?.prospects.find((prospect) => prospect.id === options.prospect) ?? null;

        if (options.json) {
          console.log(JSON.stringify({
            company,
            motion: {
              id: storedMotion.id,
              name: storedMotion.name,
              prospectTargetCount: storedMotion.targetingProfile.stakeholderTargetCount
            },
            account,
            prospects: account?.prospects ?? [],
            prospect: storedProspect
          }, null, 2));
          return;
        }

        if (!storedProspect) {
          console.log(`No prospect state was stored for ${company.name}.`);
          return;
        }

        console.log(
          [
            `Updated Prospect: ${company.name}`,
            `Motion: ${storedMotion.name}`,
            `Person: ${storedProspect.name}`,
            `Prospect ID: ${storedProspect.id}`,
            `Title: ${storedProspect.title}`,
            `Buying Committee Role: ${storedProspect.buyingCommitteeRole}`,
            `Decision Authority: ${storedProspect.decisionAuthority}`,
            `Why Relevant: ${storedProspect.whyRelevant}`,
            `Email: ${storedProspect.email ?? "none"}`,
            `Profile Viewed: ${storedProspect.profileViewedAt ?? "not recorded"}`,
            `Live Signal: ${storedProspect.liveSignal.summary ?? "none"}`,
            `Contact Points: ${storedProspect.contactPoints.length}`,
            `Contact Enrichment: ${storedProspect.contactEnrichmentState.status}`,
            `Queue: ${storedProspect.queueState.status}`
          ].join("\n")
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  prospects
    .command("enrich-linkedin-profile")
    .description("Persist one governed LinkedIn profile-page enrichment payload onto an existing prospect.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--prospect <prospect-id>", "Existing prospect identifier")
    .requiredOption("--input <path>", "Path to a LinkedIn profile enrichment JSON file, or - to read JSON from stdin")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies prospects enrich-linkedin-profile <company-id> --motion <motion-id> --prospect <prospect-id> --input ./linkedin-profile.json --json

Rules:
  - Use this after the agent has opened the real LinkedIn profile page and captured one governed snapshot.
  - The payload should carry stable profile identity, avatar, and recent-post evidence from that page.
  - This path replaces the stored LinkedIn recent-post snapshot for that prospect in one write, then promotes the strongest captured post into liveSignal.
  - Do not use this for generic note-taking. It is the governed writeback path for live LinkedIn profile context.
`
    )
    .action(async (companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) {
        process.exitCode = 1;
        return;
      }

      const { company, rawMotion } = context;

      try {
        const payload = parseLinkedinProfileEnrichmentPayload(loadJsonInput(options.input));
        const recentPosts = Array.isArray(payload.recentPosts) ? payload.recentPosts.slice(0, 5) : [];
        const linkedinProfileUrl = payload.profileUrl ?? buildLinkedinProfileUrlFromPublicId(payload.publicId);
        const publicId = payload.publicId ?? extractLinkedinPublicId(linkedinProfileUrl);
        const sourceUrl = linkedinProfileUrl ?? payload.profileUrl ?? null;
        const contactPoints = buildLinkedinProfileEnrichmentContactPoints({
          publicId,
          memberId: payload.memberId,
          observedAt: payload.capturedAt,
          sourceUrl
        });
        const existingAccount = (rawMotion.targetMap?.accounts ?? []).find((item) => item.companyId === company.id) ?? null;
        const existingProspect = existingAccount?.prospects.find((prospect) => prospect.id === options.prospect) ?? null;
        const primaryPost = selectPrimaryLinkedinRecentPost(recentPosts);
        const publicEngagementSelection = selectLinkedinPublicEngagementTarget({
          ...existingProspect,
          linkedinProfileSnapshot: {
            ...(existingProspect?.linkedinProfileSnapshot ?? {}),
            recentPosts,
          },
        });

        const storedMotion = updateMotionProspect(rawMotion, company, {
          prospectId: options.prospect,
          name: payload.displayName ?? undefined,
          title: payload.currentRoleTitle ?? undefined,
          linkedinProfileUrl,
          avatarSourceUrl: payload.avatarSourceUrl ?? undefined,
          sourceUrl: sourceUrl ?? undefined,
          observedAt: payload.capturedAt ?? undefined,
          profileViewedAt: payload.capturedAt ?? undefined,
          identityTells: {
            headline: payload.headline ?? undefined
          },
          linkedinProfileSnapshot: {
            capturedAt: payload.capturedAt,
            profileUrl: linkedinProfileUrl,
            avatarSourceUrl: payload.avatarSourceUrl,
            avatarChecked: payload.avatarChecked,
            publicId,
            memberId: payload.memberId,
            displayName: payload.displayName,
            currentRoleTitle: payload.currentRoleTitle,
            currentCompanyName: payload.currentCompanyName,
            headline: payload.headline,
            location: payload.location,
            about: payload.about,
            followerCount: payload.followerCount,
            connectionCount: payload.connectionCount,
            isPremium: payload.isPremium,
            isOpenProfile: payload.isOpenProfile,
            connectionDegree: payload.connectionDegree,
            recentPosts
          },
          liveSignal: primaryPost
            ? {
                channel: "linkedin",
                activityType: primaryPost.activityType ?? undefined,
                summary: primaryPost.summary ?? primaryPost.snippet ?? undefined,
                url: primaryPost.url ?? undefined,
                observedAt: primaryPost.postedAt ?? payload.capturedAt ?? undefined,
                freshnessBand:
                  primaryPost.freshnessBand
                  ?? deriveFreshnessBand(primaryPost.postedAt, payload.capturedAt)
                  ?? undefined,
                engagementRationale: "Recent public LinkedIn activity was captured directly from the live profile page."
              }
            : undefined,
          publicEngagementSelection: publicEngagementSelection
            ? {
                url: publicEngagementSelection.targetUrl,
                targetKind: publicEngagementSelection.targetKind,
                activityType: publicEngagementSelection.activityType ?? undefined,
                postedAt: publicEngagementSelection.postedAt ?? undefined,
                freshnessBand: publicEngagementSelection.freshnessBand ?? undefined,
                summary: publicEngagementSelection.summary ?? undefined,
                snippet: publicEngagementSelection.snippet ?? undefined,
                businessRelevance: publicEngagementSelection.businessRelevance ?? undefined,
                recommendedAction: publicEngagementSelection.recommendedAction ?? undefined,
                rationale: publicEngagementSelection.rationale ?? undefined,
                selectionReason: publicEngagementSelection.selectionReason ?? undefined,
                selectedAt: payload.capturedAt ?? undefined,
              }
            : null,
          contactPoints: contactPoints.length ? contactPoints : undefined
        });
        const account = storedMotion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;
        const storedProspect = account?.prospects.find((prospect) => prospect.id === options.prospect) ?? null;
        // Warm the freshly-captured avatar through the proxy now, while the
        // LinkedIn source URL is still valid, so it stays displayable later.
        await warmImageProxy(storedProspect?.avatarUrl);

        if (options.json) {
          console.log(JSON.stringify({
            company,
            motion: {
              id: storedMotion.id,
              name: storedMotion.name,
              prospectTargetCount: storedMotion.targetingProfile.stakeholderTargetCount
            },
            account,
            prospects: account?.prospects ?? [],
            prospect: storedProspect
          }, null, 2));
          return;
        }

        if (!storedProspect) {
          console.log(`No prospect state was stored for ${company.name}.`);
          return;
        }

        console.log(
          [
            `Enriched LinkedIn Profile: ${company.name}`,
            `Motion: ${storedMotion.name}`,
            `Person: ${storedProspect.name}`,
            `Prospect ID: ${storedProspect.id}`,
            `LinkedIn Profile: ${storedProspect.linkedinProfileUrl ?? "none"}`,
            `Recent Posts Stored: ${storedProspect.linkedinProfileSnapshot.recentPosts.length}`,
            `Live Signal: ${storedProspect.liveSignal.summary ?? "none"}`
          ].join("\n")
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  prospects
    .command("enrich-linkedin-profile-live")
    .description("Build the governed live LinkedIn profile-page capture contract for one existing prospect.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--prospect <prospect-id>", "Existing prospect identifier")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--runtime <runtime>", "Runtime to target, for example codex")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies prospects enrich-linkedin-profile-live <company-id> --motion <motion-id> --prospect <prospect-id> --runtime codex --json

Rules:
  - Use this when the outer agent should inspect the live LinkedIn profile page and land the governed profile payload directly into Exo.
  - This command does not mutate prospect state by itself. It returns the capture contract, output schema, and payload writeback command.
  - The target profile URL must already be derivable from the prospect record or its stored LinkedIn aliases.
`
    )
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) {
        process.exitCode = 1;
        return;
      }

      try {
        const result = buildLiveLinkedinProfileEnrichmentView(
          context.company,
          context.rawMotion,
          listBrowserProfiles(),
          listUsers(),
          {
            prospectId: options.prospect,
            runtime: options.runtime ?? null
          }
        );

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const captureRequest = result.transport.captureRequest;
        console.log(
          [
            `LinkedIn Profile Capture: ${result.company.name}`,
            `Motion: ${result.motion?.name ?? "none"}`,
            `Prospect: ${result.prospect.name} (${result.prospect.title})`,
            `Target URL: ${result.prospect.linkedinProfileUrl ?? "none"}`,
            `Transport: ${result.transport.kind}`,
            `Reason: ${result.transport.reason ?? "none"}`,
            `Payload Command: ${captureRequest?.buildPayloadCommand ?? "none"}`
          ].join("\n")
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  prospects
    .command("claim")
    .description("Claim one selected prospect packet for deeper research, enrichment, and branch synthesis work.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier to claim")
    .requiredOption("--worker <label>", "Worker label claiming this packet")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--notes <notes>", "Claim notes")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies prospects claim <company-id> --motion <motion-id> --prospect <prospect-id> --worker codex-prospect-1 --json

Rules:
  - Claim this only after the account-level prospect-selection packet is done.
  - This packet is for one selected prospect and should keep that person's research, enrichment, and cadence work together.
  - Use a stable worker label so retries and completion checks stay safe.
`
    )
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) {
        process.exitCode = 1;
        return;
      }

      const { company, rawMotion } = context;

      try {
        const storedMotion = claimMotionProspectPacket(rawMotion, company, {
          prospectId: options.prospect,
          workerLabel: options.worker,
          notes: options.notes ?? null
        });
        const account = storedMotion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;
        const prospect = account?.prospects.find((item) => item.id === options.prospect) ?? null;

        if (options.json) {
          console.log(JSON.stringify({
            company,
            motion: {
              id: storedMotion.id,
              name: storedMotion.name
            },
            account,
            prospect
          }, null, 2));
          return;
        }

        if (!prospect) {
          console.log(`No prospect packet was claimed for ${company.name}.`);
          return;
        }

        console.log(
          [
            `Claimed Prospect Packet: ${company.name}`,
            `Motion: ${storedMotion.name}`,
            `Prospect: ${prospect.name}`,
            `Prospect ID: ${prospect.id}`,
            `Packet: ${prospect.packetState?.kind ?? "none"} [${prospect.packetState?.status ?? "none"}]`,
            `Worker: ${prospect.packetState?.workerLabel ?? "none"}`,
            `Queue: ${prospect.queueState.status}`
          ].join("\n")
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  prospects
    .command("complete")
    .description("Complete one claimed prospect packet and release it back into the queue or terminal state.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier to complete")
    .option("--worker <label>", "Worker label expected to own this packet")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--next-status <status>", "Optional terminal override: suppressed or exhausted")
    .option("--notes <notes>", "Completion notes")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies prospects complete <company-id> --motion <motion-id> --prospect <prospect-id> --worker codex-prospect-1 --json
  exo companies prospects complete <company-id> --motion <motion-id> --prospect <prospect-id> --worker codex-prospect-1 --next-status exhausted --json

Rules:
  - Completing a prospect packet does not magically make the branch ready. The stored cadence and queue state still have to support readiness.
  - If the packet is completed but the prospect is still selected, it should naturally return to the claimable backlog.
  - Use terminal overrides only when the prospect should be suppressed or exhausted.
  - A no-channel prospect cannot be completed into exhausted until governed connected-account LinkedIn search was attempted and recorded as --source-tried linkedin_connected_search on the prospect enrichment state.
`
    )
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) {
        process.exitCode = 1;
        return;
      }

      const nextStatus = normalizeProspectPacketNextStatus(options.nextStatus);
      if (options.nextStatus && !nextStatus) {
        console.error(`Invalid prospect packet next status: ${options.nextStatus}`);
        process.exitCode = 1;
        return;
      }

      const { company, rawMotion } = context;

      try {
        const updatedMotion = completeMotionProspectPacket(rawMotion, company, {
          prospectId: options.prospect,
          workerLabel: options.worker ?? null,
          nextStatus,
          notes: options.notes ?? null
        });
        const storedMotion = updatedMotion;
        const account = storedMotion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;
        const prospect = account?.prospects.find((item) => item.id === options.prospect) ?? null;

        if (options.json) {
          console.log(JSON.stringify({
            company,
            motion: {
              id: storedMotion.id,
              name: storedMotion.name
            },
            account,
            prospect
          }, null, 2));
          return;
        }

        if (!prospect) {
          console.log(`No prospect packet was completed for ${company.name}.`);
          return;
        }

        console.log(
          [
            `Completed Prospect Packet: ${company.name}`,
            `Motion: ${storedMotion.name}`,
            `Prospect: ${prospect.name}`,
            `Prospect ID: ${prospect.id}`,
            `Packet: ${prospect.packetState?.kind ?? "none"} [${prospect.packetState?.status ?? "none"}]`,
            `Queue: ${prospect.queueState.status}`
          ].join("\n")
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  const draft = prospects
    .command("draft")
    .description("Write, review, approve, and complete one prospect message draft (agent ↔ operator compose loop).");

  draft
    .command("set")
    .description("Write (or update) a draft message for one prospect surface. This is how the core agent supplies the pre-written text.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier")
    .requiredOption("--surface <surface>", "Draft surface: connection_request, post_accept_message, follow_up_direct_message, email, in_mail_message, inbound_reply, public_comment, comment_reply")
    .requiredOption("--body <text>", "Draft body the agent wrote")
    .option("--subject <text>", "Subject line (email / in_mail only)")
    .option("--notes <notes>", "Optional draft notes")
    .option("--motion <motion-id>", "Motion identifier when the company is in more than one motion")
    .option("--status <status>", "drafting | ready | queued (default ready)")
    .option("--json", "Emit machine-readable JSON")
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) return;
      try {
        if (isSendableDraftStatus(options.status ?? "ready")) {
          const brief = buildMotionDraftBrief(context.rawMotion, {
            companyId,
            prospectId: options.prospect,
            surface: options.surface,
          });
          if (brief.surface.available === false) {
            throw new Error(brief.surface.missingReason ?? `Surface ${options.surface} is not currently writeable for this prospect.`);
          }
        }
        const stored = setMotionProspectDraft(context.rawMotion, context.company, {
          prospectId: options.prospect,
          surface: options.surface,
          body: options.body,
          subject: options.subject ?? null,
          status: options.status ?? "ready",
          notes: options.notes ?? null,
        });
        emitDraft(stored, companyId, options.prospect, options.surface, options.json, "Draft stored");
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  draft
    .command("approve")
    .description("Approve a draft (optionally with operator edits) — queues it for the agent to send.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier")
    .requiredOption("--surface <surface>", "Draft surface")
    .requiredOption("--body <text>", "Final (possibly edited) body")
    .option("--subject <text>", "Final subject (email / in_mail only)")
    .option("--motion <motion-id>", "Motion identifier")
    .option("--json", "Emit machine-readable JSON")
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) return;
      try {
        const stored = approveMotionProspectDraft(context.rawMotion, context.company, {
          prospectId: options.prospect,
          surface: options.surface,
          body: options.body,
          subject: options.subject ?? null,
        });
        emitDraft(stored, companyId, options.prospect, options.surface, options.json, "Draft approved — queued for send");
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  draft
    .command("sent")
    .description("Mark a send-ready draft as sent (call after the agent actually sends it).")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier")
    .requiredOption("--surface <surface>", "Draft surface")
    .option("--motion <motion-id>", "Motion identifier")
    .option("--json", "Emit machine-readable JSON")
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) return;
      try {
        const stored = markMotionProspectDraftSent(context.rawMotion, context.company, {
          prospectId: options.prospect,
          surface: options.surface,
        });
        emitDraft(stored, companyId, options.prospect, options.surface, options.json, "Draft marked sent");
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  draft
    .command("pending")
    .description("List send-ready drafts queued for the agent to send across all motions.")
    .option("--json", "Emit machine-readable JSON")
    .action((options) => {
      const queued = [];
      for (const rawMotion of listMotions()) {
        const motion = motionSchema.parse(rawMotion);
        for (const account of motion.targetMap.accounts) {
          for (const prospect of account.prospects) {
            for (const d of prospect.drafts ?? []) {
              if (isAutonomousSendReadyDraft(d)) {
                queued.push({
                  motionId: motion.id,
                  motionName: motion.name,
                  companyId: account.companyId,
                  companyName: account.companyName,
                  prospectId: prospect.id,
                  prospectName: prospect.name,
                  surface: d.surface,
                  channel: d.channel,
                  subject: d.subject,
                  body: d.body,
                  status: d.status,
                  editedByOperator: d.editedByOperator,
                  approvedAt: d.approvedAt,
                });
              }
            }
          }
        }
      }
      if (options.json) {
        console.log(JSON.stringify({ count: queued.length, drafts: queued }, null, 2));
        return;
      }
      if (!queued.length) {
        console.log("No drafts are queued for send.");
        return;
      }
        console.log(`${queued.length} draft(s) queued for send:`);
      for (const d of queued) {
        console.log(`  ${d.prospectName} · ${d.surface} (${d.channel})${d.subject ? ` · "${d.subject}"` : ""}${d.editedByOperator ? " · edited" : ""}${d.status === "approved" ? " · operator-approved" : " · operator-queued"}`);
      }
    });

  const cadence = companies
    .command("cadence")
    .description("Inspect or set stored prospect cadence state for one company in one motion.");

  cadence
    .command("show")
    .description("Show stored cadence state for one prospect.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--json", "Emit machine-readable JSON")
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) {
        process.exitCode = 1;
        return;
      }

      const { company, motion, account } = context;
      const prospect = account?.prospects.find((item) => item.id === options.prospect) ?? null;
      const result = {
        company,
        motion: { id: motion.id, name: motion.name },
        prospect,
        cadence: prospect?.cadenceState ?? null
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!prospect || prospect.cadenceState.status !== "ready") {
        console.log(`No stored cadence state for prospect ${options.prospect} on ${company.name} in motion ${motion.name}.`);
        return;
      }

      console.log(renderCadenceDetail(company.name, motion.name, prospect));
    });

  cadence
    .command("set")
    .description("Persist cadence state for one prospect.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--current-step <step>", "Cadence step: connection-request, direct-message, inmail, value-add-email, quarterly-retouch, done")
    .option("--last-touch-channel <channel>", "Last touch channel")
    .option("--last-touch-outcome <outcome>", "Last touch outcome: pending, sent, accepted, ignored, opened-no-reply, replied, blocked, nurture")
    .option("--last-touch-at <datetime>", "When the last touch happened")
    .option("--next-action <text>", "Next action to take")
    .option("--next-action-due-at <datetime>", "When the next action is due")
    .option("--blocked-channel <channel>", "Blocked channel; repeat for multiple", collect, [])
    .option("--require-new-hook", "Require a new hook before the next touch")
    .option("--notes <notes>", "Optional notes")
    .option("--json", "Emit machine-readable JSON")
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) {
        process.exitCode = 1;
        return;
      }

      const { company, rawMotion } = context;

      try {
        const storedMotion = setMotionProspectCadence(rawMotion, company, {
          prospectId: options.prospect,
          currentStep: normalizeCadenceStep(options.currentStep),
          lastTouchChannel: normalizeOutreachChannel(options.lastTouchChannel),
          lastTouchOutcome: normalizeCadenceOutcome(options.lastTouchOutcome),
          lastTouchAt: options.lastTouchAt,
          nextAction: options.nextAction,
          nextActionDueAt: options.nextActionDueAt,
          blockedChannels: normalizeStringList(options.blockedChannel),
          requireNewHook: options.requireNewHook ? true : undefined,
          notes: options.notes
        });
        const account = storedMotion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;
        const prospect = account?.prospects.find((item) => item.id === options.prospect) ?? null;
        const result = {
          company,
          motion: { id: storedMotion.id, name: storedMotion.name },
          prospect,
          cadence: prospect?.cadenceState ?? null
        };

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (!prospect || prospect.cadenceState.status !== "ready") {
          console.log(`No cadence state was stored for prospect ${options.prospect}.`);
          return;
        }

        console.log(renderCadenceDetail(company.name, storedMotion.name, prospect));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  const touches = companies
    .command("touches")
    .description("Inspect or append stored prospect touch history for one company in one motion.");

  touches
    .command("show")
    .description("Show stored touch history for one prospect.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--json", "Emit machine-readable JSON")
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) {
        process.exitCode = 1;
        return;
      }

      const { company, motion, account } = context;
      const prospect = account?.prospects.find((item) => item.id === options.prospect) ?? null;
      const result = {
        company,
        motion: { id: motion.id, name: motion.name },
        prospect,
        touches: prospect?.touches ?? []
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!prospect) {
        console.log(`No stored prospect ${options.prospect} on ${company.name} in motion ${motion.name}.`);
        return;
      }

      console.log(renderTouchList(company.name, motion.name, prospect));
    });

  touches
    .command("add")
    .description("Append one stored touchpoint to a motion prospect.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier")
    .requiredOption("--surface <surface>", "Touch surface: connection_request, post_accept_message, follow_up_direct_message, email, inbound_reply, public_comment, comment_reply, profile_view, follow, unfollow, like_post, unlike_post, share_post, in_mail_message, withdraw_connection, accept_connection, decline_connection, create_comment_reaction, voicemail_outreach, or video_outreach")
    .requiredOption("--direction <direction>", "Touch direction: outbound, inbound, or system")
    .requiredOption("--outcome <outcome>", "Touch outcome: pending, sent, accepted, ignored, opened-no-reply, replied, blocked, or nurture")
    .requiredOption("--occurred-at <datetime>", "When the touch happened")
    .requiredOption("--summary <text>", "Short summary of what happened")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--subject <text>", "Subject line when the touch used one")
    .option("--body <text>", "Body snippet or note about the touch")
    .option("--source-url <url>", "Source URL for the touch context")
    .option("--notes <notes>", "Optional notes")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies touches add <company-id> --motion <motion-id> --prospect <prospect-id> --surface connection_request --direction outbound --outcome sent --occurred-at 2026-05-26T17:00:00.000Z --summary "Sent first connection request"
  exo companies touches add <company-id> --motion <motion-id> --prospect <prospect-id> --surface post_accept_message --direction outbound --outcome sent --occurred-at 2026-05-29T17:00:00.000Z --summary "Sent first DM after acceptance" --body "Short DM text"
  exo companies touches add <company-id> --motion <motion-id> --prospect <prospect-id> --surface profile_view --direction outbound --outcome sent --occurred-at 2026-05-26T16:00:00.000Z --summary "Viewed the LinkedIn profile before outreach"

Rules:
  - Store what actually happened, not what you hoped to send.
  - Touch history is the prospect-level memory the later draft case and action brief should read from.
  - Use warmup and mechanical surfaces too. Profile views, likes, follows, withdrawals, and similar actions belong here once they happen.
`
    )
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) {
        process.exitCode = 1;
        return;
      }

      const { company, rawMotion } = context;

      try {
        const surface = normalizeTouchSurface(options.surface);
        const direction = normalizeTouchDirection(options.direction);
        const outcome = normalizeCadenceOutcome(options.outcome);
        const mappedResult = findActionResultForTouch({ surface, direction, outcome });

        let storedMotion;
        if (mappedResult) {
          const actionResult = recordActionResult({
            actionKey: mappedResult.actionKey,
            resultKey: mappedResult.resultKey,
            motionId: rawMotion.id,
            companyId: company.id,
            prospectId: options.prospect,
            surface: mappedResult.surface,
            occurredAt: options.occurredAt,
            summary: options.summary,
            subject: options.subject,
            body: options.body,
            sourceUrl: options.sourceUrl,
            notes: options.notes
          });
          storedMotion = findMotionById(actionResult.actionResult.motionId);
          if (!storedMotion) {
            throw new Error(`Motion not found after action-result writeback: ${actionResult.actionResult.motionId}`);
          }
        } else {
          storedMotion = recordMotionProspectTouch(rawMotion, company, {
            prospectId: options.prospect,
            surface,
            direction,
            outcome,
            occurredAt: options.occurredAt,
            summary: options.summary,
            subject: options.subject,
            body: options.body,
            sourceUrl: options.sourceUrl,
            notes: options.notes
          });
        }
        const account = storedMotion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;
        const prospect = account?.prospects.find((item) => item.id === options.prospect) ?? null;
        const result = {
          company,
          motion: { id: storedMotion.id, name: storedMotion.name },
          prospect,
          touches: prospect?.touches ?? []
        };

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (!prospect) {
          console.log(`No touch history was stored for prospect ${options.prospect}.`);
          return;
        }

        console.log(renderTouchList(company.name, storedMotion.name, prospect));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  companyProfile
    .command("show")
    .description("Show the sticky browser profile assignment for a company.")
    .argument("<company-id>", "Company identifier")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies profile show <company-id>
  exo companies profile show <company-id> --json
`
    )
    .action((companyId, options) => {
      const raw = findCompanyById(companyId);
      if (!raw) {
        console.error(`Company not found: ${companyId}`);
        process.exitCode = 1;
        return;
      }

      const company = companySchema.parse(raw);
      const profile = company.engagementProfileAssignment
        ? findBrowserProfileById(company.engagementProfileAssignment.profileId)
        : null;

      const result = {
        company,
        assignment: company.engagementProfileAssignment,
        profile: profile ? browserProfileSchema.parse(profile) : null
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!company.engagementProfileAssignment) {
        console.log(`No sticky browser profile assignment for ${company.name}.`);
        return;
      }

      const assignment = company.engagementProfileAssignment;
      console.log(
        [
          `Company Profile: ${company.name}`,
          `Profile: ${assignment.label}`,
          `Browser: ${assignment.browser}`,
          `Profile Directory: ${assignment.profileDirectory}`,
          `Workspace: ${assignment.workspace ?? "unknown"}`,
          `Owner: ${assignment.owner ?? "unknown"}`,
          `Accounts: ${assignment.accountRefs.length ? assignment.accountRefs.join(", ") : "none"}`,
          `Assigned At: ${assignment.assignedAt}`,
          `Assigned By: ${assignment.assignedBy ?? "unknown"}`,
          `Reason: ${assignment.reason ?? "none"}`
        ].join("\n")
      );
    });

  companyUser
    .command("show")
    .description("Show the sticky execution-user assignment for a company.")
    .argument("<company-id>", "Company identifier")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies user show <company-id>
  exo companies user show <company-id> --json
`
    )
    .action((companyId, options) => {
      const raw = findCompanyById(companyId);
      if (!raw) {
        console.error(`Company not found: ${companyId}`);
        process.exitCode = 1;
        return;
      }

      const company = companySchema.parse(raw);
      const user = company.engagementUserAssignment
        ? findUserById(company.engagementUserAssignment.userId)
        : null;

      const result = {
        company,
        assignment: company.engagementUserAssignment,
        user
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!company.engagementUserAssignment) {
        console.log(`No sticky execution user assignment for ${company.name}.`);
        return;
      }

      const assignment = company.engagementUserAssignment;
      console.log(
        [
          `Company User: ${company.name}`,
          `User: ${assignment.label}`,
          `Owner: ${assignment.owner ?? "unknown"}`,
          `Accounts: ${assignment.accountRefs.length ? assignment.accountRefs.join(", ") : "none"}`,
          `Assigned At: ${assignment.assignedAt}`,
          `Assigned By: ${assignment.assignedBy ?? "unknown"}`,
          `Reason: ${assignment.reason ?? "none"}`
        ].join("\n")
      );
    });

  const queue = companies
    .command("queue")
    .description("Inspect or set the motion-specific inventory queue state for one company.");

  queue
    .command("show")
    .description("Show the current queue state for one motion-linked company.")
    .argument("<company-id>", "Company identifier")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies queue show <company-id>
  exo companies queue show <company-id> --motion <motion-id> --json
`
    )
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) {
        process.exitCode = 1;
        return;
      }

      const { company, motion, account } = context;
      const queueSummary = buildMotionQueueSummary(motion, [company], { companyId: company.id });
      const queueItem = queueSummary.items[0] ?? {
        queueStatus: "discovered",
        queueSource: "derived",
        signalMatchCount: 0,
        prospectCount: 0,
        readyToSendCount: 0,
        prospectStatusCounts: {}
      };
      const result = {
        company,
        motion: {
          id: motion.id,
          name: motion.name
        },
        account: account ? withDerivedTargetAccountQueueState(account) : null,
        queue: {
          status: queueItem.queueStatus,
          source: queueItem.queueSource,
          signalMatchCount: queueItem.signalMatchCount,
          prospectCount: queueItem.prospectCount,
          readyToSendCount: queueItem.readyToSendCount,
          prospectStatusCounts: queueItem.prospectStatusCounts
        }
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(
        [
          `Company Queue: ${company.name}`,
          `Motion: ${motion.name}`,
          `Queue Status: ${result.queue.status} (${result.queue.source})`,
          `Signal Matches: ${result.queue.signalMatchCount}`,
          `Prospects: ${result.queue.prospectCount}`,
          `Ready To Send: ${result.queue.readyToSendCount}`,
          `Prospect Queue Counts: ${Object.entries(result.queue.prospectStatusCounts).map(([status, count]) => `${status}:${count}`).join(", ") || "none"}`
        ].join("\n")
      );
    });

  queue
    .command("set")
    .description("Set the motion-specific queue state for one company.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--status <status>", "Queue status: discovered, queued_for_research, researched, selected, ready, suppressed, exhausted")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--notes <notes>", "Optional queue notes")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies queue set <company-id> --motion <motion-id> --status queued_for_research --json
  exo companies queue set <company-id> --motion <motion-id> --status suppressed --notes "Strategic hold until Q4" --json
`
    )
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) {
        process.exitCode = 1;
        return;
      }

      const { company, rawMotion } = context;

      try {
        const updatedMotion = setMotionTargetAccountQueue(rawMotion, company, {
          status: normalizeMotionQueueStatus(options.status),
          notes: options.notes ?? null
        });
        const storedMotion = updatedMotion;
        const account = storedMotion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;

        if (options.json) {
          console.log(JSON.stringify({
            company,
            motion: {
              id: storedMotion.id,
              name: storedMotion.name
            },
            account
          }, null, 2));
          return;
        }

        console.log(
          [
            `Updated Company Queue: ${company.name}`,
            `Motion: ${storedMotion.name}`,
            `Queue Status: ${account?.queueState.status ?? "unknown"}`,
            `Queue Source: ${account?.queueState.source ?? "unknown"}`,
            `Queue Notes: ${account?.queueState.notes ?? "none"}`
          ].join("\n")
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  queue
    .command("claim")
    .description("Claim the company-research packet for one motion-linked company.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--worker <label>", "Worker or agent label claiming the packet")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--notes <notes>", "Optional claim notes")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies queue claim <company-id> --motion <motion-id> --worker codex-1 --json
`
    )
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) {
        process.exitCode = 1;
        return;
      }

      const { company, rawMotion } = context;

      try {
        const storedMotion = claimMotionTargetAccountPacket(rawMotion, company, {
          workerLabel: options.worker,
          notes: options.notes ?? null
        });
        const account = storedMotion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;

        if (options.json) {
          console.log(JSON.stringify({
            company,
            motion: {
              id: storedMotion.id,
              name: storedMotion.name
            },
            account
          }, null, 2));
          return;
        }

        console.log(
          [
            `Claimed Company Packet: ${company.name}`,
            `Motion: ${storedMotion.name}`,
            `Worker: ${account?.packetState?.workerLabel ?? options.worker}`,
            `Queue Status: ${account?.queueState.status ?? "unknown"}`,
            `Packet Status: ${account?.packetState?.status ?? "unknown"}`
          ].join("\n")
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  queue
    .command("complete")
    .description("Complete the claimed company-research packet and advance the queue state.")
    .argument("<company-id>", "Company identifier")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--worker <label>", "Worker or agent label completing the packet")
    .option("--next-status <status>", "Next queue status: researched, suppressed, exhausted")
    .option("--notes <notes>", "Optional completion notes")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies queue complete <company-id> --motion <motion-id> --worker codex-1 --next-status researched --json
`
    )
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) {
        process.exitCode = 1;
        return;
      }

      const { company, rawMotion } = context;

      try {
        const updatedMotion = completeMotionTargetAccountPacket(rawMotion, company, {
          workerLabel: options.worker ?? null,
          nextStatus: normalizeOptionalPacketCompletionStatus(options.nextStatus),
          notes: options.notes ?? null
        });
        const storedMotion = updatedMotion;
        const account = storedMotion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;

        if (options.json) {
          console.log(JSON.stringify({
            company,
            motion: {
              id: storedMotion.id,
              name: storedMotion.name
            },
            account
          }, null, 2));
          return;
        }

        console.log(
          [
            `Completed Company Packet: ${company.name}`,
            `Motion: ${storedMotion.name}`,
            `Queue Status: ${account?.queueState.status ?? "unknown"}`,
            `Packet Status: ${account?.packetState?.status ?? "unknown"}`,
            `Completed At: ${account?.packetState?.completedAt ?? "unknown"}`
          ].join("\n")
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  companies
    .command("research-brief")
    .description("Build the governed company research brief for one motion-linked account.")
    .argument("<company-id>", "Company identifier")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies research-brief <company-id>
  exo companies research-brief <company-id> --motion <motion-id> --json

Rules:
  - Research the company site first, then broader web/news against the motion's signals.
  - Prefer recent evidence that still supports a live outreach conversation.
  - For chosen people, check recent public activity and treat legitimate recent posting as positive evidence the channel is active.
  - View the chosen profiles and store direct email when you can, so the outreach path has both warmup context and fallback.
  - Choose a tight stakeholder set and store it back into Exo. Do not stop just because there is no perfect title match.
`
    )
    .action((companyId, options) => {
      const rawCompany = findCompanyById(companyId);
      if (!rawCompany) {
        console.error(`Company not found: ${companyId}`);
        process.exitCode = 1;
        return;
      }

      const company = companySchema.parse(rawCompany);
      const selectedMotionId = resolveResearchMotionId(company, options.motion);
      if (!selectedMotionId) {
        process.exitCode = 1;
        return;
      }

      const rawMotion = findMotionById(selectedMotionId);
      if (!rawMotion) {
        console.error(`Motion not found: ${selectedMotionId}`);
        process.exitCode = 1;
        return;
      }

      const brief = buildCompanyResearchBrief(company, rawMotion);

      if (options.json) {
        console.log(JSON.stringify(brief, null, 2));
        return;
      }

      console.log(renderCompanyResearchBrief(brief));
    });

  companies
    .command("motions")
    .description("Show motions linked to a company.")
    .argument("<company-id>", "Company identifier")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies motions <company-id>
  exo companies motions <company-id> --json
`
    )
    .action((companyId, options) => {
      const raw = findCompanyById(companyId);
      if (!raw) {
        console.error(`Company not found: ${companyId}`);
        process.exitCode = 1;
        return;
      }

      const company = companySchema.parse(raw);
      const motions = company.motionIds
        .map((motionId) => findMotionById(motionId))
        .filter(Boolean)
        .map((item) => motionSchema.parse(item));

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              company,
              motions
            },
            null,
            2
          )
        );
        return;
      }

      console.log(renderCompanyMotions(company, motions));
    });
}

/**
 * @param {string} value
 * @param {string[]} previous
 * @returns {string[]}
 */
function collect(value, previous) {
  previous.push(value);
  return previous;
}

function loadJsonInput(filePath) {
  if (filePath === "-") {
    if (process.stdin.isTTY) {
      throw new Error("Expected JSON on stdin, but stdin is a terminal. Pipe input or pass --input <path>.");
    }
    return JSON.parse(fs.readFileSync(0, "utf8"));
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
}

/**
 * @param {unknown} raw
 */
function parseLinkedinProfileEnrichmentPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("LinkedIn profile enrichment payload must be an object.");
  }

  const source = /** @type {Record<string, any>} */ (raw);
  return linkedinProfileSnapshotSchema.parse({
    capturedAt: source.capturedAt ?? null,
    profileUrl: source.profileUrl ?? null,
    avatarSourceUrl:
      typeof source.avatarSourceUrl === "string" && source.avatarSourceUrl.trim()
        ? source.avatarSourceUrl.trim()
        : null,
    avatarChecked: true,
    publicId: source.publicId ?? null,
    memberId: source.memberId ?? null,
    displayName: source.displayName ?? null,
    currentRoleTitle: source.currentRoleTitle ?? null,
    currentCompanyName: source.currentCompanyName ?? null,
    headline: source.headline ?? null,
    location: source.location ?? null,
    about: source.about ?? null,
    followerCount: source.followerCount ?? null,
    connectionCount: source.connectionCount ?? null,
    isPremium: source.isPremium ?? null,
    isOpenProfile: source.isOpenProfile ?? null,
    connectionDegree: source.connectionDegree ?? null,
    recentPosts: Array.isArray(source.recentPosts) ? source.recentPosts : []
  });
}

/**
 * @param {{
 *   publicId?: string | null,
 *   memberId?: string | null,
 *   observedAt?: string | null,
 *   sourceUrl?: string | null
 * }} input
 */
function buildLinkedinProfileEnrichmentContactPoints(input) {
  const points = [];

  if (input.publicId) {
    points.push({
      kind: "linkedin_public_id",
      value: input.publicId,
      label: "LinkedIn public profile id",
      matchStatus: "same_person_verified",
      verificationStatus: "observed",
      confidence: "high",
      source: "linkedin-profile-page",
      sourceUrl: input.sourceUrl ?? undefined,
      observedAt: input.observedAt ?? undefined,
      usableForResearch: true,
      usableForWarmup: true,
      usableForOutreach: false
    });
  }

  if (input.memberId) {
    points.push({
      kind: "linkedin_member_id",
      value: input.memberId,
      label: "LinkedIn member id",
      matchStatus: "same_person_verified",
      verificationStatus: "observed",
      confidence: "high",
      source: "linkedin-profile-page",
      sourceUrl: input.sourceUrl ?? undefined,
      observedAt: input.observedAt ?? undefined,
      usableForResearch: true,
      usableForWarmup: true,
      usableForOutreach: false
    });
  }

  return points;
}

/**
 * @param {Array<import("../../schema/target-account.js").linkedinRecentPostSchema._type>} posts
 */
function selectPrimaryLinkedinRecentPost(posts) {
  return posts.find((post) => post.summary || post.snippet || post.url) ?? null;
}

/**
 * @param {string | null | undefined} observedAt
 * @param {string | null | undefined} referenceAt
 */
function deriveFreshnessBand(observedAt, referenceAt) {
  if (!observedAt) {
    return null;
  }

  const observedMs = Date.parse(observedAt);
  const referenceMs = Date.parse(referenceAt ?? observedAt);
  if (Number.isNaN(observedMs) || Number.isNaN(referenceMs)) {
    return null;
  }

  const ageDays = Math.max(0, Math.floor((referenceMs - observedMs) / 86400000));
  if (ageDays <= 14) return "0-14-days";
  if (ageDays <= 30) return "15-30-days";
  if (ageDays <= 60) return "31-60-days";
  if (ageDays <= 90) return "61-90-days";
  return "stale";
}

/**
 * @param {Record<string, any>} options
 */
function buildProspectInputFromOptions(options) {
  const contactPoints = parseContactPointOptions(options.contactPoint);
  const contactEnrichmentState = buildContactEnrichmentInput(options);
  const queueState = buildProspectQueueInput(options);
  const preConnectDecision = buildPreConnectDecisionFromOptions(options);

  return {
    name: options.name,
    title: options.title,
    linkedinProfileUrl: options.linkedinProfileUrl,
    avatarSourceUrl: options.avatarSourceUrl,
    email: options.email,
    buyingCommitteeRole: normalizeBuyingCommitteeRole(options.buyingCommitteeRole),
    decisionAuthority: normalizeDecisionAuthority(options.decisionAuthority),
    fitConfidence: normalizeConfidence(options.fitConfidence),
    whyRelevant: options.whyRelevant,
    sourceUrl: options.sourceUrl,
    observedAt: options.observedAt,
    profileViewedAt: options.profileViewedAt,
    roleTruth: {
      currentRoleDescription: options.roleDescription,
      summary: options.roleSummary,
      operatingMode: options.operatingMode,
      scope: options.scope,
      evidence: normalizeRepeatedStringList(options.roleEvidence)
    },
    triggerWindow: {
      summary: options.triggerSummary,
      tenureMonths: options.tenureMonths !== undefined ? Number(options.tenureMonths) : undefined,
      tenureBand: normalizeTenureBand(options.tenureBand),
      whyNowAnchor: options.whyNowAnchor,
      personTriggers: normalizeRepeatedStringList(options.personTrigger),
      companyTriggers: normalizeRepeatedStringList(options.companyTrigger)
    },
    identityTells: {
      summary: options.identitySummary,
      headline: options.headline,
      aboutQuotes: normalizeRepeatedStringList(options.aboutQuote),
      frameworks: normalizeRepeatedStringList(options.framework),
      certifications: normalizeRepeatedStringList(options.certification),
      quantifiedReceipts: normalizeRepeatedStringList(options.quantifiedReceipt),
      selfImageVerbs: normalizeRepeatedStringList(options.selfImageVerb),
      metaphors: normalizeRepeatedStringList(options.metaphor)
    },
    liveSignal: {
      channel: options.activeChannel,
      activityType: options.activityType,
      summary: options.liveSignalSummary,
      url: options.liveSignalUrl,
      observedAt: options.liveSignalObservedAt,
      freshnessBand: normalizeFreshnessBand(options.freshnessBand),
      hookStrength: normalizeNullableConfidence(options.hookStrength),
      engagementRationale: options.engagementRationale
    },
    preConnectDecision,
    contactPoints: contactPoints.length ? contactPoints : undefined,
    contactEnrichmentState,
    queueState,
    notes: options.notes,
    signalMatchIds: normalizeStringList(options.signalMatch)
  };
}

/**
 * @param {Record<string, any>} options
 */
function buildPreConnectDecisionFromOptions(options) {
  const bypassReason = typeof options.preConnectBypassReason === "string"
    ? options.preConnectBypassReason.trim()
    : "";
  const clear = options.clearPreConnectDecision === true;
  if (clear && bypassReason) {
    throw new Error("Choose either --pre-connect-bypass-reason or --clear-pre-connect-decision, not both.");
  }
  if (clear) {
    return null;
  }
  if (bypassReason) {
    return {
      mode: "bypass",
      reason: bypassReason,
    };
  }
  return undefined;
}

/**
 * @param {string[] | undefined} values
 */
function parseContactPointOptions(values) {
  return normalizeRepeatedStringList(values).map((value) => {
    let parsed;

    try {
      parsed = JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid --contact-point JSON: ${value}`);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Invalid --contact-point payload: ${value}`);
    }

    return {
      id: typeof parsed.id === "string" ? parsed.id : undefined,
      kind: normalizeContactPointKind(parsed.kind),
      value: requireContactPointValue(parsed.value),
      label: typeof parsed.label === "string" ? parsed.label : undefined,
      matchStatus: normalizeContactMatchStatus(parsed.matchStatus),
      verificationStatus: normalizeContactVerificationStatus(parsed.verificationStatus),
      confidence: normalizeConfidence(parsed.confidence),
      source: typeof parsed.source === "string" ? parsed.source : undefined,
      sourceUrl: typeof parsed.sourceUrl === "string" ? parsed.sourceUrl : undefined,
      observedAt: typeof parsed.observedAt === "string" ? parsed.observedAt : undefined,
      notes: typeof parsed.notes === "string" ? parsed.notes : undefined,
      evidence: Array.isArray(parsed.evidence)
        ? parsed.evidence.map((evidence) => ({
            type: requireEvidenceField(evidence?.type, "type"),
            summary: requireEvidenceField(evidence?.summary, "summary"),
            sourceUrl: typeof evidence?.sourceUrl === "string" ? evidence.sourceUrl : undefined,
            observedAt: typeof evidence?.observedAt === "string" ? evidence.observedAt : undefined
          }))
        : undefined,
      usableForOutreach: typeof parsed.usableForOutreach === "boolean" ? parsed.usableForOutreach : undefined,
      usableForResearch: typeof parsed.usableForResearch === "boolean" ? parsed.usableForResearch : undefined,
      usableForWarmup: typeof parsed.usableForWarmup === "boolean" ? parsed.usableForWarmup : undefined
    };
  });
}

/**
 * @param {Record<string, any>} options
 */
function buildContactEnrichmentInput(options) {
  const state = {
    status: normalizeContactEnrichmentStatus(options.enrichmentStatus),
    sourcesTried: normalizeRepeatedStringList(options.sourceTried),
    missingChannels: normalizeRepeatedStringList(options.missingChannel),
    bestDirectChannels: normalizeRepeatedStringList(options.bestDirectChannel),
    lastEnrichedAt: options.lastEnrichedAt,
    notes: options.enrichmentNotes
  };

  if (
    state.status === undefined
    && !state.sourcesTried.length
    && !state.missingChannels.length
    && !state.bestDirectChannels.length
    && !state.lastEnrichedAt
    && !state.notes
  ) {
    return undefined;
  }

  return state;
}

/**
 * @param {Record<string, any>} options
 */
function buildProspectQueueInput(options) {
  const status = normalizeOptionalMotionQueueStatus(options.queueStatus);
  const notes = typeof options.queueNotes === "string" ? options.queueNotes : undefined;

  if (!status && !notes) {
    return undefined;
  }

  return {
    status,
    notes
  };
}

/**
 * @param {string | undefined} value
 */
function normalizeOptionalMotionQueueStatus(value) {
  if (!value) {
    return undefined;
  }

  return normalizeMotionQueueStatus(value);
}

/**
 * @param {string | undefined} value
 * @returns {"researched" | "suppressed" | "exhausted" | undefined}
 */
function normalizeOptionalPacketCompletionStatus(value) {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeMotionQueueStatus(value);
  if (normalized === "researched" || normalized === "suppressed" || normalized === "exhausted") {
    return normalized;
  }

  throw new Error(`Invalid packet completion status: ${value}`);
}

/**
 * @param {string | undefined} value
 * @returns {"suppressed" | "exhausted" | undefined | null}
 */
function normalizeProspectPacketNextStatus(value) {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeMotionQueueStatus(value);
  if (normalized === "suppressed" || normalized === "exhausted") {
    return normalized;
  }

  return null;
}

/**
 * @param {string} value
 */
function normalizeMotionQueueStatus(value) {
  const normalized = value.trim().toLowerCase();
  if (isMotionQueueStatus(normalized)) {
    return normalized;
  }

  throw new Error(`Invalid motion queue status: ${value}`);
}

/**
 * @param {string | undefined} value
 */
function normalizeDispositionOption(value) {
  const normalized = normalizeRequiredText(value, "Disposition").toLowerCase();
  if (dispositionValues.includes(normalized)) {
    return normalized;
  }

  throw new Error(`Invalid disposition: ${value}`);
}

/**
 * @param {string | undefined} value
 * @returns {"operator" | "agent" | "system"}
 */
function normalizeDispositionActor(value) {
  const normalized = (value ?? "operator").trim().toLowerCase();
  if (normalized === "operator" || normalized === "agent" || normalized === "system") {
    return normalized;
  }

  throw new Error(`Invalid disposition actor: ${value}`);
}

/**
 * @param {string} disposition
 * @param {string | undefined} value
 */
function normalizeDispositionReason(disposition, value) {
  const reason = normalizeOptionalText(value);
  if (disposition !== "active" && !reason) {
    throw new Error("Disposition reason is required for nurture and terminal states.");
  }

  return reason ?? "Reactivated by operator.";
}

/**
 * @param {string | undefined} value
 * @param {string} label
 */
function normalizeRequiredText(value, label) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

/**
 * @param {string | undefined | null} value
 */
function normalizeOptionalText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {string | undefined} value
 * @returns {"low" | "moderate" | "high" | "unknown" | undefined}
 */
function normalizeConfidence(value) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "low" || normalized === "moderate" || normalized === "high" || normalized === "unknown") {
    return normalized;
  }

  throw new Error(`Invalid confidence: ${value}`);
}

/**
 * @param {unknown} value
 */
function normalizeContactPointKind(value) {
  const normalized = value?.toString().trim().toLowerCase();
  if (
    normalized === "linkedin_profile"
    || normalized === "linkedin_public_id"
    || normalized === "linkedin_member_id"
    || normalized === "email"
    || normalized === "phone"
    || normalized === "x_profile"
    || normalized === "instagram_profile"
    || normalized === "facebook_profile"
    || normalized === "tiktok_profile"
    || normalized === "reddit_profile"
    || normalized === "website"
    || normalized === "generic_contact"
  ) {
    return normalized;
  }

  throw new Error(`Invalid contact-point kind: ${value}`);
}

/**
 * @param {unknown} value
 */
function normalizeContactMatchStatus(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const normalized = value.toString().trim().toLowerCase();
  if (
    normalized === "same_person_verified"
    || normalized === "same_person_probable"
    || normalized === "same_person_possible"
    || normalized === "rejected"
  ) {
    return normalized;
  }

  throw new Error(`Invalid contact-point match status: ${value}`);
}

/**
 * @param {unknown} value
 */
function normalizeContactVerificationStatus(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const normalized = value.toString().trim().toLowerCase();
  if (
    normalized === "verified"
    || normalized === "observed"
    || normalized === "inferred"
    || normalized === "rejected"
    || normalized === "unknown"
  ) {
    return normalized;
  }

  throw new Error(`Invalid contact-point verification status: ${value}`);
}

/**
 * @param {string | undefined} value
 */
function normalizeContactEnrichmentStatus(value) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "pending"
    || normalized === "in_progress"
    || normalized === "complete"
    || normalized === "exhausted"
  ) {
    return normalized;
  }

  throw new Error(`Invalid contact enrichment status: ${value}`);
}

/**
 * @param {unknown} value
 */
function requireContactPointValue(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  throw new Error(`Invalid contact-point value: ${value}`);
}

/**
 * @param {unknown} value
 * @param {string} field
 */
function requireEvidenceField(value, field) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  throw new Error(`Invalid contact-point evidence ${field}: ${value}`);
}

/**
 * @param {string | undefined} value
 * @returns {"primary_business_owner" | "primary_technical_owner" | "economic_buyer" | "commercial_owner" | "risk_blocker" | "technical_evaluator" | "executive_sponsor" | "operator_champion" | "other" | undefined}
 */
function normalizeBuyingCommitteeRole(value) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "primary_business_owner"
    || normalized === "primary_technical_owner"
    || normalized === "economic_buyer"
    || normalized === "commercial_owner"
    || normalized === "risk_blocker"
    || normalized === "technical_evaluator"
    || normalized === "executive_sponsor"
    || normalized === "operator_champion"
    || normalized === "other"
  ) {
    return /** @type {ReturnType<typeof normalizeBuyingCommitteeRole>} */ (normalized);
  }

  throw new Error(`Invalid buying committee role: ${value}`);
}

/**
 * @param {string | undefined} value
 * @returns {"buys" | "blocks" | "sponsors" | "influences" | "observes" | "unknown" | undefined}
 */
function normalizeDecisionAuthority(value) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "buys"
    || normalized === "blocks"
    || normalized === "sponsors"
    || normalized === "influences"
    || normalized === "observes"
    || normalized === "unknown"
  ) {
    return normalized;
  }

  throw new Error(`Invalid decision authority: ${value}`);
}

/**
 * @param {string | undefined} value
 * @returns {"connection-request" | "direct-message" | "inmail" | "email" | "none" | undefined}
 */
function normalizeOutreachChannel(value) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "connection-request"
    || normalized === "direct-message"
    || normalized === "inmail"
    || normalized === "email"
    || normalized === "none"
  ) {
    return normalized;
  }

  throw new Error(`Invalid outreach channel: ${value}`);
}

/**
 * @param {string | undefined} value
 * @returns {"pending" | "sent" | "accepted" | "ignored" | "opened-no-reply" | "replied" | "blocked" | "nurture" | undefined}
 */
function normalizeCadenceOutcome(value) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "pending"
    || normalized === "sent"
    || normalized === "accepted"
    || normalized === "ignored"
    || normalized === "opened-no-reply"
    || normalized === "replied"
    || normalized === "blocked"
    || normalized === "nurture"
  ) {
    return normalized;
  }

  throw new Error(`Invalid cadence outcome: ${value}`);
}

/**
 * @param {string | undefined} value
 * @returns {"connection-request" | "direct-message" | "inmail" | "value-add-email" | "quarterly-retouch" | "done" | undefined}
 */
function normalizeCadenceStep(value) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "connection-request"
    || normalized === "direct-message"
    || normalized === "inmail"
    || normalized === "value-add-email"
    || normalized === "quarterly-retouch"
    || normalized === "done"
  ) {
    return normalized;
  }

  throw new Error(`Invalid cadence step: ${value}`);
}

/**
 * @param {string | undefined} value
 * @returns {"connection_request" | "post_accept_message" | "follow_up_direct_message" | "email" | "inbound_reply" | "public_comment" | "comment_reply" | "profile_view" | "follow" | "unfollow" | "like_post" | "unlike_post" | "share_post" | "in_mail_message" | "withdraw_connection" | "accept_connection" | "decline_connection" | "create_comment_reaction" | "voicemail_outreach" | "video_outreach" | undefined}
 */
function normalizeTouchSurface(value) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "connection_request"
    || normalized === "post_accept_message"
    || normalized === "follow_up_direct_message"
    || normalized === "email"
    || normalized === "inbound_reply"
    || normalized === "public_comment"
    || normalized === "comment_reply"
    || normalized === "profile_view"
    || normalized === "follow"
    || normalized === "unfollow"
    || normalized === "like_post"
    || normalized === "unlike_post"
    || normalized === "share_post"
    || normalized === "in_mail_message"
    || normalized === "withdraw_connection"
    || normalized === "accept_connection"
    || normalized === "decline_connection"
    || normalized === "create_comment_reaction"
    || normalized === "voicemail_outreach"
    || normalized === "video_outreach"
  ) {
    return normalized;
  }

  throw new Error(`Invalid touch surface: ${value}`);
}

/**
 * @param {string | undefined} value
 * @returns {"outbound" | "inbound" | "system" | undefined}
 */
function normalizeTouchDirection(value) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "outbound" || normalized === "inbound" || normalized === "system") {
    return normalized;
  }

  throw new Error(`Invalid touch direction: ${value}`);
}

/**
 * @param {string | undefined} value
 * @returns {"under-6-months" | "6-to-24-months" | "24-to-60-months" | "60-plus-months" | "unknown" | undefined}
 */
function normalizeTenureBand(value) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "under-6-months"
    || normalized === "6-to-24-months"
    || normalized === "24-to-60-months"
    || normalized === "60-plus-months"
    || normalized === "unknown"
  ) {
    return normalized;
  }

  throw new Error(`Invalid tenure band: ${value}`);
}

/**
 * @param {string | undefined} value
 * @returns {"0-14-days" | "15-30-days" | "31-60-days" | "61-90-days" | "stale" | "unknown" | undefined}
 */
function normalizeFreshnessBand(value) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "0-14-days"
    || normalized === "15-30-days"
    || normalized === "31-60-days"
    || normalized === "61-90-days"
    || normalized === "stale"
    || normalized === "unknown"
  ) {
    return normalized;
  }

  throw new Error(`Invalid freshness band: ${value}`);
}

/**
 * @param {string | undefined} value
 * @returns {"low" | "moderate" | "high" | "unknown" | null | undefined}
 */
function normalizeNullableConfidence(value) {
  if (value === undefined) {
    return undefined;
  }

  return normalizeConfidence(value) ?? null;
}

/**
 * @param {string} companyId
 * @param {string | undefined} selectedMotionId
 */
/**
 * @param {any} storedMotion
 * @param {string} companyId
 * @param {string} prospectId
 * @param {string} surface
 * @param {boolean} json
 * @param {string} label
 */
function emitDraft(storedMotion, companyId, prospectId, surface, json, label) {
  const account = storedMotion.targetMap.accounts.find((item) => item.companyId === companyId) ?? null;
  const prospect = account?.prospects.find((item) => item.id === prospectId) ?? null;
  const draft = (prospect?.drafts ?? []).find((item) => item.surface === surface && item.status !== "sent") ?? null;
  if (json) {
    console.log(JSON.stringify({ motion: { id: storedMotion.id, name: storedMotion.name }, prospect: prospect ? { id: prospect.id, name: prospect.name } : null, draft }, null, 2));
    return;
  }
  console.log(`${label} for ${prospect?.name ?? prospectId} · ${surface} [${draft?.status ?? "none"}]`);
  if (draft?.subject) console.log(`  Subject: ${draft.subject}`);
  if (draft?.body) console.log(`  Body: ${draft.body}`);
}

function setCompanyDispositionFromOptions(companyId, options) {
  const context = loadCompanyMotionContext(companyId, options.motion);
  if (!context) {
    throw new Error("Could not resolve the motion-linked account.");
  }
  const disposition = normalizeDispositionOption(options.disposition);
  const actor = normalizeDispositionActor(options.actor);
  const reason = normalizeDispositionReason(disposition, options.reason);
  const motionAccount = findMotionAccountByMotionAndCompany(context.motion.id, context.company.id);
  if (!motionAccount) {
    throw new Error(`Motion account not found for ${context.company.name} on ${context.motion.name}.`);
  }

  const updated = setAccountDisposition(motionAccount.id, {
    disposition,
    actor,
    reason
  });
  if (!updated) {
    throw new Error(`Motion account not found: ${motionAccount.id}`);
  }

  const storedMotion = findMotionById(context.motion.id) ?? context.motion;
  const storedAccount = storedMotion.targetMap.accounts.find((item) => item.companyId === context.company.id) ?? null;
  const account = mergeNormalizedAccountDisposition(storedAccount, updated);
  return {
    company: context.company,
    motion: {
      id: storedMotion.id,
      name: storedMotion.name
    },
    account,
    normalizedAccount: updated
  };
}

function setProspectDispositionFromOptions(companyId, options) {
  const context = loadCompanyMotionContext(companyId, options.motion);
  if (!context) {
    throw new Error("Could not resolve the motion-linked account.");
  }
  const disposition = normalizeDispositionOption(options.disposition);
  const actor = normalizeDispositionActor(options.actor);
  const reason = normalizeDispositionReason(disposition, options.reason);
  const prospect = context.account?.prospects.find((item) => item.id === options.prospect) ?? null;
  if (!prospect) {
    throw new Error(`Prospect not found on target account: ${options.prospect}`);
  }

  const updated = setProspectDisposition(prospect.id, {
    disposition,
    actor,
    reason
  });
  if (!updated) {
    throw new Error(`Prospect not found: ${prospect.id}`);
  }

  const storedMotion = findMotionById(context.motion.id) ?? context.motion;
  const account = storedMotion.targetMap.accounts.find((item) => item.companyId === context.company.id) ?? null;
  const storedProspect = account?.prospects.find((item) => item.id === prospect.id) ?? null;
  const prospectResult = mergeNormalizedProspectDisposition(storedProspect, updated);
  return {
    company: context.company,
    motion: {
      id: storedMotion.id,
      name: storedMotion.name
    },
    account,
    prospect: prospectResult,
    normalizedProspect: updated
  };
}

function mergeNormalizedAccountDisposition(account, normalizedAccount) {
  if (!account) return null;
  return {
    ...account,
    disposition: normalizedAccount.disposition,
    queueState: {
      ...account.queueState,
      status: normalizedAccount.queueStatus,
      updatedAt: normalizedAccount.updatedAt
    }
  };
}

function mergeNormalizedProspectDisposition(prospect, normalizedProspect) {
  if (!prospect) return null;
  return {
    ...prospect,
    disposition: normalizedProspect.disposition,
    queueState: {
      ...prospect.queueState,
      status: normalizedProspect.queueStatus,
      updatedAt: normalizedProspect.updatedAt
    }
  };
}

function emitCompanyDispositionResult(result, json, label) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    [
      `${label}: ${result.company.name}`,
      `Motion: ${result.motion.name}`,
      `Disposition: ${result.account?.disposition ?? result.normalizedAccount.disposition}`,
      `Queue Status: ${result.account?.queueState?.status ?? result.normalizedAccount.queueStatus}`
    ].join("\n")
  );
}

function emitProspectDispositionResult(result, json, label) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    [
      `${label}: ${result.prospect?.name ?? result.normalizedProspect.id}`,
      `Company: ${result.company.name}`,
      `Motion: ${result.motion.name}`,
      `Disposition: ${result.prospect?.disposition ?? result.normalizedProspect.disposition}`,
      `Queue Status: ${result.prospect?.queueState?.status ?? result.normalizedProspect.queueStatus}`
    ].join("\n")
  );
}

function loadCompanyMotionContext(companyId, selectedMotionId) {
  const rawCompany = findCompanyById(companyId);
  if (!rawCompany) {
    console.error(`Company not found: ${companyId}`);
    return null;
  }

  const company = companySchema.parse(rawCompany);
  const motionId = resolveResearchMotionId(company, selectedMotionId);
  if (!motionId) {
    return null;
  }

  const rawMotion = findMotionById(motionId);
  if (!rawMotion) {
    console.error(`Motion not found: ${motionId}`);
    return null;
  }

  const motion = motionSchema.parse(rawMotion);
  const account = motion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;

  return {
    company,
    motion,
    rawMotion,
    account
  };
}

/**
 * @param {import("../../schema/company.js").companySchema._type} company
 * @returns {Array<import("../../schema/motion.js").motionSchema._type>}
 */
function loadCompanyLinkedMotions(company) {
  return company.motionIds
    .map((motionId) => findMotionById(motionId))
    .filter(Boolean)
    .map((rawMotion) => rehydrateMotion(rawMotion).motion);
}

/**
 * @param {string} companyName
 * @param {string} motionName
 * @param {number} targetCount
 * @param {Array<import("../../schema/target-account.js").prospectSchema._type>} prospects
 */
function renderProspectList(companyName, motionName, targetCount, prospects) {
  return [
    `Prospects: ${companyName}`,
    `Motion: ${motionName}`,
    `Target Count: ${targetCount}`,
    ...prospects.map((prospect) => {
      const suffixes = [
        `${prospect.buyingCommitteeRole}, ${prospect.decisionAuthority}`,
        prospect.fitConfidence
      ].join(", ");
      return `- ${prospect.id}  ${prospect.name} — ${prospect.title} [${suffixes}]: ${prospect.whyRelevant}`;
    })
  ].join("\n");
}

/**
 * @param {string} companyName
 * @param {string} motionName
 * @param {import("../../schema/target-account.js").prospectSchema._type} prospect
 */
function renderProspectDetail(companyName, motionName, prospect) {
  const lines = [
    `Prospect: ${companyName}`,
    `Motion: ${motionName}`,
    `Prospect ID: ${prospect.id}`,
    `Name: ${prospect.name}`,
    `Title: ${prospect.title}`,
    `Buying Committee Role: ${prospect.buyingCommitteeRole}`,
    `Decision Authority: ${prospect.decisionAuthority}`,
    `Fit: ${prospect.fitConfidence}`,
    `Why Relevant: ${prospect.whyRelevant}`,
    `Email: ${prospect.email ?? "none"}`,
    `Profile Viewed: ${prospect.profileViewedAt ?? "not recorded"}`,
    `Role Truth: ${prospect.roleTruth.summary ?? "none"}`,
    `Trigger Window: ${prospect.triggerWindow.summary ?? "none"}`,
    `Identity Tells: ${prospect.identityTells.summary ?? "none"}`,
    `LinkedIn Snapshot Company: ${prospect.linkedinProfileSnapshot.currentCompanyName ?? "none"}`,
    `LinkedIn Recent Posts: ${prospect.linkedinProfileSnapshot.recentPosts.length}`,
    `Live Signal: ${prospect.liveSignal.summary ?? "none"}`,
    `Contact Points: ${prospect.contactPoints.length ? prospect.contactPoints.map((point) => `${point.kind}=${point.value}`).join(" | ") : "none"}`,
    `Contact Enrichment: ${prospect.contactEnrichmentState.status}`,
    `Cadence: ${prospect.cadenceState.status}`
  ];

  return lines.join("\n");
}

/**
 * @param {string} companyName
 * @param {string} motionName
 * @param {import("../../schema/target-account.js").prospectSchema._type} prospect
 */
function renderCadenceDetail(companyName, motionName, prospect) {
  return [
    `Cadence: ${companyName}`,
    `Motion: ${motionName}`,
    `Prospect: ${prospect.name} (${prospect.title})`,
    `Current Step: ${prospect.cadenceState.currentStep ?? "none"}`,
    `Last Touch Channel: ${prospect.cadenceState.lastTouchChannel ?? "none"}`,
    `Last Touch Outcome: ${prospect.cadenceState.lastTouchOutcome ?? "none"}`,
    `Last Touch At: ${prospect.cadenceState.lastTouchAt ?? "none"}`,
    `Next Action: ${prospect.cadenceState.nextAction ?? "none"}`,
    `Next Action Due At: ${prospect.cadenceState.nextActionDueAt ?? "none"}`,
    `Blocked Channels: ${prospect.cadenceState.blockedChannels.join(", ") || "none"}`,
    `Require New Hook: ${prospect.cadenceState.requireNewHook ? "yes" : "no"}`
  ].join("\n");
}

/**
 * @param {string} companyName
 * @param {string} motionName
 * @param {import("../../schema/target-account.js").prospectSchema._type} prospect
 */
function renderTouchList(companyName, motionName, prospect) {
  const lines = [
    `Touches: ${companyName}`,
    `Motion: ${motionName}`,
    `Prospect: ${prospect.name} (${prospect.title})`
  ];

  if (!prospect.touches.length) {
    lines.push("No stored touches.");
    return lines.join("\n");
  }

  for (const touch of prospect.touches) {
    lines.push(`- ${touch.occurredAt}  ${touch.surface}  ${touch.direction}  ${touch.outcome}`);
    lines.push(`  Summary: ${touch.summary}`);
    if (touch.subject) {
      lines.push(`  Subject: ${touch.subject}`);
    }
    if (touch.body) {
      lines.push(`  Body: ${touch.body}`);
    }
  }

  return lines.join("\n");
}

/**
 * @param {ReturnType<typeof buildCompanyExecutionView>} execution
 */
function renderCompanyExecutionPlan(execution) {
  const lines = [
    `Execution Plan: ${execution.company.name}`,
    `Capability: ${execution.capability}`,
    `Motion Context: ${execution.motion ? `${execution.motion.name} (${execution.motion.id})` : "none"}`,
    `Assignment Source: ${execution.assignmentSource}`,
    `Pinned User: ${execution.assignments.user?.label ?? "none"}`,
    `Pinned Profile: ${execution.assignments.profile?.label ?? "none"}`,
    `Transport Mode: ${execution.transport.mode}`,
    `Transport Status: ${execution.transport.status}`
  ];

  if (execution.resolvedAccount) {
    lines.push(`Resolved Account: ${execution.resolvedAccount.handle} (${execution.resolvedAccount.sourceType})`);
    lines.push(`Resolution Reason: ${execution.resolvedAccount.reason}`);
  }

  if (execution.resolvedProfile) {
    lines.push(`Browser: ${execution.resolvedProfile.browser}`);
    lines.push(`Profile Directory: ${execution.resolvedProfile.profileDirectory}`);
    lines.push(`Profile Path: ${execution.resolvedProfile.profilePath}`);
  }

  if (execution.transport.preferredTransport) {
    lines.push(`Preferred Transport: ${execution.transport.preferredTransport.tool}`);
    lines.push(`Preferred Reason: ${execution.transport.preferredTransport.reason}`);
  }

  if (execution.transport.fallbackTransport) {
    lines.push(`Fallback Transport: ${execution.transport.fallbackTransport.tool}`);
    lines.push(`Fallback Reason: ${execution.transport.fallbackTransport.reason}`);
  }

  if (execution.transport.blocker) {
    lines.push(`Blocker: ${execution.transport.blocker}`);
  }

  lines.push("Runtime Checks:");
  for (const check of execution.transport.runtimeChecks) {
    lines.push(`- ${check}`);
  }

  if (execution.transport.failureClasses?.length) {
    lines.push("Failure Classes:");
    for (const failure of execution.transport.failureClasses) {
      lines.push(`- ${failure.key}: ${failure.symptom}`);
      lines.push(`  Rule: ${failure.operatorRule}`);
    }
  }

  if (execution.transport.recoveryHints.length) {
    lines.push("Recovery Hints:");
    for (const hint of execution.transport.recoveryHints) {
      lines.push(`- ${hint}`);
    }
  }

  return lines.join("\n");
}

/**
 * @param {import("../../schema/company.js").companySchema._type} company
 * @param {string | undefined} selectedMotionId
 * @returns {string | null}
 */
function resolveResearchMotionId(company, selectedMotionId) {
  if (selectedMotionId) {
    if (!company.motionIds.includes(selectedMotionId)) {
      console.error(`Motion ${selectedMotionId} is not linked to company ${company.id}.`);
      return null;
    }

    return selectedMotionId;
  }

  if (company.motionIds.length === 1) {
    return company.motionIds[0];
  }

  if (company.motionIds.length === 0) {
    console.error(`Company ${company.id} is not linked to any motions yet.`);
    return null;
  }

  console.error(`Company ${company.id} is linked to multiple motions. Pass --motion <motion-id>.`);
  return null;
}
