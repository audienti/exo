// @ts-check

import { companySchema } from "../schema/company.js";
import { motionSchema } from "../schema/motion.js";
import { withDerivedTargetAccountQueueState } from "../lib/motion-queue.js";
import { buildMotionPacketSummary } from "../lib/motion-packets.js";
import { readWorkspaceSettings, resolveWorkspaceEnrichmentPolicy } from "../lib/workspace-settings.js";
import { buildMotionProspectView } from "./build-motion-prospect-view.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown[]} rawCompanies
 * @param {string} packetId
 */
export function buildMotionPacketBrief(rawMotion, rawCompanies, packetId) {
  const motion = motionSchema.parse(rawMotion);
  const companies = Array.isArray(rawCompanies)
    ? rawCompanies.map((company) => companySchema.parse(company))
    : [];
  const packetSummary = buildMotionPacketSummary(motion, companies);
  const packet = packetSummary.items.find((item) => item.packetId === packetId) ?? null;

  if (!packet) {
    throw new Error(`Packet ${packetId} is not active on motion ${motion.id}.`);
  }

  const company = companies.find((item) => item.id === packet.companyId) ?? null;
  if (!company) {
    throw new Error(`Company ${packet.companyId} is not available for packet ${packetId}.`);
  }

  const account = motion.targetMap.accounts
    .map((item) => withDerivedTargetAccountQueueState(item))
    .find((item) => item.companyId === packet.companyId) ?? null;

  if (packet.packetKind === "company_research") {
    return buildCompanyResearchPacketBrief(motion, company, account, packet);
  }

  if (!account) {
    throw new Error(`Company ${packet.companyId} is not targeted in motion ${motion.id}.`);
  }

  if (packet.packetKind === "prospect_selection") {
    return buildProspectSelectionPacketBrief(motion, company, account, packet);
  }

  if (packet.packetKind === "prospect_research") {
    return buildProspectResearchPacketBrief(motion, company, packet);
  }

  throw new Error(`Unsupported packet kind: ${packet.packetKind}`);
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @param {import("../schema/company.js").companySchema._type} company
 * @param {ReturnType<typeof withDerivedTargetAccountQueueState> | null} account
 * @param {ReturnType<typeof buildMotionPacketSummary>["items"][number]} packet
 */
function buildCompanyResearchPacketBrief(motion, company, account, packet) {
  const signalChecklist = motion.signals
    .filter((signal) => signal.scope === "company" || signal.scope === "both")
    .map((signal) => ({
      id: signal.id,
      name: signal.name,
      question: signal.question,
      whyItMatters: signal.whyItMatters
    }));

  return {
    motion: buildMotionSummary(motion),
    packet: buildPacketIdentity(packet),
    summary: `Research ${company.name} against the motion premise and persist only strong recent company-level signal evidence.`,
    scope: {
      kind: "company_research",
      focus: `${company.name} only. Do not fan out into multi-company work inside this packet.`,
      constraints: [
        "Stay at the company-signal layer in this packet.",
        "Do not manufacture stakeholders yet unless the account already has them stored.",
        "Persist only concise, writer-usable signals."
      ]
    },
    inputs: {
      company: {
        id: company.id,
        name: company.name,
        domain: company.domain,
        websiteUrl: company.websiteUrl,
        linkedinCompanyUrl: company.linkedinCompanyUrl
      },
      premise: motion.premise.statement,
      audienceHypotheses: motion.audienceHypotheses.map((audience) => audience.name),
      signalChecklist,
      storedSignalMatchCount: account?.signalMatches.length ?? 0
    },
    doneWhen: [
      "The canonical website is stored or confirmed in Exo.",
      "The canonical LinkedIn company page is stored when found.",
      "At least one recent company-level signal match is persisted, or the packet notes explain why no strong signal was found.",
      "Stored signal matches are concise enough to reuse in downstream prospect work.",
      "The packet is completed as researched, suppressed, or exhausted with explicit notes."
    ],
    writeback: {
      claimCommand: `exo companies queue claim ${company.id} --motion ${motion.id} --worker <worker-label> --notes "Why this worker is taking the packet" --json`,
      supportingCommands: [
        company.websiteUrl
          ? `exo companies update ${company.id} --website-url <canonical-url> --json`
          : `exo companies update ${company.id} --website-url <canonical-url> --json`,
        `exo companies update ${company.id} --linkedin-company-url <linkedin-company-url> --json`,
        `exo companies signal-matches add ${company.id} --motion ${motion.id} --signal <signal-id> --summary "Concise writer-usable signal summary" --source-url <source-url> --observed-at <iso-datetime> --confidence high --json`
      ],
      completeCommands: [
        `exo companies queue complete ${company.id} --motion ${motion.id} --worker <worker-label> --next-status researched --notes "Stored the strongest signal evidence and the account is ready for prospect selection." --json`,
        `exo companies queue complete ${company.id} --motion ${motion.id} --worker <worker-label> --next-status suppressed --notes "Explain why this account should stay out of the motion." --json`,
        `exo companies queue complete ${company.id} --motion ${motion.id} --worker <worker-label> --next-status exhausted --notes "Explain why the account is not worth more research." --json`
      ]
    },
    reviewSignals: [
      "Strong first-party or recent public evidence tied directly to the motion signal questions.",
      "Stored reasons to talk that can survive into prospect selection without re-research."
    ]
  };
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @param {import("../schema/company.js").companySchema._type} company
 * @param {ReturnType<typeof withDerivedTargetAccountQueueState>} account
 * @param {ReturnType<typeof buildMotionPacketSummary>["items"][number]} packet
 */
function buildProspectSelectionPacketBrief(motion, company, account, packet) {
  const selectedCount = account.prospects.filter((prospect) => prospect.queueState?.status === "selected").length;
  const signalSummaries = account.signalMatches.map((match) => ({
    id: match.id,
    signalName: match.signalName,
    summary: match.summary,
    confidence: match.confidence,
    observedAt: match.observedAt
  }));

  return {
    motion: buildMotionSummary(motion),
    packet: buildPacketIdentity(packet),
    summary: `Choose the best-fit stakeholders at ${company.name} and persist them as selected prospects for downstream prospect research.`,
    scope: {
      kind: "prospect_selection",
      focus: `${company.name} only. Pick the smallest credible stakeholder set for the motion.`,
      constraints: [
        `Target ${motion.targetingProfile.stakeholderTargetCount} stakeholders or fewer.`,
        "Start with the most likely primary owner, then add only the strongest adjacent operators or sponsors.",
        "Do not do full cadence planning in this packet."
      ]
    },
    inputs: {
      company: {
        id: company.id,
        name: company.name,
        domain: company.domain,
        websiteUrl: company.websiteUrl,
        linkedinCompanyUrl: company.linkedinCompanyUrl
      },
      premise: motion.premise.statement,
      targetTitles: motion.targetingProfile.targetTitles,
      roleFamilies: motion.targetingProfile.roleFamilies,
      stakeholderTargetCount: motion.targetingProfile.stakeholderTargetCount,
      storedSignalMatches: signalSummaries,
      existingProspects: account.prospects.map((prospect) => ({
        id: prospect.id,
        name: prospect.name,
        title: prospect.title,
        queueStatus: prospect.queueState?.status ?? "selected"
      })),
      selectedCount
    },
    doneWhen: [
      "A credible primary owner is stored as a prospect.",
      "Additional stakeholders are stored only when they strengthen the committee map.",
      "Each stored prospect has why-relevant reasoning tied back to the signal or premise.",
      "If a selected prospect was justified from a LinkedIn profile, that profile viewback is landed into Exo before the packet is completed.",
      "Signal match ids are attached where the support is concrete.",
      "The packet is completed or explicitly suppressed/exhausted with notes."
    ],
    writeback: {
      claimCommand: `exo companies queue claim ${company.id} --motion ${motion.id} --worker <worker-label> --notes "Taking prospect selection for this researched account." --json`,
      supportingCommands: [
        `exo companies prospects add ${company.id} --motion ${motion.id} --name "Person Name" --title "Director Title" --buying-committee-role primary_business_owner --decision-authority influences --why-relevant "Why this person matters now" --signal-match <signal-match-id> --linkedin-profile-url <linkedin-profile-url> --json`,
        `exo companies prospects enrich-linkedin-profile-live ${company.id} --motion ${motion.id} --prospect <prospect-id> --runtime codex --json`,
        `exo companies prospects update ${company.id} --motion ${motion.id} --prospect <prospect-id> --why-relevant "Refined reason this person matters" --json`
      ],
      completeCommands: [
        `exo companies queue complete ${company.id} --motion ${motion.id} --worker <worker-label> --notes "Stored the chosen stakeholder set with the profile viewbacks already used to justify it and handed the account to prospect research." --json`,
        `exo companies queue complete ${company.id} --motion ${motion.id} --worker <worker-label> --next-status suppressed --notes "Explain why this researched account should not advance." --json`,
        `exo companies queue complete ${company.id} --motion ${motion.id} --worker <worker-label> --next-status exhausted --notes "Explain why no viable stakeholders exist here." --json`
      ]
    },
    reviewSignals: [
      "The primary owner is defensible from title, function, and signal fit.",
      "The selected set is tight enough that downstream research is focused rather than bloated."
    ]
  };
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @param {import("../schema/company.js").companySchema._type} company
 * @param {ReturnType<typeof buildMotionPacketSummary>["items"][number]} packet
 */
function buildProspectResearchPacketBrief(motion, company, packet) {
  if (!packet.prospectId) {
    throw new Error(`Prospect research packet ${packet.packetId} is missing a prospect id.`);
  }
  const runtimeEnrichmentRule = buildWorkspaceEnrichmentRule();

  const prospectView = buildMotionProspectView(motion, {
    companyId: company.id,
    prospectId: packet.prospectId
  });

  if (!prospectView.writingBrief) {
    throw new Error(`Prospect ${packet.prospectId} does not have a writing brief in motion ${motion.id}.`);
  }

  const brief = prospectView.writingBrief;

  return {
    motion: buildMotionSummary(motion),
    packet: buildPacketIdentity(packet),
    summary: `Complete the four-layer prospect research, runtime-aware contact enrichment, and cadence for ${brief.prospect.name}.`,
    scope: {
      kind: "prospect_research",
      focus: `${brief.prospect.name} at ${company.name} only.`,
      constraints: [
        "Stay on one prospect. Do not open side quests on the rest of the account.",
        "Use only defensible signals and contact points.",
        "If LinkedIn identity is missing, search through the governed connected LinkedIn account path first before paid or provider LinkedIn identity lookup.",
        runtimeEnrichmentRule,
        "The packet is not done until the branch is actually ready for a first-touch decision."
      ]
    },
    inputs: {
      company: {
        id: company.id,
        name: company.name,
        domain: company.domain,
        websiteUrl: company.websiteUrl,
        linkedinCompanyUrl: company.linkedinCompanyUrl
      },
      prospect: {
        id: brief.prospect.prospectId,
        name: brief.prospect.name,
        title: brief.prospect.title,
        whyRelevant: brief.prospect.whyRelevant,
        linkedinProfileUrl: brief.prospect.linkedinProfileUrl,
        email: brief.prospect.email,
        queueStatus: brief.prospect.queueStatus,
        contactPoints: brief.prospect.contactPoints
      },
      execution: {
        companyExecutionCommand: `exo companies execution show ${company.id} --capability linkedin --json`,
        serialWriteRule: `Do not run parallel writes against ${company.name}. One worker should finish this company's prospect state changes before another worker touches the same account.`,
        liveBrowserRule: "Before any browser-backed LinkedIn step, load the company execution plan and honor its preferred transport, fallback transport, and failure classes.",
        linkedinIdentityRule: "If the prospect lacks a stored LinkedIn profile URL or alias, search through the governed connected LinkedIn account path first. In Codex this means the resolved Unipile-backed LinkedIn account. Use that connected-account search before paid or provider LinkedIn identity lookup. If the governed search is unavailable or exhausted, then move to provider identity lookup. If that governed search runs and still finds no defensible profile URL, record source-tried linkedin_connected_search before marking the prospect exhausted.",
        runtimeEnrichmentRule,
      },
      signalMatches: brief.signalMatches.map((match) => ({
        id: match.id,
        signalName: match.signalName,
        summary: match.summary,
        confidence: match.confidence,
        observedAt: match.observedAt
      })),
      currentState: {
        roleTruthStatus: brief.prospect.roleTruth.status,
        triggerWindowStatus: brief.prospect.triggerWindow.status,
        identityTellsStatus: brief.prospect.identityTells.status,
        liveSignalStatus: brief.prospect.liveSignal.status,
        cadenceStatus: brief.prospect.cadenceState.status,
        contactEnrichmentStatus: brief.prospect.contactEnrichmentState.status
      }
    },
    doneWhen: [
      "Role truth, trigger window, identity tells, and live signal are stored or explicitly exhausted.",
      "Contact enrichment state is updated and the best usable contact points are stored, including verified direct email and verified mobile phone numbers when found.",
      "Before a no-channel prospect is completed as exhausted, governed connected-account LinkedIn search was attempted and recorded as source-tried linkedin_connected_search.",
      "Cadence state is ready in Exo with a concrete next action.",
      "Any live browser-backed validation followed the company execution plan instead of an unqualified browser session.",
      "The packet is completed or explicitly suppressed/exhausted with notes."
    ],
    writeback: {
      claimCommand: `exo companies prospects claim ${company.id} --motion ${motion.id} --prospect ${brief.prospect.prospectId} --worker <worker-label> --notes "Taking full prospect research and planning packet." --json`,
      supportingCommands: [
        `exo companies execution show ${company.id} --capability linkedin --json`,
        `exo companies prospects enrich-linkedin-profile-live ${company.id} --motion ${motion.id} --prospect ${brief.prospect.prospectId} --runtime codex --json`,
        `exo companies prospects update ${company.id} --motion ${motion.id} --prospect ${brief.prospect.prospectId} --role-truth-summary "What role this person actually owns" --trigger-window-summary "Why now is live" --identity-tells-summary "Specific identity clues" --live-signal-summary "Recent public activity or explicit no-signal finding" --source-url <source-url> --observed-at <iso-datetime> --json`,
        `exo companies prospects update ${company.id} --motion ${motion.id} --prospect ${brief.prospect.prospectId} --contact-point '{"kind":"email","value":"person@example.com","matchStatus":"same_person_verified","verificationStatus":"verified","confidence":"high","source":"provider-or-public-web","usableForOutreach":true}' --contact-point '{"kind":"phone","value":"+1-555-0101","matchStatus":"same_person_verified","verificationStatus":"verified","confidence":"high","source":"provider-or-public-web","usableForOutreach":true}' --enrichment-status complete --source-tried gmail --source-tried public-web --best-direct-channel email --best-direct-channel phone --json`,
        `exo companies cadence set ${company.id} --motion ${motion.id} --prospect ${brief.prospect.prospectId} --current-step connection-request --next-action "Send connection request when capacity allows" --json`
      ],
      completeCommands: [
        `exo companies prospects complete ${company.id} --motion ${motion.id} --prospect ${brief.prospect.prospectId} --worker <worker-label> --notes "Prospect research, planning, and cadence are ready for operator review." --json`,
        `exo companies prospects complete ${company.id} --motion ${motion.id} --prospect ${brief.prospect.prospectId} --worker <worker-label> --next-status suppressed --notes "Explain why this prospect should stay out of the queue." --json`,
        `exo companies prospects complete ${company.id} --motion ${motion.id} --prospect ${brief.prospect.prospectId} --worker <worker-label> --next-status exhausted --notes "Explain why this prospect does not merit more research." --json`
      ]
    },
    reviewSignals: [
      "The prospect has a real why-now spine, not just generic ICP fit.",
      "The cadence branch can survive direct operator use without re-synthesizing the branch.",
      "The worker did not bypass the company execution plan or split the same company across racing writes."
    ]
  };
}

function buildWorkspaceEnrichmentRule() {
  const policy = resolveWorkspaceEnrichmentPolicy(readWorkspaceSettings());
  const emailProviders = policy.email.providers.length ? policy.email.providers.join(", ") : "none";
  const validators = policy.email.validators.length ? policy.email.validators.join(", ") : "none";
  const phoneProviders = policy.phone.providers.length ? policy.phone.providers.join(", ") : "none";
  const phoneRule = policy.phone.mobileOnly
    ? "Store mobile numbers only."
    : "Mobile-only filtering is off.";
  const whatsappRule = policy.phone.preferWhatsappCapable
    ? "Prefer WhatsApp-capable evidence when a provider can prove it."
    : "Do not prioritize WhatsApp-capable evidence.";

  return `When contact enrichment is still open, inspect the current runtime and use whatever email-finding, phone-finding, and validation tools are actually available. For this workspace, the direct email provider order is ${emailProviders}; email validation providers are ${validators}; direct phone provider order is ${phoneProviders}. ${phoneRule} ${whatsappRule}`;
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 */
function buildMotionSummary(motion) {
  return {
    id: motion.id,
    name: motion.name,
    status: motion.status,
    premise: motion.premise.statement,
    stakeholderTargetCount: motion.targetingProfile.stakeholderTargetCount
  };
}

/**
 * @param {ReturnType<typeof buildMotionPacketSummary>["items"][number]} packet
 */
function buildPacketIdentity(packet) {
  return {
    id: packet.packetId,
    kind: packet.packetKind,
    claimState: packet.claimState,
    companyId: packet.companyId,
    companyName: packet.companyName,
    prospectId: packet.prospectId ?? null,
    prospectName: packet.prospectName ?? null,
    prospectTitle: packet.prospectTitle ?? null,
    queueStatus: packet.queueStatus,
    workerLabel: packet.workerLabel,
    claimedAt: packet.claimedAt,
    notes: packet.notes
  };
}
