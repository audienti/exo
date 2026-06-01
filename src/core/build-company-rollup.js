// @ts-check

import {
  extractLinkedinPublicId,
  normalizeContactValue
} from "../lib/prospect-contacts.js";

const EMAIL_KIND = "email";
const LINKEDIN_KIND = "linkedin_profile";
const LINKEDIN_PUBLIC_ID_KIND = "linkedin_public_id";
const LINKEDIN_MEMBER_ID_KIND = "linkedin_member_id";

/**
 * @param {import("../schema/company.js").companySchema._type} company
 * @param {Array<import("../schema/motion.js").motionSchema._type>} motions
 */
export function buildCompanyRollup(company, motions) {
  /** @type {Map<string, ReturnType<typeof buildPersonAccumulator>>} */
  const peopleByKey = new Map();
  /** @type {Array<{
   *   motionId: string,
   *   motionName: string,
   *   motionStatus: string,
   *   motionUpdatedAt: string,
   *   offerSourceUrl: string,
   *   signalId: string,
   *   signalName: string,
   *   signalScope: string,
   *   confidence: string,
   *   summary: string,
   *   sourceUrl: string | null,
   *   sourceLabel: string | null,
   *   observedAt: string | null,
   *   recordedAt: string,
   *   subject: {
   *     type: string,
   *     personName: string | null,
   *     personTitle: string | null
   *   }
   * }>} */
  const signals = [];
  /** @type {Array<{
   *   occurredAt: string,
   *   motionId: string,
   *   motionName: string,
   *   motionStatus: string,
   *   prospectId: string,
   *   personKey: string,
   *   prospectName: string,
   *   title: string,
   *   surface: string,
   *   direction: string,
   *   outcome: string,
   *   summary: string,
   *   subject: string | null,
   *   body: string | null,
   *   sourceUrl: string | null,
   *   notes: string | null
   * }>} */
  const activity = [];

  let companySignalCount = 0;
  let personSignalCount = 0;
  let prospectRecordCount = 0;

  const motionSummaries = motions.map((motion) => {
    const account = motion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;
    const signalMatches = account?.signalMatches ?? [];
    const prospects = account?.prospects ?? [];
    let touchCount = 0;
    let lastTouchAt = null;

    for (const signalMatch of signalMatches) {
      signals.push({
        motionId: motion.id,
        motionName: motion.name,
        motionStatus: motion.status,
        motionUpdatedAt: motion.updatedAt,
        offerSourceUrl: motion.offer.sourceUrl,
        signalId: signalMatch.signalId,
        signalName: signalMatch.signalName,
        signalScope: signalMatch.signalScope,
        confidence: signalMatch.confidence,
        summary: signalMatch.summary,
        sourceUrl: signalMatch.sourceUrl,
        sourceLabel: signalMatch.sourceLabel,
        observedAt: signalMatch.observedAt,
        recordedAt: signalMatch.recordedAt,
        subject: {
          type: signalMatch.subject.type,
          personName: signalMatch.subject.personName,
          personTitle: signalMatch.subject.personTitle
        }
      });

      if (signalMatch.subject.type === "company") {
        companySignalCount += 1;
      } else {
        personSignalCount += 1;
      }
    }

    for (const prospect of prospects) {
      prospectRecordCount += 1;
      const identity = deriveProspectIdentity(company.id, prospect);
      const person = peopleByKey.get(identity.key) ?? buildPersonAccumulator(identity);
      const prospectTouchCount = prospect.touches.length;
      const prospectLastTouchAt = resolveProspectLastTouchAt(prospect);

      person.motionIds.add(motion.id);
      person.prospectIds.add(prospect.id);
      person.titles.add(prospect.title);
      person.buyingCommitteeRoles.add(prospect.buyingCommitteeRole);
      person.decisionAuthorities.add(prospect.decisionAuthority);
      person.currentCadenceSteps.add(prospect.cadenceState.currentStep ?? "none");
      person.lastTouchAt = maxIso(person.lastTouchAt, prospectLastTouchAt);
      person.touchCount += prospectTouchCount;

      if (prospect.profileViewedAt) {
        person.profileViewedAt = maxIso(person.profileViewedAt, prospect.profileViewedAt);
      }

      if (prospect.liveSignal.summary) {
        person.liveSignalSummaries.add(prospect.liveSignal.summary);
      }

      for (const value of collectProspectValues(prospect, EMAIL_KIND)) {
        person.emails.add(value);
      }

      for (const value of collectProspectValues(prospect, LINKEDIN_KIND)) {
        person.linkedinProfiles.add(value);
      }

      for (const value of collectProspectValues(prospect, LINKEDIN_PUBLIC_ID_KIND)) {
        person.linkedinPublicIds.add(value);
      }

      for (const value of collectProspectValues(prospect, LINKEDIN_MEMBER_ID_KIND)) {
        person.linkedinMemberIds.add(value);
      }

      person.prospectRecords.push({
        motionId: motion.id,
        motionName: motion.name,
        motionStatus: motion.status,
        motionUpdatedAt: motion.updatedAt,
        prospectId: prospect.id,
        title: prospect.title,
        whyRelevant: prospect.whyRelevant,
        touchCount: prospectTouchCount,
        lastTouchAt: prospectLastTouchAt,
        cadenceStatus: prospect.cadenceState.status,
        currentCadenceStep: prospect.cadenceState.currentStep ?? null
      });

      for (const touch of prospect.touches) {
        touchCount += 1;
        lastTouchAt = maxIso(lastTouchAt, touch.occurredAt);
        activity.push({
          occurredAt: touch.occurredAt,
          motionId: motion.id,
          motionName: motion.name,
          motionStatus: motion.status,
          prospectId: prospect.id,
          personKey: identity.key,
          prospectName: prospect.name,
          title: prospect.title,
          surface: touch.surface,
          direction: touch.direction,
          outcome: touch.outcome,
          summary: touch.summary,
          subject: touch.subject,
          body: touch.body,
          sourceUrl: touch.sourceUrl,
          notes: touch.notes
        });
      }

      peopleByKey.set(identity.key, person);
    }

    return {
      id: motion.id,
      name: motion.name,
      status: motion.status,
      createdAt: motion.createdAt,
      updatedAt: motion.updatedAt,
      offerSourceUrl: motion.offer.sourceUrl,
      premise: motion.premise.statement,
      accountPresent: Boolean(account),
      signalMatchCount: signalMatches.length,
      companySignalCount: signalMatches.filter((match) => match.subject.type === "company").length,
      personSignalCount: signalMatches.filter((match) => match.subject.type === "person").length,
      prospectCount: prospects.length,
      touchCount,
      lastTouchAt
    };
  }).sort(compareUpdatedDesc);

  const sortedSignals = [...signals].sort((left, right) => {
    const leftAt = left.observedAt ?? left.recordedAt;
    const rightAt = right.observedAt ?? right.recordedAt;
    return compareIsoDesc(leftAt, rightAt)
      || right.motionUpdatedAt.localeCompare(left.motionUpdatedAt)
      || left.motionName.localeCompare(right.motionName);
  });
  const sortedActivity = [...activity].sort((left, right) =>
    compareIsoDesc(left.occurredAt, right.occurredAt)
    || right.motionName.localeCompare(left.motionName)
    || left.prospectName.localeCompare(right.prospectName)
  );
  const people = [...peopleByKey.values()]
    .map(finalizePersonRollup)
    .sort((left, right) =>
      compareIsoDesc(left.lastTouchAt, right.lastTouchAt)
      || compareIsoDesc(left.profileViewedAt, right.profileViewedAt)
      || left.displayName.localeCompare(right.displayName)
    );

  return {
    summary: {
      motionCount: motionSummaries.length,
      prospectRecordCount,
      personCount: people.length,
      companySignalCount,
      personSignalCount,
      signalCount: sortedSignals.length,
      touchCount: sortedActivity.length,
      mostRecentTouchAt: sortedActivity[0]?.occurredAt ?? null
    },
    motions: motionSummaries,
    signals: sortedSignals,
    companySignals: sortedSignals.filter((signal) => signal.subject.type === "company"),
    personSignals: sortedSignals.filter((signal) => signal.subject.type === "person"),
    people,
    activity: sortedActivity
  };
}

