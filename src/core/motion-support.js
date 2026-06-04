// @ts-check

import crypto from "node:crypto";
import { audienceHypothesisSchema } from "../schema/audience-hypothesis.js";
import { premiseSchema } from "../schema/premise.js";
import { signalSchema } from "../schema/signal.js";

/**
 * @param {string | null} title
 * @param {string | null} description
 * @returns {string}
 */
export function buildSourceSummary(title, description) {
  const parts = [title, description].filter(Boolean);
  if (!parts.length) {
    return "Source page fetched, but no reliable title or description was available yet.";
  }

  return parts.join(" — ");
}

/**
 * @param {{
 *   explicitName?: string | null,
 *   seed?: string | null,
 *   attempt?: number,
 *   forceGenerated?: boolean
 * }} input
 * @returns {string}
 */
export function buildMotionName(input) {
  const explicitName = normalizeNullableString(input.explicitName);
  if (explicitName && !input.forceGenerated) {
    return explicitName;
  }

  return generateMotionCodename(input.seed ?? explicitName ?? "motion", input.attempt ?? 0);
}

/**
 * @param {string | null | undefined} name
 * @returns {boolean}
 */
export function shouldGenerateMotionName(name) {
  const normalized = normalizeNullableString(name);
  if (!normalized) {
    return true;
  }

  if (isGeneratedMotionName(normalized)) {
    return false;
  }

  return /\bmotion$/i.test(normalized);
}

/**
 * @param {string | null | undefined} name
 * @returns {boolean}
 */
export function isGeneratedMotionName(name) {
  const normalized = normalizeNullableString(name);
  if (!normalized) {
    return false;
  }

  const parts = normalized.split("-");
  if (parts.length !== 3) {
    return false;
  }

  const [first, second, animal] = parts;
  return ADJECTIVES.includes(first) && ADJECTIVES.includes(second) && ANIMALS.includes(animal);
}

/**
 * @param {{ statement?: string | null, notes?: string | null, source?: "operator" | "inferred" | "mixed" } | null | undefined} input
 * @returns {import("../schema/premise.js").premiseSchema._type}
 */
export function buildPremise(input) {
  const statement = normalizeNullableString(input?.statement);
  const notes = normalizeNullableString(input?.notes);

  return premiseSchema.parse({
    statement,
    notes,
    source: input?.source ?? "operator",
    status: statement ? "defined" : "missing"
  });
}

/**
 * @param {Array<string | {
 *   id?: string,
 *   name: string,
 *   companyCriteria?: string[],
 *   roleCriteria?: string[],
 *   notes?: string | null,
 *   confidence?: "low" | "moderate" | "high" | "unknown"
 * }>} inputs
 * @returns {import("../schema/audience-hypothesis.js").audienceHypothesisSchema._type[]}
 */
export function buildAudienceHypotheses(inputs) {
  return inputs.map((input) => {
    if (typeof input === "string") {
      const name = input.trim();
      return audienceHypothesisSchema.parse({
        id: slugify(name),
        name,
        companyCriteria: [],
        roleCriteria: [],
        notes: null,
        confidence: "unknown"
      });
    }

    return audienceHypothesisSchema.parse({
      id: input.id ?? slugify(input.name),
      name: input.name,
      companyCriteria: input.companyCriteria ?? [],
      roleCriteria: input.roleCriteria ?? [],
      notes: normalizeNullableString(input.notes),
      confidence: input.confidence ?? "unknown"
    });
  });
}

/**
 * @param {Array<string | {
 *   id?: string,
 *   name?: string,
 *   question: string,
 *   scope?: "company" | "person" | "both",
 *   whyItMatters?: string | null,
 *   matchRule?: string | null,
 *   audienceIds?: string[],
 *   observationMethods?: Array<{
 *     surface: "google" | "sales-navigator" | "linkedin" | "company-site" | "news" | "manual" | "other",
 *     query?: string | null,
 *     notes?: string | null
 *   }>,
 *   status?: "draft" | "ready"
 * }>} inputs
 * @returns {import("../schema/signal.js").signalSchema._type[]}
 */
export function buildSignals(inputs) {
  return inputs.map((input) => {
    if (typeof input === "string") {
      const [scopeCandidate, questionCandidate] = input.includes("::")
        ? input.split(/::(.+)/s)
        : [null, input];
      const normalizedScope = normalizeScope(scopeCandidate);
      const question = questionCandidate.trim();

      return signalSchema.parse({
        id: slugify(`${normalizedScope}-${question}`),
        name: deriveSignalName(question),
        question,
        scope: normalizedScope,
        whyItMatters: null,
        matchRule: null,
        audienceIds: [],
        observationMethods: [],
        status: "draft"
      });
    }

    return signalSchema.parse({
      id: input.id ?? slugify(`${input.scope ?? "company"}-${input.name ?? input.question}`),
      name: input.name ?? deriveSignalName(input.question),
      question: input.question,
      scope: input.scope ?? "company",
      whyItMatters: normalizeNullableString(input.whyItMatters),
      matchRule: normalizeNullableString(input.matchRule),
      audienceIds: input.audienceIds ?? [],
      observationMethods: (input.observationMethods ?? []).map((method) => ({
        surface: method.surface,
        query: normalizeNullableString(method.query),
        notes: normalizeNullableString(method.notes)
      })),
      status: input.status ?? "draft"
    });
  });
}

