#!/usr/bin/env node
// @ts-check

import {
  renderCompanyList,
  renderCompanyMotions,
  renderCompanyResearchBrief,
  renderCompanySummary
} from "../../artifacts/render-company.js";
import { addCompany } from "../../core/add-company.js";
import { assignCompanyProfile } from "../../core/assign-company-profile.js";
import { assignCompanyUser } from "../../core/assign-company-user.js";
import { buildCompanyResearchBrief } from "../../core/build-company-research-brief.js";
import { recordMotionProspect, updateMotionProspect } from "../../core/record-prospect.js";
import { recordMotionProspectTouch } from "../../core/record-prospect-touch.js";
import { recordMotionSignalMatch } from "../../core/record-signal-match.js";
import { setMotionProspectCadence } from "../../core/set-prospect-cadence.js";
import { setMotionProspectOpeningPlan } from "../../core/set-prospect-opening-plan.js";
import { setMotionProspectThroughLine } from "../../core/set-prospect-through-line.js";
import { updateCompanyRecord } from "../../core/update-company.js";
import {
  findBrowserProfileById,
  findCompanyById,
  findCompanyByIdentity,
  findMotionById,
  findUserById,
  insertCompany,
  listBrowserProfiles,
  listCompanies,
  searchCompanies,
  updateCompany,
  updateMotion
} from "../../db/database.js";
import { browserProfileSchema } from "../../schema/browser-profile.js";
import { normalizeRepeatedStringList, normalizeStringList } from "../../lib/collections.js";
import { companySchema } from "../../schema/company.js";
import { motionSchema } from "../../schema/motion.js";

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
  exo companies signal-matches show <company-id>
  exo companies signal-matches add <company-id>
  exo companies prospects show <company-id>
  exo companies prospects add <company-id>
  exo companies prospects update <company-id>
  exo companies through-line show <company-id>
  exo companies through-line set <company-id>
  exo companies opening-plan show <company-id>
  exo companies opening-plan set <company-id>
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
  - Once outreach starts, pin one execution user or browser identity to the company so follow-up work stays consistent.
  - Use exo companies research-brief before live account research so the agent works from signals, recent evidence, and best-fit prospect fallback.
  - Persist signal matches on the motion-owned target account, not on the canonical company itself.
  - Persist the chosen prospects, their through-lines, their opening plans, and their cadence state on the same motion-owned target account.
  - Persist the real engagement touch history on the same prospect record so later draft cases can stay contextually grounded.
  - Treat stored signal matches, prospect through-lines, and opening plans as the writing and engagement source of truth.
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

  companyProfile
    .command("assign")
    .description("Pin one registered browser profile to a company for sticky engagement identity.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--profile <profile-id>", "Browser profile identifier")
    .option("--by <actor>", "Who made the assignment")
    .option("--reason <reason>", "Why this profile is being pinned")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies profile assign <company-id> --profile <profile-id> --reason "Use Audienti identity for all prospect engagement"

Rules:
  - The profile must already be registered in Exo.
  - The profile must be ready before it can be pinned.
  - Once pinned, profile resolution for this company should stay sticky.
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
    .description("Pin one execution user to a company so each capability can resolve through the right account.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--user <user-id>", "Execution user identifier")
    .option("--browser-capability <capability>", "Browser capability to project onto the legacy company profile pin. Defaults to linkedin.")
    .option("--by <actor>", "Who made the assignment")
    .option("--reason <reason>", "Why this user is being pinned")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies user assign <company-id> --user <user-id> --reason "Use one human identity across LinkedIn and email"

Rules:
  - The user must already exist in Exo.
  - The user can own multiple accounts backed by different browser profiles or harness connectors.
  - Exo will still project the chosen browser capability into the legacy sticky profile field when possible.
