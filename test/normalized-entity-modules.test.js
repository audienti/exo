// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  appendActivityEvent,
  buildAccountRelationshipMap,
  acceptMotionAccountPacket,
  acceptProspectPacket,
  claimMotionAccountPacket,
  claimProspectPacket,
  clearMotionAccountPacket,
  clearProspectPacket,
  findCrossMotionOwner,
  findOrCreateCompany,
  getLocalDatabase,
  listContactPointsForPerson,
  listDueProspects,
  listActivityEvents,
  normalizeContactValue,
  releaseMotionAccountPacket,
  resolvePersonIdentity,
  returnMotionAccountPacket,
  returnProspectPacket,
  selectPrimaryEmployment,
  setAccountDisposition,
  setProspectDisposition,
  submitMotionAccountPacket,
  submitProspectPacket,
  transitionProspectDraftStatus,
  upsertEmployment,
  upsertMotionAccount,
  upsertProspect,
  upsertProspectDraft,
  upsertSignalMatch,
  listSignalMatchesForMotionAccount,
} from "../src/db/database.js";

test("normalized company identity finds by domain before LinkedIn company URL", () => {
  withIsolatedExoState(() => {
    const first = findOrCreateCompany({
      name: "Example Co",
      domain: "https://www.Example.com/about",
      linkedinCompanyUrl: "https://www.linkedin.com/company/example-co/?trk=public_profile",
      websiteUrl: "https://example.com"
    });

    const byDomain = findOrCreateCompany({
      name: "Example Co Renamed",
      domain: "example.com",
      linkedinCompanyUrl: "https://www.linkedin.com/company/example-renamed/"
    });

    const byLinkedIn = findOrCreateCompany({
      name: "Example Co From LinkedIn",
      linkedinCompanyUrl: "https://linkedin.com/company/example-co"
    });

    assert.equal(first.id, byDomain.id);
    assert.equal(first.id, byLinkedIn.id);
    assert.equal(byDomain.domain, "example.com");
    assert.equal(byLinkedIn.linkedinCompanyUrl, "https://www.linkedin.com/company/example-co/");
  });
});

test("normalized company identity treats explicit legacy ids as idempotent", () => {
  withIsolatedExoState(() => {
    const first = findOrCreateCompany({
      id: "company_legacy_id",
      name: "Legacy Account"
    });

    const again = findOrCreateCompany({
      id: first.id,
      name: "Legacy Account"
    });

    const rows = getLocalDatabase()
      .prepare("SELECT id FROM companies WHERE id = ?")
      .all(first.id);

    assert.equal(again.id, first.id);
    assert.equal(rows.length, 1);
  });
});

test("person resolver extracts LinkedIn identities, preserves member-id case, and retains old slug aliases", () => {
  withIsolatedExoState(() => {
    const created = resolvePersonIdentity({
      name: "Jane Buyer",
      contactPoints: [
        { kind: "linkedin_profile_url", value: "https://ma.linkedin.com/in/Jane-Buyer/?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AACoAAAbCDeF" }
      ]
    });

    assert.equal(created.created, true);
    assert.equal(created.person.linkedinMemberId, "ACoAAAbCDeF");
    assert.equal(created.person.linkedinPublicId, "jane-buyer");

    const updated = resolvePersonIdentity({
      name: "Jane Buyer",
      contactPoints: [
        { kind: "linkedin_member_id", value: "ACoAAAbCDeF" },
        { kind: "linkedin_public_id", value: "jane-new" }
      ]
    });

    assert.equal(updated.person.id, created.person.id);
    assert.equal(updated.person.linkedinPublicId, "jane-new");
    assert.equal(
      listContactPointsForPerson(created.person.id).some((point) =>
        point.kind === "linkedin_public_id"
          && point.value === "jane-buyer"
          && point.matchStatus === "same_person_verified"
      ),
      true
    );
  });
});