/**
 * @param {import("../schema/targeting-profile.js").targetingProfileSchema._type} targetingProfile
 * @param {import("../schema/suppression-policy.js").suppressionPolicySchema._type} suppressionPolicy
 * @param {import("../schema/premise.js").premiseSchema._type} premise
 * @param {import("../schema/audience-hypothesis.js").audienceHypothesisSchema._type[]} audienceHypotheses
 * @param {import("../schema/signal.js").signalSchema._type[]} signals
 * @param {{
 *   accountCount?: number,
 *   hasSignalMatches?: boolean,
 *   prospectCount?: number,
 *   readyCadenceCount?: number,
 *   missingEmailFallbackCount?: number
 * } | undefined} state
 * @returns {string[]}
 */
export function buildNextSteps(targetingProfile, suppressionPolicy, premise, audienceHypotheses, signals, state) {
  const steps = [];
  const accountCount = state?.accountCount ?? 0;
  const hasSignalMatches = state?.hasSignalMatches ?? false;
  const prospectCount = state?.prospectCount ?? 0;
  const readyCadenceCount = state?.readyCadenceCount ?? 0;
  const missingEmailFallbackCount = state?.missingEmailFallbackCount ?? 0;

  if (premise.status === "missing") {
    steps.push("Define the operator premise before trying to rank or retrieve prospects.");
  } else {
    steps.push("Test the operator premise against explicit audience hypotheses and matched companies.");
  }

  if (!audienceHypotheses.length) {
    steps.push("Define one or more audience hypotheses for the motion before prospect retrieval.");
  } else {
    steps.push("Compare audience hypotheses to see which company and role surface resonates best.");
  }

  if (!signals.length) {
    steps.push("Define talkable motion-specific signals: question plus observation method plus match rule.");
  } else {
    if (!accountCount || !hasSignalMatches) {
      steps.push("Run the motion signals against candidate companies. Confirm the corporate website, check the company site first, then use Google and recent news to capture evidence for each match.");
    }
  }

  if (!accountCount) {
    steps.push("Use Sales Navigator retrieval against the targeting profile to build the target map.");
  }
  steps.push("Prefer signal evidence from roughly the last 180 days and avoid stale why-now triggers older than a year unless the change is clearly still active.");

  if (!prospectCount) {
    steps.push(`Resolve up to ${targetingProfile.stakeholderTargetCount} director-level-or-above prospects for each target account. Start with exact titles, but move to the best-fit owner and adjacent operators when the org chart is messy.`);
    steps.push("For chosen prospects, check recent public activity and recent posts. Treat legitimate recent activity as positive evidence the channel is active, then store profile-view state and direct-email fallback when available.");
    steps.push("Set cadence state for each chosen prospect with the right first branch and next action.");
  } else {
    if (readyCadenceCount < prospectCount) {
      steps.push("Complete cadence state for the remaining chosen prospects before launch.");
    }

    if (prospectCount > 0 && readyCadenceCount >= prospectCount) {
      steps.push("The first prospect batch is launch-ready. Let the agent execute the stored cadence branches through the pinned governed connector path, and surface only real exceptions or review decisions to the operator.");
    }

    if (missingEmailFallbackCount > 0) {
      steps.push("Find verified direct-email fallbacks for high-priority prospects when available. Until then, LinkedIn remains the only ready channel for those people.");
    }
  }

  if (
    suppressionPolicy.excludedAccounts.length ||
    suppressionPolicy.excludedDomains.length ||
    suppressionPolicy.doNotContactEntries.length
  ) {
    steps.splice(2, 0, "Apply suppression policy before building the target map.");
  }

  if (targetingProfile.segmentVariants.length > 1) {
    steps.push("Create distinct motion branches for each declared segment variant.");
  }

  return steps;
}

/**
 * @param {string} question
 * @returns {string}
 */