/**
 * @param {{ key: string, confidence: "exact" | "probable", displayName: string }} identity
 */
function buildPersonAccumulator(identity) {
  return {
    personKey: identity.key,
    identityConfidence: identity.confidence,
    displayName: identity.displayName,
    titles: new Set(),
    emails: new Set(),
    linkedinProfiles: new Set(),
    linkedinPublicIds: new Set(),
    linkedinMemberIds: new Set(),
    motionIds: new Set(),
    prospectIds: new Set(),
    buyingCommitteeRoles: new Set(),
    decisionAuthorities: new Set(),
    currentCadenceSteps: new Set(),
    liveSignalSummaries: new Set(),
    touchCount: 0,
    lastTouchAt: null,
    profileViewedAt: null,
    prospectRecords: []
  };
}

/**
 * @param {ReturnType<typeof buildPersonAccumulator>} person
 */
function finalizePersonRollup(person) {
  return {
    personKey: person.personKey,
    identityConfidence: person.identityConfidence,
    displayName: person.displayName,
    titles: sortStrings(person.titles),
    emails: sortStrings(person.emails),
    linkedinProfiles: sortStrings(person.linkedinProfiles),
    linkedinPublicIds: sortStrings(person.linkedinPublicIds),
    linkedinMemberIds: sortStrings(person.linkedinMemberIds),
    motionIds: sortStrings(person.motionIds),
    prospectIds: sortStrings(person.prospectIds),
    buyingCommitteeRoles: sortStrings(person.buyingCommitteeRoles),
    decisionAuthorities: sortStrings(person.decisionAuthorities),
    currentCadenceSteps: sortStrings(person.currentCadenceSteps),
    liveSignalSummaries: sortStrings(person.liveSignalSummaries),
    touchCount: person.touchCount,
    lastTouchAt: person.lastTouchAt,
    profileViewedAt: person.profileViewedAt,
    prospectRecords: [...person.prospectRecords].sort((left, right) =>
      compareIsoDesc(left.lastTouchAt, right.lastTouchAt)
      || compareIsoDesc(left.motionUpdatedAt, right.motionUpdatedAt)
      || left.motionName.localeCompare(right.motionName)
    )
  };
}

