// @ts-check

import { companySchema } from "../schema/company.js";
import { motionSchema } from "../schema/motion.js";

const PREFERRED_SIGNAL_WINDOW_DAYS = 180;
const MAX_SIGNAL_WINDOW_DAYS = 365;

/**
 * @param {unknown} rawCompany
 * @param {unknown} rawMotion
 */
export function buildCompanyResearchBrief(rawCompany, rawMotion) {
  const company = companySchema.parse(rawCompany);
  const motion = motionSchema.parse(rawMotion);
  const audienceById = new Map(motion.audienceHypotheses.map((audience) => [audience.id, audience]));
  const targetTitles = dedupeStrings([
    ...motion.targetingProfile.targetTitles,
    ...motion.audienceHypotheses.flatMap((audience) => audience.roleCriteria)
  ]);
  const stakeholderTargetCount = motion.targetingProfile.stakeholderTargetCount;
  const stakeholderMinimumCount = Math.min(stakeholderTargetCount, 2);
  const companySignals = motion.signals.filter((signal) => signal.scope === "company" || signal.scope === "both");
  const personSignals = motion.signals.filter((signal) => signal.scope === "person" || signal.scope === "both");

  return {
    company: {
      id: company.id,
      name: company.name,
      domain: company.domain,
      websiteUrl: company.websiteUrl,
      linkedinCompanyUrl: company.linkedinCompanyUrl,
      motionIds: company.motionIds
    },
    motion: {
      id: motion.id,
      name: motion.name,
      premise: motion.premise.statement,
      audienceHypotheses: motion.audienceHypotheses.map((audience) => ({
        id: audience.id,
        name: audience.name,
        companyCriteria: audience.companyCriteria,
        roleCriteria: audience.roleCriteria,
        confidence: audience.confidence
      })),
      targetTitles
    },
    researchPath: [
      company.websiteUrl
        ? `Start on the company site at ${company.websiteUrl} and inspect newsroom, press, product, merchant, and company pages for recent motion evidence.`
        : "Find the canonical company website first, then store it in Exo before finishing research.",
      "Check the company site first before broader web search so you capture first-party evidence and current positioning.",
      "Check Google and recent web/news results against the motion's signal questions, not just generic company coverage.",
      "Only keep signal matches that are recent enough to mention naturally in outreach without sounding stale.",
      "Do not persist every finding as a signal. Only store the few strongest, synthesized writer-usable matches.",
      "If the exact prospect title does not exist, move to the best-fit owner at director level or above whose function matches the signal.",
      "For chosen people, check recent public activity and recent posts. Treat legitimate recent posting as positive evidence the channel is active.",
      "View the selected prospect profiles before first touch and write that viewback into Exo.",
      "Use whatever contact-enrichment tools are actually available in the current runtime to find verified direct emails and verified mobile phone numbers for the chosen people when possible so the motion has stronger fallback paths if LinkedIn is blocked or gets no reply."
    ],
    stateWritebacks: [
      company.websiteUrl
        ? `Confirm or refresh the stored website with: exo companies update ${company.id} --website-url <canonical-url> --json`
        : `Store the discovered website with: exo companies update ${company.id} --website-url <canonical-url> --json`,
      `Store a canonical LinkedIn company page when found with: exo companies update ${company.id} --linkedin-company-url <linkedin-company-url> --json`,
      `Persist each chosen prospect with: exo companies prospects add ${company.id} --motion ${motion.id} --name "Person Name" --title "Director Title" --email person@example.com --profile-viewed-at <iso-datetime> --active-channel linkedin --live-signal-summary "Recent post shows active merchant-risk commentary." --live-signal-url <activity-url> --live-signal-observed-at <iso-datetime> --engagement-rationale "Recent posting is positive evidence this channel is live." --why-relevant "Why this person matters now" --json`,
      `Persist the first governed branch with: exo companies cadence set ${company.id} --motion ${motion.id} --prospect <prospect-id> --current-step connection-request --next-action "Send the first touch" --json`
    ],
    signalRecency: {
      preferredWindowDays: PREFERRED_SIGNAL_WINDOW_DAYS,
      maximumWindowDays: MAX_SIGNAL_WINDOW_DAYS,
      rules: [
        `Prefer signal evidence from the last ${PREFERRED_SIGNAL_WINDOW_DAYS} days.`,
        `Use ${PREFERRED_SIGNAL_WINDOW_DAYS + 1}-${MAX_SIGNAL_WINDOW_DAYS} day evidence only when the change still appears active and conversationally safe.`,
        `Do not use evidence older than ${MAX_SIGNAL_WINDOW_DAYS} days as a primary why-now trigger.`
      ]
    },
    signalChecklist: companySignals.map((signal) => ({
      id: signal.id,
      name: signal.name,
      scope: signal.scope,
      question: signal.question,
      whyItMatters: signal.whyItMatters,
      matchRule: signal.matchRule,
      audiences: signal.audienceIds
        .map((audienceId) => audienceById.get(audienceId))
        .filter(Boolean)
        .map((audience) => audience.name),
      observationPlan: buildObservationPlan(company, signal)
    })),
    personSignalChecklist: personSignals.map((signal) => ({
      id: signal.id,
      name: signal.name,
      scope: signal.scope,
      question: signal.question,
      whyItMatters: signal.whyItMatters,
      matchRule: signal.matchRule,
      audiences: signal.audienceIds
        .map((audienceId) => audienceById.get(audienceId))
        .filter(Boolean)
        .map((audience) => audience.name),
      observationPlan: buildObservationPlan(company, signal)
    })),
    prospectPlan: {
      minimumCount: stakeholderMinimumCount,
      targetCount: stakeholderTargetCount,
      seniorityFloor: "director",
      preferredTitles: targetTitles,
      rules: [
        `Choose up to ${stakeholderTargetCount} people for the first pass. Keep the set tight and useful.`,
        "Pick the most appropriate prospect first, then add only the strongest adjacent operators or sponsors.",
        "Start at director level or above.",
        "Use exact target-title matches first when they exist.",
        "If exact matches are missing, push to the closest best-fit owner whose scope matches the signal and premise.",
        "Capture adjacent operator or sponsor roles when the organization splits ownership across risk, operations, product, analytics, finance, or collections.",
        "Recent post activity is positive evidence that the person is active on that channel. Use it to guide channel choice and warmup, not to justify fake engagement.",
        "Store direct email when available and store verified mobile numbers when they are defensible, so the plan can fall back cleanly if LinkedIn is unavailable or cold.",
        "Do not leave the prospect choice in notes. Persist the chosen people back into Exo.",
        "Cadence is prospect-specific. Set the real first branch and next action on each chosen person instead of leaving the branch in notes.",
        "Exo stores the cadence branch and the engagement history. The agent writes the actual messages."
      ],
      requiredOutputs: [
        "one likely primary owner",
        stakeholderTargetCount > 1
          ? "one or more additional director-plus prospects or adjacent owners"
          : "no extra people unless the motion count is raised",
        "a short reason each person is relevant to the signal or premise",
        "stored recent-activity context for any person whose active channel matters to the plan",
        "stored verified email fallback and any verified mobile number for each person where you can find them",
        "a stored first cadence branch for the primary prospect"
      ]
    },
    completionCriteria: [
      "The canonical company website is stored in Exo.",
      "At least one recent company-level signal match is captured or an explicit no-signal finding is recorded.",
      "Stored signal matches are synthesized and concise enough for the writer to reuse directly.",
      "The chosen prospect set is stored in Exo, starting with the best-fit owner.",
      "Chosen prospects include viewed-profile evidence, recent-activity context, direct email, and verified mobile numbers when those are available.",
      "The strongest signal match can be used as a real reason to talk to the primary prospect.",
      "A cadence branch is stored in Exo for the primary prospect.",
      "That cadence branch states the real next action, not generic planning filler."
    ]
  };
}