test("person resolver sends same-slug member-id conflicts and non-merge-grade email contacts to review instead of silent merge", () => {
  withIsolatedExoState(() => {
    const jane = resolvePersonIdentity({
      name: "Jane Buyer",
      contactPoints: [
        { kind: "linkedin_member_id", value: "ACoOriginal" },
        { kind: "linkedin_public_id", value: "jane-buyer" },
        { kind: "email", value: "\"Jane Buyer\" <jane@example.com>", verificationStatus: "verified" }
      ]
    });

    const conflict = resolvePersonIdentity({
      name: "Jane Buyer",
      contactPoints: [
        { kind: "linkedin_public_id", value: "jane-buyer" },
        { kind: "linkedin_member_id", value: "ACoDifferent" }
      ]
    });

    assert.equal(conflict.person.id, jane.person.id);
    assert.equal(conflict.person.linkedinMemberId, "ACoOriginal");
    assert.equal(conflict.reviewRequired, true);
    assert.equal(
      conflict.reviewContactPoints.some((point) =>
        point.kind === "linkedin_member_id"
          && point.value === "ACoDifferent"
          && point.matchStatus === "same_person_possible"
      ),
      true
    );

    const roleMailbox = resolvePersonIdentity({
      name: "Sales Desk",
      contactPoints: [
        { kind: "email", value: "sales@example.com", verificationStatus: "verified" }
      ]
    });

    assert.equal(roleMailbox.person.primaryEmail, null);

    const alias = resolvePersonIdentity({
      name: "Jane Alias",
      contactPoints: [
        { kind: "email", value: "j.ane+vendor@example.com", verificationStatus: "verified" }
      ]
    });

    assert.notEqual(alias.person.id, jane.person.id);
    assert.equal(alias.person.primaryEmail, "j.ane+vendor@example.com");
  });
});

test("contact normalization ports the v10 LinkedIn and email edge conditions", () => {
  assert.equal(normalizeContactValue("linkedin_member_id", "🔎ACoAAAbCDeF%255c"), "ACoAAAbCDeF");
  assert.equal(normalizeContactValue("linkedin_sales_url", "https://www.linkedin.com/sales/lead/ACoCASE_Id-123,NAME_SEARCH"), "ACoCASE_Id-123");
  assert.equal(normalizeContactValue("linkedin_profile_url", "https://MA.linkedin.com/in/Jane-Buyer/%5C?trk=foo#frag"), "jane-buyer");
  assert.equal(normalizeContactValue("email", " mailto:\"Jane Buyer\" <Jane@Bücher.example>. "), "jane@xn--bcher-kva.example");
});

test("employment upsert closes old current jobs and selects the primary employment", () => {
  withIsolatedExoState(() => {
    const firstCompany = findOrCreateCompany({ name: "First Co", domain: "first.example" });
    const secondCompany = findOrCreateCompany({ name: "Second Co", domain: "second.example" });
    const person = resolvePersonIdentity({
      name: "Jordan Operator",
      contactPoints: [{ kind: "linkedin_public_id", value: "jordan-operator" }]
    }).person;

    const first = upsertEmployment({
      personId: person.id,
      companyId: firstCompany.id,
      title: "Director",
      source: "linkedin",
      observedAt: "2026-06-01T10:00:00.000Z"
    });
    const second = upsertEmployment({
      personId: person.id,
      companyId: secondCompany.id,
      title: "VP",
      source: "linkedin",
      observedAt: "2026-06-02T10:00:00.000Z"
    });

    assert.equal(first.isCurrent, true);
    assert.equal(second.isCurrent, true);
    assert.equal(selectPrimaryEmployment(person.id)?.companyId, secondCompany.id);

    const oldRow = getLocalDatabase()
      .prepare("SELECT is_current, ended_observed_at FROM employments WHERE id = ?")
      .get(first.id);
    assert.equal(oldRow.is_current, 0);
    assert.equal(oldRow.ended_observed_at, "2026-06-02T10:00:00.000Z");
  });
});

