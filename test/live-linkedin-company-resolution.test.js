// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { resolveLinkedinActorCompanyProfile } from "../src/core/inbound-linkedin-live-sync.js";

test("resolveLinkedinActorCompanyProfile resolves a governed company profile from live Unipile identity data", async () => {
  const requests = [];
  const result = await resolveLinkedinActorCompanyProfile({
    providerAccountId: "unipile-linkedin-1",
    apiKey: "test-api-key",
    baseUrl: "https://api.unipile.test",
    actorTitle: "Founder, Creative Lead",
    actorCompanyName: null,
    actorProfileUrl: "https://www.linkedin.com/in/ezrafox/",
    actorLinkedinPublicId: "ezrafox",
    actorLinkedinMemberId: "member-ezra",
    httpGetImpl(url) {
      const parsed = new URL(url);
      requests.push(`${parsed.pathname}?${parsed.searchParams.toString()}`);

      if (parsed.pathname === "/api/v1/users/member-ezra") {
        return {
          status: 200,
          bodyText: JSON.stringify({
            provider_id: "member-ezra",
            public_identifier: "ezrafox",
            public_profile_url: "https://www.linkedin.com/in/ezrafox/",
            headline: "Founder, Creative Lead",
            current_company_name: "Chaotic Good Studios",
            company: {
              public_identifier: "chaotic-good-studios-llc",
            },
          }),
        };
      }

      if (parsed.pathname === "/api/v1/linkedin/company/chaotic-good-studios-llc") {
        return {
          status: 200,
          bodyText: JSON.stringify({
            name: "Chaotic Good Studios",
            public_identifier: "chaotic-good-studios-llc",
            profile_url: "https://www.linkedin.com/company/chaotic-good-studios-llc/",
            website: "https://www.hellochaoticgood.com/",
            logo_url: "https://cdn.example.test/chaotic-good-logo.png",
          }),
        };
      }

      return {
        status: 404,
        bodyText: JSON.stringify({ error: "not found" }),
      };
    },
  });

  assert.deepEqual(result, {
    name: "Chaotic Good Studios",
    domain: "hellochaoticgood.com",
    websiteUrl: "https://www.hellochaoticgood.com/",
    linkedinCompanyUrl: "https://www.linkedin.com/company/chaotic-good-studios-llc/",
    logoSourceUrl: "https://cdn.example.test/chaotic-good-logo.png",
  });
  assert.ok(requests.some((request) => request.startsWith("/api/v1/users/member-ezra?")));
  assert.ok(requests.some((request) => request.startsWith("/api/v1/linkedin/company/chaotic-good-studios-llc?")));
});

test("resolveLinkedinActorCompanyProfile unwraps LinkedIn redirect URLs before storing a company website", async () => {
  const result = await resolveLinkedinActorCompanyProfile({
    providerAccountId: "unipile-linkedin-1",
    apiKey: "test-api-key",
    baseUrl: "https://api.unipile.test",
    actorTitle: "Founder",
    actorCompanyName: null,
    actorProfileUrl: "https://www.linkedin.com/in/saskia/",
    actorLinkedinPublicId: "saskia",
    actorLinkedinMemberId: "member-saskia",
    httpGetImpl(url) {
      const parsed = new URL(url);

      if (parsed.pathname === "/api/v1/users/member-saskia") {
        return {
          status: 200,
          bodyText: JSON.stringify({
            provider_id: "member-saskia",
            public_identifier: "saskia",
            public_profile_url: "https://www.linkedin.com/in/saskia/",
            headline: "Founder",
            current_company_name: "Savoir Social",
            company: {
              public_identifier: "savoir-social",
            },
          }),
        };
      }

      if (parsed.pathname === "/api/v1/linkedin/company/savoir-social") {
        return {
          status: 200,
          bodyText: JSON.stringify({
            name: "Savoir Social",
            public_identifier: "savoir-social",
            profile_url: "https://www.linkedin.com/company/savoir-social/",
            website: "https://www.linkedin.com/redir/phishing-page?url=http%3A%2F%2Fwww.savoirsocial.com",
            logo_url: "https://cdn.example.test/savoir-social-logo.png",
          }),
        };
      }

      return {
        status: 404,
        bodyText: JSON.stringify({ error: "not found" }),
      };
    },
  });

  assert.deepEqual(result, {
    name: "Savoir Social",
    domain: "savoirsocial.com",
    websiteUrl: "http://www.savoirsocial.com/",
    linkedinCompanyUrl: "https://www.linkedin.com/company/savoir-social/",
    logoSourceUrl: "https://cdn.example.test/savoir-social-logo.png",
  });
});
