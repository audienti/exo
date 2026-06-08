// @ts-check

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CODEX_BIN = process.env.EXO_CODEX_BIN || "/Applications/Codex.app/Contents/Resources/codex";
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const DEFAULT_TIMEOUT_MS = normalizePositiveInteger(process.env.EXO_PERSON_DRAFT_TIMEOUT_MS, 25_000);

const SURFACE_META = {
  connection_request: { label: "Connection request note", channel: "linkedin", subject: false },
  post_accept_message: { label: "First message", channel: "linkedin", subject: false },
  inbound_reply: { label: "Reply", channel: "linkedin", subject: false },
  email: { label: "Email reply", channel: "email", subject: true },
  in_mail_message: { label: "InMail", channel: "linkedin", subject: true },
};

const PERSON_COMPOSE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: {
      anyOf: [
        { type: "string" },
        { type: "null" },
      ],
    },
    body: { type: "string", minLength: 1 },
  },
};

/**
 * @param {ReturnType<import("./build-person-view.js").buildPersonView>} person
 */
export function buildPersonComposeDraftBrief(person) {
  if (!person) {
    return null;
  }

  const surface = SURFACE_META[person.suggestedSurface ?? ""] ?? null;
  if (!surface) {
    return null;
  }

  const threadMessages = (person.timeline ?? [])
    .filter((entry) => entry?.isMessage && typeof entry.detail === "string" && entry.detail.trim().length > 0)
    .slice()
    .sort((left, right) => (Date.parse(left.observedAt) || 0) - (Date.parse(right.observedAt) || 0))
    .map((entry) => ({
      observedAt: entry.observedAt ?? null,
      direction: entry.direction ?? "unknown",
      surfaceLabel: entry.surfaceLabel ?? null,
      fromName: entry.fromName ?? null,
      fromHandle: entry.fromHandle ?? null,
      subject: entry.subject ?? null,
      body: entry.detail.trim(),
    }));

  const latestInbound = person.latestMessage
    ? {
        subject: person.latestMessage.subject ?? null,
        body: person.latestMessage.detail ?? person.latestMessage.summary ?? null,
        observedAt: person.latestMessage.observedAt ?? null,
      }
    : null;

  const motion = person.motionContext?.isTransition
    ? {
        mode: "transition_backlog",
        motionId: person.motionContext.motionId,
        name: person.motionContext.name,
        sourceUrl: person.motionContext.sourceUrl ?? null,
      }
    : person.motionContext
      ? {
          mode: "linked_motion",
          motionId: person.motionContext.motionId,
          name: person.motionContext.name,
          sourceUrl: person.motionContext.sourceUrl ?? null,
          premise: person.motionContext.premise ?? null,
          offerNotes: person.motionContext.offerNotes ?? null,
        }
      : {
          mode: "unlinked",
          motionId: null,
          name: null,
          sourceUrl: null,
        };

  return {
    surface: {
      key: person.suggestedSurface,
      label: surface.label,
      channel: surface.channel,
      usesSubject: surface.subject,
      subjectHint: person.composeDraft?.subject ?? null,
    },
    relationship: {
      key: person.connection?.key ?? null,
      label: person.connection?.label ?? null,
      nextMove: person.connection?.nextMove ?? null,
    },
    person: {
      name: person.identity?.name ?? null,
      title: person.identity?.title ?? null,
      company: person.identity?.company ?? null,
      linkedinUrl: person.identity?.linkedinUrl ?? null,
      publicId: person.identity?.publicId ?? null,
      handle: person.identity?.handle ?? null,
      email: person.email ?? null,
    },
    company: {
      companyId: person.matchedCompany?.companyId ?? null,
      name: person.matchedCompany?.name ?? person.identity?.company ?? null,
      websiteUrl: person.matchedCompany?.websiteUrl ?? null,
      linkedinCompanyUrl: person.matchedCompany?.linkedinCompanyUrl ?? null,
      notes: person.matchedCompany?.notes ?? null,
    },
    motion,
    latestInbound,
    threadMessages,
    operatorRules: [
      "Friendly and professional.",
      "Not salesy.",
      "Reply to the actual thread, not a template.",
      "Use company and profile context when it helps.",
      "If motion.mode is not linked_motion, do not invent an offer or premise.",
    ],
  };
}

/**
 * @param {NonNullable<ReturnType<typeof buildPersonComposeDraftBrief>>} brief
 */