test("normalized packet claims, due scans, events, drafts, signals, and ownership queries are row-backed", () => {
  withIsolatedExoState(() => {
    const database = getLocalDatabase();
    seedLocalUser(database, "user-1");
    seedMotion(database, "motion-1");
    seedMotion(database, "motion-2");

    const company = findOrCreateCompany({ name: "Queue Co", domain: "queue.example" });
    const person = resolvePersonIdentity({
      name: "Taylor Target",
      contactPoints: [{ kind: "linkedin_public_id", value: "taylor-target" }]
    }).person;
    upsertEmployment({
      personId: person.id,
      companyId: company.id,
      title: "Revenue Lead",
      source: "manual",
      observedAt: "2026-06-01T10:00:00.000Z"
    });

    const motionAccount = upsertMotionAccount({
      motionId: "motion-1",
      companyId: company.id,
      executionUserId: "user-1",
      queueStatus: "queued_for_research"
    });
    assert.equal(claimMotionAccountPacket(motionAccount.id, { workerLabel: "worker-a" })?.packetClaimedBy, "worker-a");
    assert.equal(claimMotionAccountPacket(motionAccount.id, { workerLabel: "worker-b" }), null);
    assert.equal(releaseMotionAccountPacket(motionAccount.id)?.packetClaimedBy, null);

    const prospect = upsertProspect({
      motionId: "motion-1",
      companyId: company.id,
      motionAccountId: motionAccount.id,
      personId: person.id,
      queueStatus: "selected",
      cadenceStatus: "ready",
      cadenceCurrentStep: "connection-request",
      cadenceNextActionDueAt: "2026-06-09T12:00:00.000Z"
    });
    assert.equal(claimProspectPacket(prospect.id, { workerLabel: "researcher" })?.packetClaimedBy, "researcher");
    assert.equal(claimProspectPacket(prospect.id, { workerLabel: "other" }), null);

    assert.deepEqual(listDueProspects({
      executionUserId: "user-1",
      now: "2026-06-10T12:00:00.000Z"
    }).map((row) => row.id), [prospect.id]);

    const event = appendActivityEvent({
      dedupeKey: "touch:one",
      kind: "touch",
      personId: person.id,
      prospectId: prospect.id,
      motionId: "motion-1",
      companyId: company.id,
      userId: "user-1",
      surface: "connection_request",
      direction: "outbound",
      outcome: "sent",
      occurredAt: "2026-06-10T12:00:00.000Z"
    });
    assert.equal(appendActivityEvent({ ...event, id: "ignored-id" }).id, event.id);

    const signal = upsertSignalMatch({
      motionAccountId: motionAccount.id,
      motionId: "motion-1",
      companyId: company.id,
      observedAt: "2026-06-10T12:00:00.000Z",
      payload: { summary: "Hiring signal" }
    });
    assert.deepEqual(listSignalMatchesForMotionAccount(motionAccount.id).map((item) => item.id), [signal.id]);

    const draft = upsertProspectDraft({
      prospectId: prospect.id,
      motionId: "motion-1",
      personId: person.id,
      surface: "connection_request",
      channel: "linkedin",
      status: "ready",
      authoredBy: "agent"
    });
    const approved = transitionProspectDraftStatus(draft.id, {
      status: "approved",
      approvedByUserId: "user-1",
      approvedAt: "2026-06-10T12:05:00.000Z"
    });
    assert.equal(approved.approvedByOperator, true);
    assert.equal(approved.approvedByUserId, "user-1");

    const secondAccount = upsertMotionAccount({
      motionId: "motion-2",
      companyId: company.id,
      executionUserId: "user-1",
      queueStatus: "selected"
    });
    upsertProspect({
      motionId: "motion-2",
      companyId: company.id,
      motionAccountId: secondAccount.id,
      personId: person.id,
      queueStatus: "selected",
      cadenceStatus: "ready"
    });
    assert.equal(findCrossMotionOwner({ personId: person.id, excludeMotionId: "motion-2" })?.motionId, "motion-1");

    const relationshipMap = buildAccountRelationshipMap(company.id);
    assert.equal(relationshipMap.people[0].personId, person.id);
    assert.equal(relationshipMap.people[0].latestActivity?.id, event.id);
  });
});

