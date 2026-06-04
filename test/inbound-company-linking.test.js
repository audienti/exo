// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { offerUrl, runCliJson } from "./support/live-runtime.js";

function buildInboundSyncPayload(accountId, overrides = {}) {
  return {
    mode: "quick",
    accounts: [
      {
        accountId,
        surfaces: [
          {
            surfaceKey: "linkedin-messaging-inbox",
            status: "success",
            observedAt: "2026-06-04T19:00:00.000Z",
            itemCount: 1,
            visibleTotalCount: 1,
            captureCompleteness: "complete",
            requestedMode: "quick",
            actualMode: "quick",
            reconcileRequired: false,
            reconcileReason: null,
            exhaustionStatus: "complete",
            error: null,
            observations: [
              {
                kind: "inbound_reply_received",
                externalId: "thread-pawan-1",
                observedAt: "2026-06-04T19:00:00.000Z",
                actorName: "Pawan Choudhary",
                actorTitle: "Founder & CEO @ LeadsCampaign",
                actorCompanyName: "LeadsCampaign",
                actorHandle: "pawanchoudharyy",
                actorProfileUrl: "https://www.linkedin.com/in/pawanchoudharyy/",
                actorLinkedinPublicId: "pawanchoudharyy",
                actorLinkedinMemberId: "member-pawan",
                summary: "Pawan Choudhary has unread LinkedIn message activity.",
                messages: [
                  {
                    id: "msg-1",
                    direction: "inbound",
                    sentAt: "2026-06-04T19:00:00.000Z",
                    fromName: "Pawan Choudhary",
                    fromHandle: null,
                    body: "Would you like me to get started?",
                  },
                ],
                ...overrides,
              },
            ],
          },
        ],
      },
    ],
  };
}

test("inbound sync run reuses an existing canonical company from inbound LinkedIn company identity", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-company-linking-"));

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", "linkedin-user", "--owner", "william", "--json"]);
    const withLinkedin = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "linkedin-user",
      "--runtime",
      "codex",
      "--connector",
      "chrome",
      "--preferred",
      "--json",
    ]);
    const linkedinAccountId = withLinkedin.accounts.find((account) => account.capability === "linkedin").id;

    const existingCompany = runCliJson(tempDir, [
      "companies",
      "add",
      "--name",
      "LeadsCampaign",
      "--json",
    ]);

    const syncRunPath = path.join(tempDir, "inbound-company-sync.json");
    fs.writeFileSync(syncRunPath, JSON.stringify(buildInboundSyncPayload(linkedinAccountId), null, 2));

    const firstRun = runCliJson(tempDir, ["inbound", "sync", "run", user.id, "--input", syncRunPath, "--json"]);
    assert.ok(firstRun.observations[0].companyId);

    const companiesAfterFirstRun = runCliJson(tempDir, ["companies", "list", "--json"]);
    const leadsCampaignEntries = companiesAfterFirstRun.filter((company) => company.name === "LeadsCampaign");
    assert.equal(leadsCampaignEntries.length, 1);
    assert.equal(firstRun.observations[0].companyId, existingCompany.id);
    assert.equal(firstRun.observations[0].companyId, leadsCampaignEntries[0].id);

    const secondRun = runCliJson(tempDir, ["inbound", "sync", "run", user.id, "--input", syncRunPath, "--json"]);
    const companiesAfterSecondRun = runCliJson(tempDir, ["companies", "list", "--json"]);
    const dedupedEntries = companiesAfterSecondRun.filter((company) => company.name === "LeadsCampaign");
    assert.equal(dedupedEntries.length, 1);
    assert.equal(secondRun.observations[0].companyId, leadsCampaignEntries[0].id);

    const observations = runCliJson(tempDir, ["inbound", "observations", "list", user.id, "--json"]);
    assert.equal(observations.observations[0].companyId, leadsCampaignEntries[0].id);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync run does not create a new canonical company from an unscoped inbound row", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-company-linking-unscoped-"));

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", "linkedin-user", "--owner", "william", "--json"]);
    const withLinkedin = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "linkedin-user",
      "--runtime",
      "codex",
      "--connector",
      "chrome",
      "--preferred",
      "--json",
    ]);
    const linkedinAccountId = withLinkedin.accounts.find((account) => account.capability === "linkedin").id;

    const syncRunPath = path.join(tempDir, "inbound-company-unscoped-sync.json");
    fs.writeFileSync(syncRunPath, JSON.stringify(buildInboundSyncPayload(linkedinAccountId), null, 2));

    const result = runCliJson(tempDir, ["inbound", "sync", "run", user.id, "--input", syncRunPath, "--json"]);
    assert.equal(result.observations[0].companyId, null);

    const companies = runCliJson(tempDir, ["companies", "list", "--json"]);
    assert.equal(companies.filter((company) => company.name === "LeadsCampaign").length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync run can create a canonical company when the inbound row is already scoped to a motion", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-company-linking-motion-scoped-"));

  try {
    const motion = runCliJson(tempDir, [
      "motion",
      "add",
      "--url",
      offerUrl,
      "--premise",
      "This offer matters when inbound activity must land on a governed motion branch.",
      "--audience",
      "Revenue leaders",
      "--signal",
      "company::Is there active GTM pressure that makes inbound company resolution useful?",
      "--json",
    ]);
    const user = runCliJson(tempDir, ["users", "add", "--label", "linkedin-user", "--owner", "william", "--json"]);
    const withLinkedin = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "linkedin-user",
      "--runtime",
      "codex",
      "--connector",
      "chrome",
      "--preferred",
      "--json",
    ]);
    const linkedinAccountId = withLinkedin.accounts.find((account) => account.capability === "linkedin").id;

    const syncRunPath = path.join(tempDir, "inbound-company-motion-sync.json");
    fs.writeFileSync(
      syncRunPath,
      JSON.stringify(buildInboundSyncPayload(linkedinAccountId, { motionId: motion.id }), null, 2),
    );

    const result = runCliJson(tempDir, ["inbound", "sync", "run", user.id, "--input", syncRunPath, "--json"]);
    assert.ok(result.observations[0].companyId);
    assert.equal(result.observations[0].motionId, motion.id);

    const companies = runCliJson(tempDir, ["companies", "list", "--json"]);
    const leadsCampaignEntries = companies.filter((company) => company.name === "LeadsCampaign");
    assert.equal(leadsCampaignEntries.length, 1);
    assert.equal(leadsCampaignEntries[0].motionIds.includes(motion.id), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