`
    )
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
        browserCapability: options.browserCapability ?? "linkedin"
      });
      updateCompany(updated);

      if (options.json) {
        console.log(JSON.stringify(updated, null, 2));
        return;
      }

      console.log(renderCompanySummary(updated));
    });

  companies
    .command("show")
    .description("Show one canonical company record.")
    .argument("<company-id>", "Company identifier")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo companies show <company-id>
  exo companies show <company-id> --json
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

      if (options.json) {
        console.log(JSON.stringify(company, null, 2));
        return;
      }

      console.log(renderCompanySummary(company));
    });

  companies
    .command("update")
    .description("Update a canonical company record in place.")
    .argument("<company-id>", "Company identifier")
    .option("--name <name>", "Company name")
    .option("--domain <domain>", "Company domain")
    .option("--website-url <url>", "Company website URL")
    .option("--linkedin-company-url <url>", "LinkedIn company URL")
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
        const storedMotion = updateMotion(updatedMotion);
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

  prospects
    .command("add")
    .description("Persist one chosen prospect on the motion-owned target account.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--name <name>", "Prospect name")
    .requiredOption("--title <title>", "Prospect title")
    .requiredOption("--why-relevant <text>", "Short reason this person matters for the motion")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--linkedin-profile-url <url>", "LinkedIn profile URL")
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
        const updatedMotion = recordMotionProspect(rawMotion, company, buildProspectInputFromOptions(options));
        const storedMotion = updateMotion(updatedMotion);
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
            `Contact Enrichment: ${storedProspect.contactEnrichmentState.status}`
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
  - This path preserves the existing prospect record and its through-line, opening plan, cadence state, and touches.
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
        const updatedMotion = updateMotionProspect(rawMotion, company, {
          prospectId: options.prospect,
          ...buildProspectInputFromOptions(options)
        });
        const storedMotion = updateMotion(updatedMotion);
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
            `Contact Enrichment: ${storedProspect.contactEnrichmentState.status}`
          ].join("\n")
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  const throughLine = companies
    .command("through-line")
    .description("Inspect or set the stored prospect through-line for one company in one motion.");

  throughLine
    .command("show")
    .description("Show the stored prospect through-line for one company in one motion.")
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
        throughLine: prospect?.throughLine ?? null
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!prospect || prospect.throughLine.status !== "ready") {
        console.log(`No stored through-line for prospect ${options.prospect} on ${company.name} in motion ${motion.name}.`);
        return;
      }

      console.log(renderThroughLineDetail(company.name, motion.name, prospect));
    });

  throughLine
    .command("set")
    .description("Persist the prospect-specific through-line.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier")
    .requiredOption("--specific-to-them <text>", "What is specific to this person")
    .requiredOption("--shared-problem <text>", "Shared problem they likely live inside")
    .requiredOption("--why-now <text>", "Why now for this person")
    .requiredOption("--legitimate-wedge <text>", "Legitimate wedge that earns a reply")
    .requiredOption("--compression-line <text>", "One-sentence compression test line")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--signal-match <signal-match-id>", "Supporting signal-match id; repeat for multiple", collect, [])
    .option("--json", "Emit machine-readable JSON")
    .action((companyId, options) => {
      const context = loadCompanyMotionContext(companyId, options.motion);
      if (!context) {
        process.exitCode = 1;
        return;
      }

      const { company, rawMotion } = context;

      try {
        const updatedMotion = setMotionProspectThroughLine(rawMotion, company, {
          prospectId: options.prospect,
          signalMatchIds: normalizeStringList(options.signalMatch),
          specificToThem: options.specificToThem,
          sharedProblem: options.sharedProblem,
          whyNow: options.whyNow,
          legitimateWedge: options.legitimateWedge,
          compressionLine: options.compressionLine
        });
        const storedMotion = updateMotion(updatedMotion);
        const account = storedMotion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;
        const prospect = account?.prospects.find((item) => item.id === options.prospect) ?? null;
        const result = {
          company,
          motion: { id: storedMotion.id, name: storedMotion.name },
          prospect,
          throughLine: prospect?.throughLine ?? null
        };

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (!prospect || prospect.throughLine.status !== "ready") {
          console.log(`No through-line was stored for prospect ${options.prospect}.`);
          return;
        }

        console.log(renderThroughLineDetail(company.name, storedMotion.name, prospect));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  const openingPlan = companies
    .command("opening-plan")
    .description("Inspect or set the stored prospect opening plan for one company in one motion.");

  openingPlan
    .command("show")
    .description("Show the stored prospect opening plan for one company in one motion.")
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
        openingPlan: prospect?.openingPlan ?? null
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!prospect || prospect.openingPlan.status !== "ready") {
        console.log(`No stored opening plan for prospect ${options.prospect} on ${company.name} in motion ${motion.name}.`);
        return;
      }

      console.log(renderOpeningPlanDetail(company.name, motion.name, prospect));
    });

  openingPlan
    .command("set")
    .description("Persist the first opening plan for one prospect.")
    .argument("<company-id>", "Company identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier")
    .requiredOption("--signal-match <signal-match-id>", "Supporting signal-match id; repeat for multiple", collect, [])
    .requiredOption("--why-now <text>", "Why this is worth mentioning now")
    .requiredOption("--angle <text>", "Primary opening angle")
    .requiredOption("--reply-path <text>", "Most likely legitimate path, given the evidence, to get this person to reply")
    .requiredOption("--primary-channel <channel>", "Primary channel: connection-request, direct-message, inmail, email, or none")
    .requiredOption("--fallback-channel <channel>", "Fallback channel if the primary path is blocked or cold")
    .requiredOption("--fallback-trigger <text>", "When to use the fallback path")
    .requiredOption("--first-move <text>", "First move to engage this prospect")
    .requiredOption("--first-message-goal <text>", "Desired response or outcome from the first touch")
    .option("--motion <motion-id>", "Motion identifier when a company is linked to more than one motion")
    .option("--supporting-prospect <prospect-id>", "Additional supporting prospect id; repeat for multiple", collect, [])
    .option("--preflight-action <text>", "Action to take before first outreach", collect, [])
    .option("--talking-point <text>", "Supporting talking point; repeat for multiple", collect, [])
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
        const updatedMotion = setMotionProspectOpeningPlan(rawMotion, company, {
          prospectId: options.prospect,
          supportingProspectIds: normalizeStringList(options.supportingProspect),
          signalMatchIds: normalizeStringList(options.signalMatch),
          whyNow: options.whyNow,
          angle: options.angle,
          replyPath: options.replyPath,
          primaryChannel: normalizeOutreachChannel(options.primaryChannel),
          fallbackChannel: normalizeOutreachChannel(options.fallbackChannel),
          fallbackTrigger: options.fallbackTrigger,
          preflightActions: normalizeRepeatedStringList(options.preflightAction),
          firstMove: options.firstMove,
          firstMessageGoal: options.firstMessageGoal,
          talkingPoints: normalizeRepeatedStringList(options.talkingPoint),
          notes: options.notes
        });
        const storedMotion = updateMotion(updatedMotion);
        const account = storedMotion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;
        const prospect = account?.prospects.find((item) => item.id === options.prospect) ?? null;
        const result = {
          company,
          motion: { id: storedMotion.id, name: storedMotion.name },
          prospect,
          openingPlan: prospect?.openingPlan ?? null
        };

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (!prospect || prospect.openingPlan.status !== "ready") {
          console.log(`No opening plan was stored for prospect ${options.prospect}.`);
          return;
        }

        console.log(renderOpeningPlanDetail(company.name, storedMotion.name, prospect));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
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
        const updatedMotion = setMotionProspectCadence(rawMotion, company, {
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
        const storedMotion = updateMotion(updatedMotion);
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
        const updatedMotion = recordMotionProspectTouch(rawMotion, company, {
          prospectId: options.prospect,
          surface: normalizeTouchSurface(options.surface),
          direction: normalizeTouchDirection(options.direction),
          outcome: normalizeCadenceOutcome(options.outcome),
          occurredAt: options.occurredAt,
          summary: options.summary,
          subject: options.subject,
          body: options.body,
          sourceUrl: options.sourceUrl,
          notes: options.notes
        });
        const storedMotion = updateMotion(updatedMotion);
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

/**
 * @param {Record<string, any>} options
 */
function buildProspectInputFromOptions(options) {
  const contactPoints = parseContactPointOptions(options.contactPoint);
  const contactEnrichmentState = buildContactEnrichmentInput(options);

  return {
    name: options.name,
    title: options.title,
    linkedinProfileUrl: options.linkedinProfileUrl,
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
    contactPoints: contactPoints.length ? contactPoints : undefined,
    contactEnrichmentState,
    notes: options.notes,
    signalMatchIds: normalizeStringList(options.signalMatch)
  };
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
    `Live Signal: ${prospect.liveSignal.summary ?? "none"}`,
    `Contact Points: ${prospect.contactPoints.length ? prospect.contactPoints.map((point) => `${point.kind}=${point.value}`).join(" | ") : "none"}`,
    `Contact Enrichment: ${prospect.contactEnrichmentState.status}`,
    `Through-Line: ${prospect.throughLine.status}`,
    `Opening Plan: ${prospect.openingPlan.status}`,
    `Cadence: ${prospect.cadenceState.status}`
  ];

  if (prospect.throughLine.status === "ready") {
    lines.push(`Compression: ${prospect.throughLine.compressionLine ?? "none"}`);
  }

  if (prospect.openingPlan.status === "ready") {
    lines.push(`Reply Path: ${prospect.openingPlan.replyPath ?? "none"}`);
  }

  return lines.join("\n");
}

/**
 * @param {string} companyName
 * @param {string} motionName
 * @param {import("../../schema/target-account.js").prospectSchema._type} prospect
 */
function renderThroughLineDetail(companyName, motionName, prospect) {
  return [
    `Through-Line: ${companyName}`,
    `Motion: ${motionName}`,
    `Prospect: ${prospect.name} (${prospect.title})`,
    `Specific To Them: ${prospect.throughLine.specificToThem ?? "none"}`,
    `Shared Problem: ${prospect.throughLine.sharedProblem ?? "none"}`,
    `Why Now: ${prospect.throughLine.whyNow ?? "none"}`,
    `Legitimate Wedge: ${prospect.throughLine.legitimateWedge ?? "none"}`,
    `Compression Line: ${prospect.throughLine.compressionLine ?? "none"}`,
    `Signal Match Ids: ${prospect.throughLine.signalMatchIds.join(", ") || "none"}`
  ].join("\n");
}

/**
 * @param {string} companyName
 * @param {string} motionName
 * @param {import("../../schema/target-account.js").prospectSchema._type} prospect
 */
function renderOpeningPlanDetail(companyName, motionName, prospect) {
  return [
    `Opening Plan: ${companyName}`,
    `Motion: ${motionName}`,
    `Prospect: ${prospect.name} (${prospect.title})`,
    `Why Now: ${prospect.openingPlan.whyNow ?? "none"}`,
    `Angle: ${prospect.openingPlan.angle ?? "none"}`,
    `Reply Path: ${prospect.openingPlan.replyPath ?? "none"}`,
    `Primary Channel: ${prospect.openingPlan.primaryChannel ?? "none"}`,
    `Fallback Channel: ${prospect.openingPlan.fallbackChannel ?? "none"}`,
    `Fallback Trigger: ${prospect.openingPlan.fallbackTrigger ?? "none"}`,
    `First Move: ${prospect.openingPlan.firstMove ?? "none"}`,
    `First Message Goal: ${prospect.openingPlan.firstMessageGoal ?? "none"}`,
    `Preflight Actions: ${prospect.openingPlan.preflightActions.join(" | ") || "none"}`,
    `Supporting Prospects: ${prospect.openingPlan.supportingProspectIds.join(", ") || "none"}`
  ].join("\n");
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