test("disposition and packet review states gate workable branches through normalized rows", () => {
  withIsolatedExoState(() => {
    const database = getLocalDatabase();
    seedLocalUser(database, "user-1");
    seedMotion(database, "motion-1");

    const company = findOrCreateCompany({ name: "Lifecycle Co", domain: "lifecycle.example" });
    const person = resolvePersonIdentity({
      name: "Lifecycle Lead",
      contactPoints: [{ kind: "linkedin_public_id", value: "lifecycle-lead" }]
    }).person;
    const motionAccount = upsertMotionAccount({
      motionId: "motion-1",
      companyId: company.id,
      executionUserId: "user-1",
      queueStatus: "selected"
    });
    const prospect = upsertProspect({
      motionId: "motion-1",
      companyId: company.id,
      motionAccountId: motionAccount.id,
      personId: person.id,
      queueStatus: "selected",
      cadenceStatus: "ready",
      cadenceNextActionDueAt: "2026-06-09T12:00:00.000Z"
    });

    assert.equal(motionAccount.disposition, "active");
    assert.equal(motionAccount.packetStatus, null);
    assert.equal(prospect.disposition, "active");
    assert.equal(prospect.packetStatus, null);
    assert.equal(claimMotionAccountPacket(motionAccount.id, { workerLabel: "account-worker" })?.packetStatus, "claimed");
    assert.equal(submitMotionAccountPacket(motionAccount.id, { now: "2026-06-10T12:01:00.000Z" })?.packetStatus, "submitted");
    assert.equal(returnMotionAccountPacket(motionAccount.id, { now: "2026-06-10T12:02:00.000Z" })?.packetStatus, "returned");
    assert.equal(acceptMotionAccountPacket(motionAccount.id, { now: "2026-06-10T12:03:00.000Z" })?.packetStatus, null);
    assert.equal(clearMotionAccountPacket(motionAccount.id, { now: "2026-06-10T12:04:00.000Z" })?.packetStatus, null);
    assert.equal(claimProspectPacket(prospect.id, { workerLabel: "prospect-worker" })?.packetStatus, "claimed");
    assert.equal(submitProspectPacket(prospect.id, { now: "2026-06-10T12:05:00.000Z" })?.packetStatus, "submitted");
    assert.equal(returnProspectPacket(prospect.id, { now: "2026-06-10T12:06:00.000Z" })?.packetStatus, "returned");
    assert.equal(acceptProspectPacket(prospect.id, { now: "2026-06-10T12:07:00.000Z" })?.packetStatus, null);
    assert.equal(clearProspectPacket(prospect.id, { now: "2026-06-10T12:08:00.000Z" })?.packetStatus, null);

    assert.deepEqual(listDueProspects({
      executionUserId: "user-1",
      now: "2026-06-10T12:00:00.000Z"
    }).map((row) => row.id), [prospect.id]);

    const nurturedAccount = setAccountDisposition(motionAccount.id, {
      disposition: "nurture",
      actor: "operator",
      reason: "Wait for budget cycle",
      at: "2026-06-10T13:00:00.000Z"
    });
    assert.equal(nurturedAccount.disposition, "nurture");
    assert.equal(nurturedAccount.queueStatus, "selected");
    assert.deepEqual(listDueProspects({
      executionUserId: "user-1",
      now: "2026-06-10T13:01:00.000Z"
    }).map((row) => row.id), []);

    setAccountDisposition(motionAccount.id, {
      disposition: "active",
      actor: "operator",
      reason: "Re-opened",
      at: "2026-06-10T14:00:00.000Z"
    });
    const suppressedProspect = setProspectDisposition(prospect.id, {
      disposition: "not_a_fit",
      actor: "agent",
      reason: "No longer matches ICP",
      at: "2026-06-10T14:05:00.000Z"
    });
    assert.equal(suppressedProspect.disposition, "not_a_fit");
    assert.equal(suppressedProspect.queueStatus, "suppressed");
    assert.deepEqual(listDueProspects({
      executionUserId: "user-1",
      now: "2026-06-10T14:06:00.000Z"
    }).map((row) => row.id), []);

    const dispositionEvents = listActivityEvents({ prospectId: prospect.id })
      .filter((event) => event.kind === "system" && event.payload?.type === "disposition_changed");
    assert.equal(dispositionEvents.length, 1);
    assert.equal(dispositionEvents[0].payload.from, "active");
    assert.equal(dispositionEvents[0].payload.to, "not_a_fit");
    assert.equal(dispositionEvents[0].payload.actor, "agent");
  });
});

/**
 * @template T
 * @param {() => T} callback
 * @returns {T}
 */
function withIsolatedExoState(callback) {
  const previousStateDir = process.env.EXO_STATE_DIR;
  const previousHomeStateDir = process.env.EXO_HOME_STATE_DIR;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-normalized-entities-"));
  process.env.EXO_STATE_DIR = stateDir;
  delete process.env.EXO_HOME_STATE_DIR;

  try {
    return callback();
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    if (previousHomeStateDir === undefined) {
      delete process.env.EXO_HOME_STATE_DIR;
    } else {
      process.env.EXO_HOME_STATE_DIR = previousHomeStateDir;
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

function seedLocalUser(database, id) {
  const now = "2026-06-10T12:00:00.000Z";
  database.prepare(`
    INSERT INTO users (id, label, created_at, updated_at, payload_json)
    VALUES (@id, @label, @createdAt, @updatedAt, @payloadJson)
  `).run({
    id,
    label: id,
    createdAt: now,
    updatedAt: now,
    payloadJson: JSON.stringify({ id, label: id, createdAt: now, updatedAt: now })
  });
}

function seedMotion(database, id) {
  const now = "2026-06-10T12:00:00.000Z";
  database.prepare(`
    INSERT INTO motions (id, name, status, source_url, schema_version, created_at, updated_at, payload_json)
    VALUES (@id, @name, 'active', @sourceUrl, 1, @createdAt, @updatedAt, @payloadJson)
  `).run({
    id,
    name: id,
    sourceUrl: `https://example.com/${id}`,
    createdAt: now,
    updatedAt: now,
    payloadJson: JSON.stringify({ id, name: id, status: "active", createdAt: now, updatedAt: now })
  });
}