/**
 * @param {import("../schema/company.js").companySchema._type} company
 * @param {import("../schema/signal.js").signalSchema._type} signal
 */
function buildObservationPlan(company, signal) {
  const methods = signal.observationMethods.length ? signal.observationMethods : inferDefaultObservationMethods(signal);

  return methods.map((method) => {
    if (method.surface === "company-site") {
      return {
        surface: method.surface,
        query: method.query,
        notes:
          method.notes
          ?? (company.websiteUrl
            ? `Check ${company.websiteUrl} plus newsroom, product, merchant, and company pages for first-party evidence that answers this question.`
            : "Find the canonical company site, store it, then inspect newsroom, product, merchant, and company pages.")
      };
    }

    if (method.surface === "google") {
      return {
        surface: method.surface,
        query: method.query ?? `${company.name} ${signal.question}`,
        notes:
          method.notes
          ?? "Use Google to look for recent signal evidence beyond the corporate site. Prefer current results and cross-check against the motion question."
      };
    }

    if (method.surface === "news") {
      return {
        surface: method.surface,
        query: method.query ?? `${company.name} recent news ${signal.name}`,
        notes:
          method.notes
          ?? "Look for recent press, financing, partnership, launch, merchant, regulatory, or hiring changes that make the signal conversationally usable."
      };
    }

    return {
      surface: method.surface,
      query: method.query,
      notes: method.notes ?? null
    };
  });
}

/**
 * @param {import("../schema/signal.js").signalSchema._type} signal
 */
function inferDefaultObservationMethods(signal) {
  if (signal.scope === "person") {
    return [
      { surface: "linkedin", query: null, notes: "Check current role, recent changes, and adjacent role ownership." },
      { surface: "google", query: null, notes: "Check public results for recent role changes or relevant public mentions." }
    ];
  }

  return [
    { surface: "company-site", query: null, notes: null },
    { surface: "google", query: null, notes: null },
    { surface: "news", query: null, notes: null }
  ];
}

/**
 * @param {string[]} values
 */
function dedupeStrings(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