export function buildPersonComposePrompt(brief) {
  const motionRule = brief.motion.mode === "linked_motion"
    ? "A real motion is linked here. You may use the premise and offer notes as quiet background context, but do not pitch."
    : "This is transition-backlog or unlinked context. Do not invent an offer, premise, campaign, or sales angle. Work from the person's profile, company, relationship stage, and actual thread only.";

  return [
    "Write exactly one Exo compose draft from the brief below.",
    "This draft opens in the live inbound compose panel for operator review before send.",
    "Return only JSON matching the provided schema with subject and body.",
    "If the surface does not use a subject, return subject as null.",
    "Write like a market operator talking to a peer: friendly, professional, concise, not salesy.",
    "Respond to the actual inbound thread. Do not use canned acknowledgements like 'Thanks for the note.' or 'Saw your note. Thanks for reaching out.'",
    "If they answered a question, build on their answer instead of resetting the conversation.",
    motionRule,
    "Use one concrete detail from the thread, company, or profile when it helps.",
    "Respect the relationship stage and prior messages.",
    "Keep it to 1-4 sentences and ask at most one real question.",
    "No em dashes. No 'hope you're well'. No 'just wanted to'. No chatbot filler.",
    "",
    "Brief JSON:",
    JSON.stringify(brief, null, 2),
  ].join("\n");
}

/**
 * @param {ReturnType<import("./build-person-view.js").buildPersonView>} person
 * @param {{
 *   writer?: ((brief: NonNullable<ReturnType<typeof buildPersonComposeDraftBrief>>) => { subject?: string | null, body?: string | null } | null),
 *   timeoutMs?: number | null,
 * }} [options]
 */
export function resolvePersonComposeDraft(person, options = {}) {
  const scaffold = normalizeDraftEnvelope(person?.composeDraft ?? null, person?.suggestedSurface ?? null, { subject: null, body: "" });
  if (!person || person.matchedProspect || person.hasDurableIdentity === false) {
    return scaffold;
  }

  const brief = buildPersonComposeDraftBrief(person);
  if (!brief) {
    return scaffold;
  }

  const writer = options.writer ?? ((nextBrief) => runPersonComposeDraft(nextBrief, { timeoutMs: options.timeoutMs ?? null }));
  try {
    const authored = writer(brief);
    return normalizeDraftEnvelope(authored, brief.surface.key, scaffold);
  } catch {
    return scaffold;
  }
}

/**
 * @param {NonNullable<ReturnType<typeof buildPersonComposeDraftBrief>>} brief
 * @param {{ timeoutMs?: number | null }} [options]
 */
export function runPersonComposeDraft(brief, options = {}) {
  const result = runDetachedCodexJsonTask({
    prompt: buildPersonComposePrompt(brief),
    schema: PERSON_COMPOSE_OUTPUT_SCHEMA,
    outputName: `person-compose-${sanitizeFileToken(brief.person.name ?? brief.surface.key)}.json`,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  return normalizeDraftEnvelope(result, brief.surface.key, { subject: brief.surface.subjectHint ?? null, body: "" });
}

/**
 * @param {{
 *   prompt: string,
 *   schema: unknown,
 *   outputName: string,
 *   timeoutMs: number,
 * }} input
 */
function runDetachedCodexJsonTask(input) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "exo-person-draft-"));
  const outputPath = path.join(tempDir, input.outputName);
  const schemaPath = path.join(tempDir, "schema.json");
  writeFileSync(schemaPath, JSON.stringify(input.schema, null, 2));

  const args = [
    "exec",
    "--ephemeral",
    "--cd",
    ROOT,
    "--ignore-rules",
    "--sandbox",
    "danger-full-access",
    "--dangerously-bypass-approvals-and-sandbox",
    "--dangerously-bypass-hook-trust",
    "--output-last-message",
    outputPath,
    "--output-schema",
    schemaPath,
    "-c",
    'model_reasoning_effort="medium"',
    "-",
  ];

  try {
    execFileSync(CODEX_BIN, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        CODEX_HOME,
      },
      encoding: "utf8",
      input: input.prompt,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: input.timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseJsonLoose(readFileSync(outputPath, "utf8"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {unknown} value
 * @param {string | null | undefined} surfaceKey
 * @param {{ subject: string | null, body: string }} fallback
 */
function normalizeDraftEnvelope(value, surfaceKey, fallback) {
  const raw = value && typeof value === "object" ? /** @type {{ subject?: unknown, body?: unknown }} */ (value) : {};
  const body = normalizeNullableString(raw.body);
  const usesSubject = Boolean((surfaceKey && SURFACE_META[surfaceKey])?.subject);
  return {
    subject: usesSubject ? normalizeNullableString(raw.subject) ?? fallback.subject ?? null : null,
    body: body ?? fallback.body,
  };
}

/** @param {string | null | undefined} value */
function normalizeNullableString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/** @param {unknown} raw */
function parseJsonLoose(raw) {
  if (raw && typeof raw === "object") {
    return raw;
  }
  const source = String(raw ?? "").trim();
  if (!source) {
    return {};
  }
  try {
    return JSON.parse(source);
  } catch {
    const fencedMatch = source.match(/```(?:json)?\s*([\s\S]+?)```/i);
    if (fencedMatch) {
      return JSON.parse(fencedMatch[1]);
    }
    throw new Error("Person draft task returned invalid JSON.");
  }
}

/** @param {string} value */
function sanitizeFileToken(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "person";
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