/**
 * @param {string} companyId
 * @param {import("../schema/target-account.js").prospectSchema._type} prospect
 */
function deriveProspectIdentity(companyId, prospect) {
  const memberId = collectProspectValues(prospect, LINKEDIN_MEMBER_ID_KIND)[0] ?? null;
  if (memberId) {
    return {
      key: `${LINKEDIN_MEMBER_ID_KIND}:${memberId}`,
      confidence: "exact",
      displayName: prospect.name
    };
  }

  const publicId = collectProspectValues(prospect, LINKEDIN_PUBLIC_ID_KIND)[0] ?? null;
  if (publicId) {
    return {
      key: `${LINKEDIN_PUBLIC_ID_KIND}:${publicId}`,
      confidence: "exact",
      displayName: prospect.name
    };
  }

  const email = collectProspectValues(prospect, EMAIL_KIND)[0] ?? null;
  if (email) {
    return {
      key: `${EMAIL_KIND}:${email}`,
      confidence: "exact",
      displayName: prospect.name
    };
  }

  const linkedinProfile = collectProspectValues(prospect, LINKEDIN_KIND)[0] ?? null;
  if (linkedinProfile) {
    return {
      key: `${LINKEDIN_KIND}:${linkedinProfile}`,
      confidence: "exact",
      displayName: prospect.name
    };
  }

  return {
    key: `company:${companyId}:name:${normalizeName(prospect.name)}`,
    confidence: "probable",
    displayName: prospect.name
  };
}

/**
 * @param {import("../schema/target-account.js").prospectSchema._type} prospect
 * @param {string} kind
 */
function collectProspectValues(prospect, kind) {
  const values = new Set();

  for (const point of prospect.contactPoints) {
    if (point.kind !== kind || point.matchStatus === "rejected" || point.verificationStatus === "rejected") {
      continue;
    }

    values.add(normalizeContactValue(kind, point.value));
  }

  if (kind === EMAIL_KIND && prospect.email) {
    values.add(normalizeContactValue(kind, prospect.email));
  }

  if (kind === LINKEDIN_KIND && prospect.linkedinProfileUrl) {
    values.add(normalizeContactValue(kind, prospect.linkedinProfileUrl));
  }

  if (kind === LINKEDIN_PUBLIC_ID_KIND) {
    if (prospect.linkedinProfileSnapshot.publicId) {
      values.add(normalizeContactValue(kind, prospect.linkedinProfileSnapshot.publicId));
    }

    const publicId = extractLinkedinPublicId(prospect.linkedinProfileUrl);
    if (publicId) {
      values.add(publicId);
    }
  }

  if (kind === LINKEDIN_MEMBER_ID_KIND && prospect.linkedinProfileSnapshot.memberId) {
    values.add(normalizeContactValue(kind, prospect.linkedinProfileSnapshot.memberId));
  }

  return [...values];
}

/**
 * @param {import("../schema/target-account.js").prospectSchema._type} prospect
 */
function resolveProspectLastTouchAt(prospect) {
  const latestTouch = prospect.touches[prospect.touches.length - 1]?.occurredAt ?? null;
  return maxIso(latestTouch, prospect.cadenceState.lastTouchAt ?? null);
}

/**
 * @param {Iterable<string>} values
 */
function sortStrings(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

/**
 * @param {{ updatedAt: string }} left
 * @param {{ updatedAt: string }} right
 */
function compareUpdatedDesc(left, right) {
  return right.updatedAt.localeCompare(left.updatedAt);
}

/**
 * @param {string | null | undefined} left
 * @param {string | null | undefined} right
 */
function maxIso(left, right) {
  if (!left) {
    return right ?? null;
  }

  if (!right) {
    return left;
  }

  return left >= right ? left : right;
}

/**
 * @param {string | null | undefined} left
 * @param {string | null | undefined} right
 */
function compareIsoDesc(left, right) {
  if (left && right) {
    return right.localeCompare(left);
  }

  if (left) {
    return -1;
  }

  if (right) {
    return 1;
  }

  return 0;
}

/**
 * @param {string} value
 */
function normalizeName(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
