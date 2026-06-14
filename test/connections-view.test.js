// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { renderConnectionsPage } from "../src/artifacts/render-connections.js";
import { buildConnectionsViewModel } from "../src/core/build-connections-view.js";

test("connections view treats failed LinkedIn sync as failed current truth, not quiet", () => {
  const model = buildConnectionsViewModel({
    observations: [
      {
        id: "obs-1",
        account: { id: "account-1", capability: "linkedin" },
        kind: "connection_request_pending",
        surfaceKey: "linkedin-sent-invitations",
        actorName: "Prior Invite",
        actorProfileUrl: "https://www.linkedin.com/in/prior-invite/",
        observedAt: "2026-06-13T20:42:00.000Z",
        summary: "Prior Invite is still shown from older data.",
      },
    ],
    truthAccounts: [
      {
        accountId: "account-1",
        capability: "linkedin",
        handle: "williamflanagan",
        label: "William Flanagan",
        preferred: true,
        surfaces: [
          {
            key: "linkedin-sent-invitations",
            label: "Sent Invitations",
            lastRunStatus: "failed",
            lastSyncedAt: "2026-06-14T00:56:03.882Z",
            lastObservedAt: "2026-06-14T00:56:03.354Z",
            lastItemCount: 0,
            lastVisibleTotalCount: 0,
            lastCaptureCompleteness: "failed",
            lastError: "no_client_session: Capture blocked before identity verification.",
            meta: {},
          },
        ],
      },
    ],
    agentQueue: { items: [], tasks: [] },
  });

  assert.equal(model.accounts[0].truth, "failed");
  const sent = model.tabs.find((tab) => tab.key === "sent");
  assert.ok(sent);
  assert.equal(sent.truth, "failed");
  assert.match(sent.gap ?? "", /Last sync failed/);

  const html = renderConnectionsPage(model, {
    interactive: true,
    user: { label: "william-main" },
    generatedAt: "2026-06-14T01:25:00.000Z",
  });

  assert.match(html, /FAILED/i);
  assert.doesNotMatch(html, /Connection requests · sent<\/span><span class="truth-tag"[^>]*>.*QUIET/i);
});