export function deriveSignalName(question) {
  return question
    .replace(/^is there recent evidence that /i, "")
    .replace(/^does /i, "")
    .replace(/\?+$/, "")
    .trim()
    .replace(/^this company /i, "")
    .replace(/^this person /i, "")
    || "Signal";
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function normalizeNullableString(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {string} seed
 * @param {number} attempt
 * @returns {string}
 */
function generateMotionCodename(seed, attempt) {
  const hash = crypto.createHash("sha256").update(`${seed}:${attempt}`).digest();
  const firstIndex = hash[0] % ADJECTIVES.length;
  let secondIndex = hash[1] % ADJECTIVES.length;
  if (secondIndex === firstIndex) {
    secondIndex = (secondIndex + 1) % ADJECTIVES.length;
  }
  const animalIndex = hash[2] % ANIMALS.length;

  return `${ADJECTIVES[firstIndex]}-${ADJECTIVES[secondIndex]}-${ANIMALS[animalIndex]}`;
}

/**
 * @param {string | null | undefined} value
 * @returns {"company" | "person" | "both"}
 */
function normalizeScope(value) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "person" || normalized === "both") {
    return normalized;
  }

  return "company";
}

/**
 * @param {string} value
 * @returns {string}
 */
function slugify(value) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "item";
}

const ADJECTIVES = [
  "amber",
  "ancient",
  "ardent",
  "ash",
  "autumn",
  "banded",
  "bitter",
  "black",
  "blunt",
  "bold",
  "boring",
  "brass",
  "brave",
  "brisk",
  "bronze",
  "calm",
  "candid",
  "cedar",
  "chartreuse",
  "cinder",
  "clean",
  "clever",
  "cloudy",
  "coarse",
  "cobalt",
  "cold",
  "cosmic",
  "crisp",
  "crooked",
  "curious",
  "dark",
  "daring",
  "dense",
  "direct",
  "dusty",
  "eager",
  "electric",
  "ember",
  "faded",
  "feral",
  "fierce",
  "flat",
  "flint",
  "frank",
  "fresh",
  "gentle",
  "glass",
  "golden",
  "grim",
  "hard",
  "harsh",
  "hollow",
  "honest",
  "icy",
  "indigo",
  "iron",
  "jagged",
  "jade",
  "keen",
  "kind",
  "laced",
  "lanky",
  "lateral",
  "lean",
  "lilac",
  "lively",
  "lone",
  "loud",
  "lucid",
  "lunar",
  "mellow",
  "mint",
  "modern",
  "moss",
  "narrow",
  "navy",
  "nimble",
  "odd",
  "olive",
  "opaque",
  "open",
  "orange",
  "pale",
  "plain",
  "plum",
  "polished",
  "practical",
  "proud",
  "quick",
  "quiet",
  "rational",
  "raw",
  "red",
  "rigid",
  "rough",
  "royal",
  "sable",
  "sage",
  "scarlet",
  "sharp",
  "silent",
  "silver",
  "slate",
  "slow",
  "solid",
  "spare",
  "steady",
  "steel",
  "stern",
  "stone",
  "stormy",
  "strict",
  "stubborn",
  "sudden",
  "swift",
  "teal",
  "tidy",
  "true",
  "urban",
  "vivid",
  "warm",
  "wary",
  "white",
  "wild",
  "wise",
  "wooden"
];

const ANIMALS = [
  "albatross",
  "alpaca",
  "antelope",
  "badger",
  "barracuda",
  "beaver",
  "bison",
  "bobcat",
  "buffalo",
  "canary",
  "caracal",
  "cardinal",
  "caribou",
  "cougar",
  "coyote",
  "crane",
  "crow",
  "dingo",
  "dolphin",
  "dragonfly",
  "eagle",
  "falcon",
  "fennec",
  "ferret",
  "finch",
  "firefly",
  "fox",
  "gazelle",
  "gecko",
  "gibbon",
  "giraffe",
  "gosling",
  "grouse",
  "heron",
  "hornet",
  "ibis",
  "jackal",
  "jaguar",
  "jay",
  "kingfisher",
  "kite",
  "koala",
  "lemur",
  "leopard",
  "lion",
  "lizard",
  "llama",
  "lynx",
  "magpie",
  "manatee",
  "marten",
  "meerkat",
  "mink",
  "monarch",
  "mongoose",
  "narwhal",
  "nightjar",
  "ocelot",
  "oriole",
  "otter",
  "owl",
  "panda",
  "panther",
  "parrot",
  "peacock",
  "pelican",
  "penguin",
  "phoenix",
  "pika",
  "puma",
  "python",
  "quetzal",
  "rabbit",
  "raccoon",
  "ram",
  "raven",
  "rook",
  "sable",
  "salmon",
  "serval",
  "shark",
  "sparrow",
  "starling",
  "stork",
  "swallow",
  "swift",
  "tapir",
  "tern",
  "tiger",
  "toucan",
  "turaco",
  "viper",
  "walrus",
  "weasel",
  "whale",
  "wildcat",
  "wolf",
  "wolverine",
  "wren",
  "yak",
  "zebra"
];
