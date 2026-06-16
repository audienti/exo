// @ts-check
//
// Interactive Exo UI server.
//
// Serves the operator surfaces from live Exo state and executes action intents
// against the real governed writers (cadence / queue / touch / observation).
// This is the live wiring: nav routes between surfaces, and every action button
// POSTs its typed intent to /act, which mutates the .exo store and reloads.

import http from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { resolveStatePaths } from "../db/paths.js";
import { renderCleanupPage } from "../artifacts/render-cleanup.js";
import { renderConnectionsPage } from "../artifacts/render-connections.js";
import { renderExecutionPage, renderUserDetailPage } from "../artifacts/render-execution.js";
import { renderMotionsPage, renderMotionDetailPage, renderMotionSettingsPage } from "../artifacts/render-motions.js";
import { renderOnboardingPage } from "../artifacts/render-onboarding.js";
import { renderOperatorPage, operatorViewHref } from "../artifacts/render-operator.js";
import { renderQueuePage } from "../artifacts/render-queue.js";
import { renderSettingsPage } from "../artifacts/render-settings.js";
import { renderPersonPage } from "../artifacts/render-person.js";
import { renderProspectsPage, renderProspectDetailPage } from "../artifacts/render-prospects.js";
import { renderCompanyDetailPage } from "../artifacts/render-company-detail.js";
import { renderCompanyResearchBriefPage } from "../artifacts/render-company-research-brief-page.js";
import { buildInboundReviewView } from "../core/build-inbound-review-view.js";
import { buildAgentRunLog } from "../core/agent-run-log.js";
import { buildCleanupViewModel } from "../core/build-cleanup-view.js";
import { buildCompanyViewModel } from "../core/build-company-view.js";
import { buildCompanyResearchBrief } from "../core/build-company-research-brief.js";
import { filterCleanupLaneItems } from "../core/cleanup-lane.js";
import { buildMotionPacketSummary } from "../lib/motion-packets.js";
import { renderWorkspaceRollupPage } from "../artifacts/render-workspace-rollup.js";
import { buildConnectionsViewModel } from "../core/build-connections-view.js";
import { buildAgentQueue } from "../core/build-agent-queue.js";
import { resolvePersonComposeDraft } from "../core/build-person-compose-draft.js";
import { buildPersonView } from "../core/build-person-view.js";
import { findTransitionMotion, isTransitionMotion } from "../core/ensure-transition-motion.js";
import { buildExecutionViewModel } from "../core/build-execution-view.js";
import { buildMotionsViewModel } from "../core/build-motions-view.js";
import { buildOnboardingState } from "../core/onboarding.js";
import { buildOperatorViewModel } from "../core/build-operator-view.js";
import { buildProspectsViewModel } from "../core/build-prospects-view.js";
import { buildMotionProspectView } from "../core/build-motion-prospect-view.js";
import { buildSettingsViewModel } from "../core/build-settings-view.js";
import { buildWorkspaceRollup } from "../core/build-workspace-rollup.js";
import { buildUserWorkspaceContext } from "../core/workspace-context.js";
import { executeActionIntent } from "../core/execute-action-intent.js";
import { resolveConnectionNoteCapability } from "../core/connection-note-capability.js";
import { resolveScopedExecutionAssignment } from "../core/resolve-scoped-execution-assignment.js";
import { removeUiLock, writeUiLock } from "./ui-lock.js";
import { btn, card, countChip, escapeHtml, renderShell, sectionHead } from "../lib/exo-ui-components.js";
import {
  findCompanyById,
  findMotionById,
  findUserById,
  listAgentQueueProspectBranches,
  listBrowserProfiles,
  listCompanies,
  listInboundCues,
  listInboundObservations,
  listMotions,
  listUsers,
} from "../db/database.js";
import { summarizeExecutionUsers } from "../lib/execution-users.js";
import { buildMotionRoutesProjection, buildQueueRoutesProjection, buildWorkspaceProjection } from "./workspace-runtime.js";
import { buildSchedulerCadenceSummary, inspectAgentRoutineState, inspectAgentSchedulerState } from "./commands/agent.js";
import { buildAgentRunLockDir, inspectAgentRunLock } from "../lib/agent-run-lock.js";
import { pruneInactiveTaskLeases } from "../lib/agent-host-state.js";
import { AGENT_EXECUTION_LANES } from "../lib/agent-task-lanes.js";
import { requiresSendVerification } from "../lib/agent-send-verification.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;
const MAX_CACHED_WORKSPACE_PROJECTIONS = 8;
const MAX_CACHED_AGENT_RUNTIME_SNAPSHOTS = 8;
/** @type {Map<string, ReturnType<typeof buildWorkspaceProjection>>} */
const cachedWorkspaceProjections = new Map();
/** @type {Map<string, Promise<ReturnType<typeof buildWorkspaceProjection>>>} */
const cachedWorkspaceProjectionBuilds = new Map();
/** @type {Map<string, ReturnType<typeof buildAgentRuntimeSnapshot>>} */
const cachedAgentRuntimeSnapshots = new Map();

/**
 * @param {{ userId?: string | null, capability?: string | null, host?: string | null, port?: number | null }} input
 */
export async function startExoUiServer(input) {
  const capability = input.capability ?? "linkedin";
  const host = input.host ?? DEFAULT_HOST;
  const requestedPort = input.port ?? DEFAULT_PORT;
  const allowPortFallback = input.port == null;
  const startedAt = new Date().toISOString();

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${requestedPort}`}`);

    try {
      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
        respondRedirect(response, `/operator${url.search}`);
        return;
      }

      if (request.method === "GET" && (url.pathname === "/status" || url.pathname === "/healthz")) {
        const session = resolveUiRouteSession(input.userId ?? null);
        respondJson(response, 200, {
          ok: true,
          service: "exo-ui",
          userId: session.userId,
          onboarding: session.mode === "onboarding",
          startedAt: startedAt,
          routes: session.mode === "onboarding"
            ? ["/onboarding", "/users"]
            : ["/operator", "/motions", "/prospects", "/users", "/connections", "/workspace", "/settings", "/cleanup", "/queue"],
        });
        return;
      }

      // Lightweight data-revision probe: the client polls this and soft-reloads
      // when the store changes underneath it (e.g. the agent writes a touch),
      // so the surface stays live without a manual refresh.
      if (request.method === "GET" && url.pathname === "/state") {
        respondJson(response, 200, { rev: currentStateRev() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/act") {
        const body = await readJsonBody(request);
        const result = await executeActionIntent(/** @type {any} */ (body));
        clearWorkspaceProjectionCache();
        respondJson(response, 200, result);
        return;
      }

      if (request.method === "GET") {
        const route = url.pathname === "/" ? "/operator" : `${url.pathname}${url.search}`;
        const html = await renderRoute(route, { userId: input.userId ?? null, capability });
        if (html) {
          respondHtml(response, html);
          return;
        }
      }

      respondJson(response, 404, { ok: false, error: `Not found: ${request.method} ${url.pathname}` });
    } catch (error) {
      respondJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  await listenWithPortFallback(server, host, requestedPort, allowPortFallback);

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  const url = `http://${host}:${port}/`;

  // Advertise the running UI so other agents can discover it.
  writeUiLock({ host, port, url, userId: input.userId ?? null });
  const cleanup = () => removeUiLock();
  server.once("close", cleanup);
  process.once("exit", cleanup);
  process.once("SIGINT", () => { cleanup(); process.exit(0); });
  process.once("SIGTERM", () => { cleanup(); process.exit(0); });

  return { server, host, port, url };
}

/**
 * @param {string} route
 * @param {{ userId: string | null, capability: string }} ctx
 * @param {{
 *   listInboundObservations?: typeof listInboundObservations,
 *   listMotions?: typeof listMotions,
 *   listCompanies?: typeof listCompanies,
 *   buildPersonView?: typeof buildPersonView,
 *   resolvePersonComposeDraft?: typeof resolvePersonComposeDraft,
 *   findTransitionMotion?: typeof findTransitionMotion,
 *   renderPersonPage?: typeof renderPersonPage,
 *   resolveWorkspaceProjectionForUi?: typeof resolveWorkspaceProjectionForUi,
 * }} [hooks]
 * @returns {Promise<string | null>}
 */
export async function renderRoute(route, ctx, hooks = {}) {
  const requestUrl = new URL(route, "http://exo.local");
  const pathname = requestUrl.pathname;
  const searchQuery = normalizeRouteSearchQuery(requestUrl.searchParams.get("q"));
  const selectedAccountId = normalizeRouteAccountId(requestUrl.searchParams.get("account"));
  const listUsersFn = hooks.listUsers ?? listUsers;
  const listInboundObservationsFn = hooks.listInboundObservations ?? listInboundObservations;
  const listMotionsFn = hooks.listMotions ?? listMotions;
  const listCompaniesFn = hooks.listCompanies ?? listCompanies;
  const buildPersonViewFn = hooks.buildPersonView ?? buildPersonView;
  const resolvePersonComposeDraftFn = hooks.resolvePersonComposeDraft ?? resolvePersonComposeDraft;
  const findTransitionMotionFn = hooks.findTransitionMotion ?? findTransitionMotion;
  const renderPersonPageFn = hooks.renderPersonPage ?? renderPersonPage;
  const resolveWorkspaceProjectionForUiFn = hooks.resolveWorkspaceProjectionForUi ?? resolveWorkspaceProjectionForUi;
  const session = resolveUiRouteSession(ctx.userId);
  const runtimeUserId = session.userId ?? session.preferredUserId ?? null;
  const buildRouteAgentRuntime = ({ userId = runtimeUserId, generatedAt, reviewItems } = {}) => ({
    ...resolveAgentRuntimeSnapshotForUi(userId, { lightweight: true }),
    nav: resolveCleanupNavState({
      userId,
      capability: ctx.capability,
      generatedAt,
      reviewItems,
      listInboundObservationsFn,
      listMotionsFn,
      listCompaniesFn,
    }),
  });
  const meta = (regenerateCommand) => ({
    user: { label: undefined },
    generatedAt: new Date().toISOString(),
    regenerateCommand,
    interactive: true,
    agentRuntime: buildRouteAgentRuntime(),
  });
  const runtimeAccountDiscovery = buildUiRuntimeAccountDiscovery();

  if (
    session.mode === "onboarding"
    && pathname !== "/users"
    && !pathname.startsWith("/users/")
  ) {
    return renderOnboardingPage(
      buildOnboardingState({ preferredUserId: session.preferredUserId }),
      { interactive: true },
    );
  }

  // Users roster + per-user detail are sourced from raw state (all users).
  if (pathname === "/users" || pathname.startsWith("/users/")) {
    const model = buildExecutionViewModel({
      rawUsers: listUsersFn(),
      rawMotions: listMotionsFn(),
      rawCompanies: listCompaniesFn(),
      rawProfiles: listBrowserProfiles(),
      runtimeAccountDiscovery,
    });
    const userSegments = pathname.split("/").filter(Boolean);
    if (userSegments.length === 1) {
      return renderExecutionPage(model, meta("exo ui"));
    }
    const id = decodeURIComponent(userSegments[1] ?? "");
    const user = model.users.find((candidate) => candidate.id === id);
    if (!user) {
      return renderNotFound("User", id, "/users", "Users");
    }
    if (userSegments.length === 3 && userSegments[2] === "connections") {
      const projection = await resolveWorkspaceProjectionForUiFn({
        userId: user.id,
        capability: ctx.capability,
        regenerateCommand: "exo ui",
      });
      const data = projection.data;
      const transition = findTransitionMotionFn();
      const claimMotions = buildClaimMotionChoices(
        listMotions().filter((motion) => motion.status !== "archived"),
        transition,
      );
      const routeAgentRuntime = {
        ...resolveAgentRuntimeSnapshotForUi(user.id),
        nav: resolveCleanupNavState({
          userId: user.id,
          capability: ctx.capability,
          generatedAt: data.generatedAt,
          reviewItems: data.reviewItems ?? [],
        }),
      };
      return renderConnectionsView({
        data,
        agentRuntime: routeAgentRuntime,
        userId: user.id,
        accountPath: `/users/${encodeURIComponent(user.id)}/connections`,
        selectedAccountId,
        claimMotions,
      });
    }
    if (userSegments.length > 2) {
      return renderNotFound("User page", pathname, "/users", "Users");
    }
    return renderUserDetailPage(user, meta("exo ui"));
  }

  if (pathname === "/settings") {
    const model = buildSettingsViewModel({
      settingsCwd: process.cwd(),
      runtimeAccountDiscovery,
    });
    return renderSettingsPage(model, meta("exo ui"));
  }

  // Internal person show page (works for any inbound person, not just prospects).
  if (pathname.startsWith("/people/")) {
    const id = decodeURIComponent(pathname.slice("/people/".length));
    const rawObservations = listInboundObservationsFn({ userId: session.userId });
    const rawMotions = listMotionsFn();
    const rawCompanies = listCompaniesFn();
    const rawUsers = listUsersFn();
    const rawPerson = buildPersonViewFn({
      observationId: id,
      rawObservations,
      rawMotions,
      rawCompanies,
      rawUsers,
    });
    if (!rawPerson) {
      return renderNotFound("Person", id, "/connections", "Connections");
    }
    const shouldDraftCompose = shouldResolvePersonCompose(requestUrl)
      && !rawPerson.matchedProspect
      && rawPerson.hasDurableIdentity !== false
      && !rawPerson.promotionBlocker
      && Boolean(rawPerson.suggestedSurface);
    const person = shouldDraftCompose
      ? {
          ...rawPerson,
          composeDraft: resolvePersonComposeDraftFn(rawPerson),
        }
      : rawPerson;
    const transition = findTransitionMotionFn();
    return renderPersonPageFn(person, {
      interactive: true,
      userId: session.userId,
      returnTo: normalizeRouteReturnTo(requestUrl.searchParams.get("return")),
      transitionMotionId: transition?.id ?? null,
      // Transition backlog first (the default add target), then real motions.
      motions: buildClaimMotionChoices(rawMotions, transition),
    });
  }

  // Motion-scoped company research brief page only needs the canonical company,
  // motion, and packet state. Do not block it on the full workspace projection.
  if (pathname.startsWith("/companies/") && pathname.includes("/research-brief/")) {
    const segments = pathname.split("/").filter(Boolean);
    const companyId = decodeURIComponent(segments[1] ?? "");
    const motionId = decodeURIComponent(segments[3] ?? "");
    const company = findCompanyById(companyId);
    if (!company) {
      return renderNotFound("Company", companyId, "/prospects", "Prospects");
    }
    if (!motionId || !company.motionIds.includes(motionId)) {
      return renderNotFound("Research brief", `${companyId}:${motionId || "missing-motion"}`, `/companies/${encodeURIComponent(companyId)}`, company.name);
    }
    const motion = findMotionById(motionId);
    if (!motion) {
      return renderNotFound("Motion", motionId, `/companies/${encodeURIComponent(companyId)}`, company.name);
    }
    const brief = buildCompanyResearchBrief(company, motion);
    const packetSummary = buildMotionPacketSummary(motion, [company], { companyId });
    const researchPacket = packetSummary.items.find((item) => item.packetKind === "company_research") ?? null;
    return renderCompanyResearchBriefPage({
      brief,
      packet: researchPacket
        ? {
            claimState: researchPacket.claimState ?? null,
            queueStatus: researchPacket.queueStatus ?? null,
            workerLabel: researchPacket.workerLabel ?? null,
          }
        : {
            claimState: null,
            queueStatus:
              (motion.targetMap?.accounts ?? []).find((account) => account.companyId === companyId)?.queueState?.status ?? null,
            workerLabel: null,
          },
      interactive: true,
      // This page is a read-only packet view. Do not stall it on global agent
      // queue / cleanup scans just to render the header status pill.
      agentRuntime: null,
    });
  }

  // Canonical company detail only needs the stored company, its linked motions,
  // and the prospects already carried on those motion accounts. Do not block
  // it on the full workspace projection.
  if (pathname.startsWith("/companies/") && pathname.split("/").filter(Boolean).length === 2) {
    const segments = pathname.split("/").filter(Boolean);
    const companyId = decodeURIComponent(segments[1] ?? "");
    const company = findCompanyById(companyId);
    if (!company) {
      return renderNotFound("Company", companyId, "/prospects", "Prospects");
    }
    const currentUiUser = resolveCurrentUiUser(session, null);
    const model = buildCompanyViewModel({
      company,
      motions: listMotions(),
    });
    return renderCompanyDetailPage(model, {
      interactive: true,
      user: currentUiUser ? buildUiCurrentUserMeta(currentUiUser, currentUiUser) : null,
    });
  }

  const projection = await resolveWorkspaceProjectionForUiFn({
    userId: session.userId,
    capability: ctx.capability,
    regenerateCommand: "exo ui",
  }, resolveRouteProjectionOptions(pathname));
  const data = projection.data;
  const currentUiUser = resolveCurrentUiUser(session, data.user);
  const routeAgentRuntime = pathname === "/queue"
    ? buildQueueRouteAgentRuntime(runtimeUserId, data.agentQueue)
    : resolveAgentRuntimeSnapshotForUi(runtimeUserId, usesFullAgentRuntime(pathname) ? {} : { lightweight: true });
  const baseMeta = {
    user: buildUiCurrentUserMeta(currentUiUser, data.user),
    generatedAt: data.generatedAt,
    regenerateCommand: "exo ui",
    interactive: true,
    agentRuntime: {
      ...routeAgentRuntime,
      nav: resolveCleanupNavState({
        userId: session.userId ?? session.preferredUserId ?? null,
        capability: ctx.capability,
        generatedAt: data.generatedAt,
        reviewItems: data.reviewItems ?? [],
      }),
    },
    agentStatus: data.agentStatus ?? null,
  };

  // Motion settings page.
  if (pathname.startsWith("/motions/") && pathname.endsWith("/settings")) {
    const segments = pathname.split("/").filter(Boolean);
    const id = decodeURIComponent(segments[1] ?? "");
    const model = buildMotionsViewModel({ motionSummaries: data.motionSummaries, motionDetails: data.motionDetails, rawMotions: listMotions(), rawCompanies: listCompanies() });
    const motion = model.details.find((candidate) => candidate.id === id);
    if (!motion) {
      return renderNotFound("Motion", id, "/motions", "Motions");
    }
    const rawMotion = findMotionById(id);
    return renderMotionSettingsPage({
      ...motion,
      executionAssignment: rawMotion?.engagementUserAssignment ?? null,
    }, baseMeta);
  }

  // Per-motion detail page.
  if (pathname.startsWith("/motions/")) {
    const segments = pathname.split("/").filter(Boolean);
    const id = decodeURIComponent(segments[1] ?? "");
    const model = buildMotionsViewModel({ motionSummaries: data.motionSummaries, motionDetails: data.motionDetails, rawMotions: listMotions(), rawCompanies: listCompanies() });
    const motion = model.details.find((candidate) => candidate.id === id);
    if (!motion) {
      return renderNotFound("Motion", id, "/motions", "Motions");
    }
    return renderMotionDetailPage(motion, baseMeta);
  }

  // Per-prospect detail page.
  if (pathname.startsWith("/prospects/")) {
    const id = decodeURIComponent(pathname.slice("/prospects/".length));
    const model = buildProspectsViewModel({
      prospectPrepLanes: data.prospectPrepLanes,
      engagementLanes: data.engagementLanes,
      motionDetails: data.motionDetails,
      rawMotions: listMotions(),
    });
    const person = model.details.find((candidate) => candidate.id === id);
    if (!person) {
      return renderNotFound("Prospect", id, "/prospects", "Prospects");
    }
    // Enrich with the prospect's stored record (drafts + engagement touches +
    // provenance), which the projection does not carry — so the compose panel
    // can show the agent's draft and the detail page can render the real
    // engagement timeline.
    const record = lookupProspectRecord(person.motionId, person.companyId, person.id);
    person.drafts = record?.drafts ?? [];
    person.touches = record?.touches ?? [];
    person.timelineNotes = record?.timelineNotes ?? [];
    const surfacedAt = resolveProspectSurfacedAt(record);
    person.firstSeenAt = surfacedAt;
    person.selectedAt = surfacedAt;
    person.agentQueueItems = collectProspectAgentQueueItems(data.agentQueue, person);
    const handledReviewItem = (data.reviewItems ?? []).find(
      (item) => item?.prospect?.id === person.id && item.state === "reply_unavailable",
    );
    person.handledNotification = handledReviewItem
      ? {
          state: handledReviewItem.state,
          message: handledReviewItem.recommendedAction ?? null,
          detail: handledReviewItem.whyItMatters ?? null,
        }
      : null;
    const transition = findTransitionMotion();
    const company = person.companyId ? findCompanyById(person.companyId) : null;
    const rawMotion = person.motionId ? findMotionById(person.motionId) : null;
    const motionProspectView = rawMotion
      ? buildMotionProspectView(rawMotion, {
          companyId: person.companyId,
          prospectId: person.id,
          rawObservations: data.observations ?? [],
        }).prospect
      : null;
    person.threadMessages = motionProspectView?.threadMessages ?? [];
    person.latestInboundMessage = motionProspectView?.latestInboundMessage ?? null;
    person.timelineObservations = motionProspectView?.timelineObservations ?? [];
    person.accountDisposition = motionProspectView?.accountDisposition ?? "active";
    person.disposition = motionProspectView?.disposition ?? "active";
    person.packetStatus = motionProspectView?.packetStatus ?? null;
    person.packetState = motionProspectView?.packetState ?? null;
    const linkedinExecution = company
      ? resolveScopedExecutionAssignment({
          rawCompany: company,
          rawMotion,
          rawProfiles: listBrowserProfiles(),
          rawUsers: listUsers(),
          capability: "linkedin",
        })
      : null;
    const detailMeta = {
      ...baseMeta,
      userId: session.userId,
      searchQuery,
      transitionMotionId: transition?.id ?? null,
      // Whether the LinkedIn account Exo sends from can attach a note to a
      // connection request (Premium / Sales Navigator). true/false are
      // verified verdicts; null means no identity is pinned yet or the plan
      // tier has not been verified.
      connectionNoteCapable: resolveConnectionNoteCapability({
        resolvedAccount: linkedinExecution?.resolvedAccount ?? null,
        accountRefs: linkedinExecution?.userAssignmentRecord?.accountRefs
          ?? company?.engagementUserAssignment?.accountRefs
          ?? null,
      }),
      // Name the identity that actually resolved for sending, so the compose
      // panel talks about the same account the send path will use. The cached
      // company assignment label is only a fallback: with several users the
      // resolution can legitimately land on a different identity than the
      // stale cached label suggests.
      assignedIdentity: describeResolvedLinkedinIdentity(linkedinExecution)
        ?? company?.engagementUserAssignment?.label
        ?? null,
      motions: buildClaimMotionChoices(
        listMotions().filter((motion) => motion.status !== "archived"),
        transition,
      ),
      // Execution users for the "Assign owner" picker.
      users: listUsers().map((user) => ({ id: user.id, label: user.label })),
    };
    return renderProspectDetailPage(person, detailMeta);
  }

  switch (pathname) {
    case "/operator": {
      const requestedView = normalizeOperatorView(requestUrl.searchParams.get("view"));
      const selectedMotionId = normalizeOperatorMotion(requestUrl.searchParams.get("motion"));
      const operatorMeta = {
        ...baseMeta,
        activeView: selectedMotionId ? "motions" : requestedView,
        selectedMotionId,
        motionChoices: buildOperatorMotionChoices(data.motionSummaries ?? [], listMotions()),
        returnTo: buildOperatorReturnTo({ view: requestedView, motionId: selectedMotionId }),
      };
      const model = buildOperatorViewModel({
        user: data.user,
        generatedAt: data.generatedAt,
        regenerateCommand: "exo ui",
        operatorSummary: data.operatorSummary,
        decisionQueue: data.decisionQueue,
        agentQueue: data.agentQueue,
        blockedQueue: data.blockedQueue,
        dueNowItems: data.dueNowItems,
        waitingItems: data.waitingItems,
        truthAccounts: data.truthAccounts,
        agentRuntime: baseMeta.agentRuntime,
        rawMotions: listMotions(),
      });
      return renderOperatorPage(model, operatorMeta);
    }
    case "/queue": {
      const model = buildOperatorViewModel({
        user: data.user,
        generatedAt: data.generatedAt,
        regenerateCommand: "exo ui",
        operatorSummary: data.operatorSummary,
        decisionQueue: data.decisionQueue,
        agentQueue: data.agentQueue,
        blockedQueue: data.blockedQueue,
        dueNowItems: data.dueNowItems,
        waitingItems: data.waitingItems,
        truthAccounts: data.truthAccounts,
        agentRuntime: baseMeta.agentRuntime,
        rawMotions: data.rawMotions ?? listMotions(),
      });
      const queueMeta = {
        ...baseMeta,
        agentRunLog: buildAgentRunLog({
          stateDir: resolveStatePaths().homeStateDir,
          limit: 18,
          now: data.generatedAt,
        }),
      };
      return renderQueuePage(model, queueMeta);
    }
    case "/cleanup": {
      const model = buildCleanupViewModel({
        user: data.user,
        generatedAt: data.generatedAt,
        regenerateCommand: "exo ui",
        reviewItems: data.reviewItems ?? [],
        agentRuntime: baseMeta.agentRuntime,
      });
      return renderCleanupPage(model, { ...baseMeta, returnTo: "/cleanup" });
    }
    case "/motions": {
      const model = buildMotionsViewModel({ motionSummaries: data.motionSummaries, motionDetails: data.motionDetails, rawMotions: listMotions(), rawCompanies: listCompanies() });
      return renderMotionsPage(model, {
        ...baseMeta,
        users: listUsers().map((user) => ({ id: user.id, label: user.label })),
      });
    }
    case "/prospects": {
      const model = buildProspectsViewModel({
        prospectPrepLanes: data.prospectPrepLanes,
        engagementLanes: data.engagementLanes,
        motionDetails: data.motionDetails,
        rawMotions: listMotions(),
        query: searchQuery,
      });
      return renderProspectsPage(model, { ...baseMeta, searchQuery });
    }
    case "/connections": {
      const transition = findTransitionMotion();
      const claimMotions = buildClaimMotionChoices(
        listMotions().filter((motion) => motion.status !== "archived"),
        transition,
      );
      return renderConnectionsView({
        data,
        agentRuntime: baseMeta.agentRuntime,
        userId: session.userId,
        accountPath: "/connections",
        selectedAccountId,
        claimMotions,
      });
    }
    case "/workspace": {
      const executionModel = buildExecutionViewModel({
        rawUsers: listUsers(),
        rawMotions: listMotions(),
        rawCompanies: listCompanies(),
        rawProfiles: listBrowserProfiles(),
      });
      const model = buildWorkspaceRollup({
        operatorSummary: data.operatorSummary,
        decisionQueue: data.decisionQueue,
        agentQueue: data.agentQueue,
        blockedQueue: data.blockedQueue,
        motionSummaries: data.motionSummaries,
        truthAccounts: data.truthAccounts,
        reviewItems: data.reviewItems,
        itemizationGaps: data.itemizationGaps ?? [],
        executionUsers: executionModel.users,
      });
      return renderWorkspaceRollupPage(model, baseMeta);
    }
    default:
      return null;
  }
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalizeRouteSearchQuery(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {string | null} value
 * @returns {string | null}
 */
function normalizeRouteAccountId(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * @param {string | null} value
 * @returns {string | null}
 */
function normalizeRouteReturnTo(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.startsWith("/") ? trimmed : null;
}

/**
 * @param {string | null | undefined} value
 * @returns {"queue" | "blocked" | "motions" | null}
 */
function normalizeOperatorView(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "queue" || normalized === "blocked" || normalized === "motions") {
    return normalized;
  }
  return null;
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function normalizeOperatorMotion(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * @param {{ view: "queue" | "blocked" | "motions" | null, motionId: string | null }} input
 * @returns {string}
 */
function buildOperatorReturnTo(input) {
  return operatorViewHref(input.motionId ? "motions" : (input.view ?? "queue"), input.motionId);
}

/**
 * @param {URL} requestUrl
 * @returns {boolean}
 */
function shouldResolvePersonCompose(requestUrl) {
  const compose = String(requestUrl.searchParams.get("compose") ?? "").trim().toLowerCase();
  return compose === "1" || compose === "true" || compose === "reply";
}

/**
 * @param {{
 *   data: any,
 *   agentRuntime: any,
 *   userId: string | null,
 *   accountPath: string,
 *   selectedAccountId: string | null,
 *   claimMotions: Array<{ id: string, name: string, offerLabel?: string, premise?: string, status?: string | null, statusLabel?: string | null }>,
 * }} input
 */
function renderConnectionsView(input) {
  const model = buildConnectionsViewModel({
    observations: input.data.observations,
    reviewItems: input.data.reviewItems,
    truthAccounts: input.data.truthAccounts,
    agentQueue: input.data.agentQueue,
    selectedAccountId: input.selectedAccountId,
    // Authoritative connection-degree by profile URL, so the Sent / Received
    // tabs reconcile against the real connection state (1st-degree = accepted).
    degreeByProfile: buildDegreeByProfile(),
    // Exact send time by profile URL, taken from our own outbound touches, so
    // the Sent tab shows true age instead of LinkedIn's rounded label.
    sentAtByProfile: buildSentAtByProfile(),
  });
  return renderConnectionsPage(model, {
    user: input.data.user,
    generatedAt: input.data.generatedAt,
    regenerateCommand: "exo ui",
    interactive: true,
    agentRuntime: input.agentRuntime,
    userId: input.userId,
    accountPath: input.accountPath,
    claimMotions: input.claimMotions,
  });
}

/**
 * Reuse one derived workspace projection per state revision so repeated page
 * navigations do not rebuild the same large model over and over, and concurrent
 * requests collapse onto one in-flight build instead of serializing.
 *
 * @param {{ userId: string, capability?: string | null, regenerateCommand: string }} input
 * @param {{
 *   buildProjection?: typeof buildWorkspaceProjection,
 *   cacheScope?: string,
 *   stateRevision?: string,
 * }} [options]
 */
export async function resolveWorkspaceProjectionForUi(input, options = {}) {
  const stateRevision = options.stateRevision ?? currentStateRev();
  const cacheScope = options.cacheScope ?? "workspace";
  const cacheKey = buildWorkspaceProjectionCacheKey(input, cacheScope, stateRevision);

  const cachedProjection = cachedWorkspaceProjections.get(cacheKey);
  if (cachedProjection) {
    return cachedProjection;
  }
  const cachedBuild = cachedWorkspaceProjectionBuilds.get(cacheKey);
  if (cachedBuild) {
    return cachedBuild;
  }

  const fallbackProjection = resolveWorkspaceProjectionCacheFallback(input, cacheScope, stateRevision);
  if (fallbackProjection) {
    cachedWorkspaceProjections.set(cacheKey, fallbackProjection);
    trimWorkspaceProjectionCache();
    return fallbackProjection;
  }

  const fallbackBuild = resolveWorkspaceProjectionBuildFallback(input, cacheScope, stateRevision);
  if (fallbackBuild) {
    const promise = fallbackBuild.then((projection) => {
      cachedWorkspaceProjections.set(cacheKey, projection);
      trimWorkspaceProjectionCache();
      return projection;
    });
    cachedWorkspaceProjectionBuilds.set(cacheKey, promise);

    try {
      return await promise;
    } finally {
      cachedWorkspaceProjectionBuilds.delete(cacheKey);
    }
  }

  const buildProjection = options.buildProjection ?? buildWorkspaceProjection;
  const promise = Promise.resolve().then(() => buildProjection(input));
  cachedWorkspaceProjectionBuilds.set(cacheKey, promise);

  try {
    const projection = await promise;
    cachedWorkspaceProjections.set(cacheKey, projection);
    trimWorkspaceProjectionCache();
    return projection;
  } finally {
    cachedWorkspaceProjectionBuilds.delete(cacheKey);
  }
}

function clearWorkspaceProjectionCache() {
  cachedWorkspaceProjections.clear();
  cachedWorkspaceProjectionBuilds.clear();
  cachedAgentRuntimeSnapshots.clear();
}

function trimWorkspaceProjectionCache() {
  trimBoundedCache(cachedWorkspaceProjections, MAX_CACHED_WORKSPACE_PROJECTIONS);
}

/**
 * @param {{ userId: string, capability?: string | null, regenerateCommand: string }} input
 * @param {string} cacheScope
 * @param {string} stateRevision
 */
function buildWorkspaceProjectionCacheKey(input, cacheScope, stateRevision) {
  return [
    stateRevision,
    cacheScope,
    input.userId,
    input.capability ?? "linkedin",
    input.regenerateCommand,
  ].join("|");
}

/**
 * Let narrower route scopes reuse a broader projection that is already cached
 * for the same state revision. This makes the motions tab cheap after the
 * operator tab has already paid for the full workspace build.
 *
 * @param {{ userId: string, capability?: string | null, regenerateCommand: string }} input
 * @param {string} cacheScope
 * @param {string} stateRevision
 * @returns {ReturnType<typeof buildWorkspaceProjection> | null}
 */
function resolveWorkspaceProjectionCacheFallback(input, cacheScope, stateRevision) {
  if (cacheScope !== "motions") {
    return null;
  }

  const workspaceKey = buildWorkspaceProjectionCacheKey(input, "workspace", stateRevision);
  const cachedWorkspaceProjection = cachedWorkspaceProjections.get(workspaceKey);
  return cachedWorkspaceProjection
    ? deriveMotionsProjectionFromWorkspaceProjection(cachedWorkspaceProjection, input.regenerateCommand)
    : null;
}

/**
 * @param {{ userId: string, capability?: string | null, regenerateCommand: string }} input
 * @param {string} cacheScope
 * @param {string} stateRevision
 * @returns {Promise<ReturnType<typeof buildWorkspaceProjection>> | null}
 */
function resolveWorkspaceProjectionBuildFallback(input, cacheScope, stateRevision) {
  if (cacheScope !== "motions") {
    return null;
  }

  const workspaceKey = buildWorkspaceProjectionCacheKey(input, "workspace", stateRevision);
  const cachedWorkspaceBuild = cachedWorkspaceProjectionBuilds.get(workspaceKey);
  if (!cachedWorkspaceBuild) {
    return null;
  }

  return cachedWorkspaceBuild.then((workspaceProjection) => {
    const derivedProjection = deriveMotionsProjectionFromWorkspaceProjection(
      workspaceProjection,
      input.regenerateCommand,
    );
    if (!derivedProjection) {
      throw new Error("Cached workspace projection could not satisfy motions scope.");
    }
    return derivedProjection;
  });
}

/**
 * @param {ReturnType<typeof buildWorkspaceProjection>} workspaceProjection
 * @param {string} regenerateCommand
 * @returns {ReturnType<typeof buildWorkspaceProjection> | null}
 */
function deriveMotionsProjectionFromWorkspaceProjection(workspaceProjection, regenerateCommand) {
  const data = workspaceProjection?.data ?? null;
  if (!data || !Array.isArray(data.motionSummaries) || !Array.isArray(data.motionDetails)) {
    return null;
  }

  return {
    html: "",
    data: {
      generatedAt: data.generatedAt,
      user: data.user,
      regenerateCommand: data.regenerateCommand ?? regenerateCommand,
      motionSummaries: data.motionSummaries,
      motionDetails: data.motionDetails,
      reviewItems: data.reviewItems ?? [],
      agentStatus: data.agentStatus ?? null,
    },
  };
}

/**
 * @param {string} pathname
 * @returns {{ buildProjection: typeof buildWorkspaceProjection, cacheScope: string } | undefined}
 */
function resolveRouteProjectionOptions(pathname) {
  if (isMotionRoute(pathname)) {
    return {
      buildProjection: buildMotionRoutesProjection,
      cacheScope: "motions",
    };
  }
  if (pathname === "/queue") {
    return {
      buildProjection: buildQueueRoutesProjection,
      cacheScope: "queue",
    };
  }
  return undefined;
}

/**
 * @param {string | null} userId
 * @param {{ stateRevision?: string }} [options]
 */
function resolveAgentRuntimeSnapshotForUi(userId = null, options = {}) {
  const cacheKey = [
    options.stateRevision ?? currentStateRev(),
    userId ?? "all",
    options.lightweight ? "light" : "full",
  ].join("|");
  const cached = cachedAgentRuntimeSnapshots.get(cacheKey);
  if (cached) {
    return cached;
  }

  const snapshot = options.lightweight
    ? buildLightweightAgentRuntimeSnapshot(userId)
    : buildAgentRuntimeSnapshot(userId);
  cachedAgentRuntimeSnapshots.set(cacheKey, snapshot);
  trimBoundedCache(cachedAgentRuntimeSnapshots, MAX_CACHED_AGENT_RUNTIME_SNAPSHOTS);
  return snapshot;
}

/**
 * @param {Map<string, unknown>} cache
 * @param {number} maxSize
 */
function trimBoundedCache(cache, maxSize) {
  while (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    cache.delete(oldestKey);
  }
}

/**
 * @param {string} pathname
 * @returns {boolean}
 */
function isMotionRoute(pathname) {
  return pathname === "/motions" || pathname.startsWith("/motions/");
}

/**
 * Full queue synthesis is only needed on queue-centric surfaces. Record/detail
 * pages only need scheduler + lock state for the top-right agent pill.
 *
 * @param {string} pathname
 */
function usesFullAgentRuntime(_pathname) {
  return false;
}

/**
 * @param {string | null} userId
 * @param {any} agentQueue
 */
function buildQueueRouteAgentRuntime(userId, agentQueue) {
  const runtime = resolveAgentRuntimeSnapshotForUi(userId, { lightweight: true });
  const tasks = Array.isArray(agentQueue?.tasks) ? agentQueue.tasks : [];
  const sendTasks = tasks.filter((task) => task?.kind === "send_message");
  const verificationSendCount = sendTasks.filter((task) => requiresSendVerification(task)).length;
  return {
    ...runtime,
    queueCount: Number.isFinite(agentQueue?.count)
      ? Number(agentQueue.count)
      : Number(agentQueue?.itemCount ?? tasks.length),
    sendQueueCount: sendTasks.length,
    verificationSendCount,
    operatorSendCount: sendTasks.length - verificationSendCount,
    waitingCount: Number.isFinite(agentQueue?.waitingCount)
      ? Number(agentQueue.waitingCount)
      : Array.isArray(agentQueue?.waiting) ? agentQueue.waiting.length : 0,
    blockerCount: Array.isArray(agentQueue?.blockers) ? agentQueue.blockers.length : 0,
  };
}

/**
 * @param {{
 *   userId: string | null,
 *   capability?: string | null,
 *   generatedAt?: string | null,
 *   reviewItems?: any[] | null,
 *   listInboundObservationsFn?: typeof listInboundObservations,
 *   listMotionsFn?: typeof listMotions,
 *   listCompaniesFn?: typeof listCompanies,
 * }} input
 */
function resolveCleanupNavState(input) {
  if (Array.isArray(input.reviewItems)) {
    return { showCleanup: countCleanupLaneItems(input.reviewItems, input.generatedAt) > 0 };
  }

  if (!input.userId) {
    return { showCleanup: true };
  }

  const rawUser = listUsers().find((candidate) => candidate.id === input.userId) ?? null;
  if (!rawUser) {
    return { showCleanup: true };
  }

  const listInboundObservationsFn = input.listInboundObservationsFn ?? listInboundObservations;
  const listMotionsFn = input.listMotionsFn ?? listMotions;
  const listCompaniesFn = input.listCompaniesFn ?? listCompanies;
  const workspaceContext = buildUserWorkspaceContext(rawUser, {
    rawObservations: listInboundObservationsFn({ userId: rawUser.id }),
  });
  const review = buildInboundReviewView(
    workspaceContext.user,
    workspaceContext.observations,
    listMotionsFn(),
    listCompaniesFn(),
    { capability: input.capability ?? null },
  );

  return { showCleanup: countCleanupLaneItems(review.reviewItems, input.generatedAt) > 0 };
}

/**
 * @param {any[] | null | undefined} reviewItems
 * @param {string | null | undefined} generatedAt
 */
function countCleanupLaneItems(reviewItems, generatedAt) {
  const now = generatedAt ? new Date(generatedAt) : new Date();
  return filterCleanupLaneItems(reviewItems ?? [], { now }).length;
}

export function resetWorkspaceProjectionCacheForTests() {
  clearWorkspaceProjectionCache();
}

function buildUiRuntimeAccountDiscovery() {
  return {
    runtime: "codex",
    codexHome: process.env.CODEX_HOME ?? null,
    claudeCli: process.env.EXO_CLAUDE_CLI ?? null,
  };
}

/**
 * @param {string | null} motionId
 * @param {string | null} companyId
 * @param {string} prospectId
 * @returns {any[]}
 */
/**
 * Build a profile-URL → { degree, prospectId } map from every prospect that has
 * a captured connection degree, so the Connections surface can reconcile its
 * itemized people against the authoritative connection state.
 * @returns {Map<string, { degree: number, prospectId: string }>}
 */
function buildDegreeByProfile() {
  const map = new Map();
  const normalize = (url) =>
    !url
      ? null
      : String(url).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  for (const motion of listMotions()) {
    for (const account of motion.targetMap?.accounts ?? []) {
      for (const prospect of account.prospects ?? []) {
        const degree = prospect.linkedinProfileSnapshot?.connectionDegree ?? null;
        const url = normalize(prospect.linkedinProfileUrl ?? prospect.linkedinProfileSnapshot?.profileUrl ?? null);
        if (degree != null && url) {
          map.set(url, { degree, prospectId: prospect.id });
        }
      }
    }
  }
  return map;
}

/**
 * Build a profile-URL → exact-send-time map from every prospect we sent a
 * connection request to from this platform. The send moment is recorded as an
 * outbound `connection_request` touch, so its occurredAt is authoritative and
 * precise — the Sent tab prefers it over LinkedIn's rounded "Sent X ago" label.
 * Keeps the earliest such touch when more than one exists.
 * @returns {Map<string, string>}
 */
function buildSentAtByProfile() {
  const map = new Map();
  const normalize = (url) =>
    !url
      ? null
      : String(url).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  for (const motion of listMotions()) {
    for (const account of motion.targetMap?.accounts ?? []) {
      for (const prospect of account.prospects ?? []) {
        const url = normalize(prospect.linkedinProfileUrl ?? prospect.linkedinProfileSnapshot?.profileUrl ?? null);
        if (!url) continue;
        const sentTouch = (prospect.touches ?? [])
          .filter((touch) => touch.surface === "connection_request" && touch.direction === "outbound" && touch.occurredAt)
          .map((touch) => touch.occurredAt)
          .sort()
          .at(0);
        if (sentTouch) {
          const existing = map.get(url);
          map.set(url, existing && existing <= sentTouch ? existing : sentTouch);
        }
      }
    }
  }
  return map;
}

/**
 * Prospect detail needs the live queued work for this exact branch so the
 * renderer can show pre-connect warmup and queued approvals alongside stored
 * drafts, touches, and notes.
 *
 * @param {any} agentQueue
 * @param {{ id?: string | null, motionId?: string | null, companyId?: string | null }} person
 */
function collectProspectAgentQueueItems(agentQueue, person) {
  const prospectId = typeof person?.id === "string" ? person.id : null;
  if (!prospectId) return [];

  return [...(agentQueue?.tasks ?? []), ...(agentQueue?.waiting ?? [])]
    .filter((task) => task?.prospectId === prospectId)
    .filter((task) => !person?.motionId || !task?.motionId || task.motionId === person.motionId)
    .filter((task) => !person?.companyId || !task?.companyId || task.companyId === person.companyId);
}

/**
 * The engagement timeline needs the time the prospect branch became real
 * governed work. Raw `observedAt` drifts forward during later enrichment and
 * can end up newer than already-drafted steps, which makes the timeline read
 * backward.
 *
 * @param {any} record
 * @returns {string | null}
 */
function resolveProspectSurfacedAt(record) {
  return record?.queueState?.selectedAt
    ?? record?.packetState?.completedAt
    ?? record?.queueState?.updatedAt
    ?? record?.observedAt
    ?? record?.profileViewedAt
    ?? null;
}

/**
 * A cheap monotonic revision of the live operator surface. It must include
 * agent-runtime artifacts because background passes can start, block, and
 * finish without touching SQLite.
 *
 * @returns {string}
 */
function currentStateRev() {
  return buildUiStateRevision();
}

/**
 * @param {{
 *   localDatabasePath?: string | null,
 *   homeDatabasePath?: string | null,
 *   repoPolicyPath?: string | null,
 *   homePolicyPath?: string | null,
 *   homeStateDir?: string | null,
 * }} [statePaths]
 * @returns {string}
 */
export function buildUiStateRevision(statePaths = resolveStatePaths()) {
  const homeStateDir = statePaths.homeStateDir ?? null;
  const agentRunLockPidPaths = homeStateDir
    ? [
        { label: "agent-run-lock", path: path.join(buildAgentRunLockDir({ stateDir: homeStateDir }), "pid") },
        ...AGENT_EXECUTION_LANES.map((lane) => ({
          label: `agent-run-lock-${lane}`,
          path: path.join(buildAgentRunLockDir({ stateDir: homeStateDir, lane }), "pid"),
        })),
      ]
    : [];
  const parts = [
    ...buildDatabaseFamilyRevisions(statePaths.localDatabasePath ?? null, "local-db"),
    ...buildDatabaseFamilyRevisions(statePaths.homeDatabasePath ?? null, "home-db"),
    buildFileRevision(statePaths.repoPolicyPath ?? null, "repo-policy"),
    buildFileRevision(statePaths.homePolicyPath ?? null, "home-policy"),
    buildFileRevision(homeStateDir ? path.join(homeStateDir, "agent-preflight.json") : null, "agent-preflight"),
    buildFileRevision(homeStateDir ? path.join(homeStateDir, "agent-host-state.json") : null, "agent-host-state"),
    buildFileRevision(homeStateDir ? path.join(homeStateDir, "agent-last-pass.json") : null, "agent-last-pass"),
    ...agentRunLockPidPaths.map((lock) => buildFileRevision(lock.path, lock.label)),
  ].filter(Boolean);
  return parts.length ? parts.join("|") : "0";
}

/**
 * SQLite state changes often land in the WAL before the base database file is
 * checkpointed, so the UI revision has to watch the whole database family.
 *
 * @param {string | null} databasePath
 * @param {string} label
 * @returns {string[]}
 */
function buildDatabaseFamilyRevisions(databasePath, label) {
  if (!databasePath) return [];
  return [
    buildFileRevision(databasePath, label),
    buildFileRevision(`${databasePath}-wal`, `${label}-wal`),
    buildFileRevision(`${databasePath}-shm`, `${label}-shm`),
  ].filter(Boolean);
}

/**
 * Human label for the LinkedIn identity the execution resolution actually
 * landed on: "user-label (handle)" when both are known. Returns null when the
 * resolution produced no identity, so callers can fall back or say so.
 *
 * @param {any} execution result of resolveScopedExecutionAssignment
 * @returns {string | null}
 */
function describeResolvedLinkedinIdentity(execution) {
  if (!execution) return null;
  const userLabel = typeof execution.assignedUser?.label === "string" && execution.assignedUser.label.trim()
    ? execution.assignedUser.label.trim()
    : null;
  const handle = typeof execution.resolvedAccount?.handle === "string" && execution.resolvedAccount.handle.trim()
    ? execution.resolvedAccount.handle.trim()
    : null;
  if (userLabel && handle && handle.toLowerCase() !== userLabel.toLowerCase()) {
    return `${userLabel} (${handle})`;
  }
  if (userLabel) return userLabel;
  if (handle) return handle;
  const profileLabel = typeof execution.assignedProfile?.label === "string" && execution.assignedProfile.label.trim()
    ? execution.assignedProfile.label.trim()
    : null;
  return profileLabel;
}

/**
 * Reads the agent runtime state shared by both the full and lightweight
 * snapshots: pruned host state, run locks, scheduler/routine state, the last
 * pass, and the derived cadence summary. Queue-derived counts are layered on by
 * the caller.
 */
function readAgentRuntimeBase() {
  const stateDir = resolveStatePaths().homeStateDir;
  const checkedAt = new Date().toISOString();
  const hostState = pruneInactiveTaskLeases(readJsonIfExists(path.join(stateDir, "agent-host-state.json")), {
    stateDir,
    now: checkedAt,
  });
  const { lock, laneLocks } = inspectAgentRuntimeLocks(stateDir);
  const scheduler = inspectAgentSchedulerState(stateDir);
  const routine = inspectAgentRoutineState(stateDir);
  const lastPass = readJsonIfExists(path.join(stateDir, "agent-last-pass.json"));
  return {
    checkedAt,
    lock,
    laneLocks,
    scheduler,
    routine,
    hostState,
    lastPass,
    cadence: buildSchedulerCadenceSummary(scheduler, lastPass, checkedAt),
  };
}

const ZERO_AGENT_RUNTIME_COUNTS = {
  queueCount: 0,
  sendQueueCount: 0,
  verificationSendCount: 0,
  operatorSendCount: 0,
  waitingCount: 0,
  blockerCount: 0,
};

function buildAgentRuntimeSnapshot(userId = null) {
  const base = readAgentRuntimeBase();
  const motions = listMotions();
  const companies = listCompanies();
  const users = userId ? listUsers().filter((user) => user.id === userId) : listUsers();
  const observations = listInboundObservations(userId ? { userId } : {});
  const cues = listInboundCues(userId ? { userId } : {});
  const queue = buildAgentQueue({
    motions,
    companies,
    users,
    observations,
    cues,
    prospectBranches: listAgentQueueProspectBranches(userId ? { executionUserId: userId } : {}),
    hostState: base.hostState,
  });
  const sendTasks = Array.isArray(queue?.tasks) ? queue.tasks.filter((task) => task?.kind === "send_message") : [];
  const verificationSendCount = sendTasks.filter((task) => requiresSendVerification(task)).length;
  const operatorSendCount = sendTasks.length - verificationSendCount;
  return {
    ...base,
    queueCount: Number.isFinite(queue?.count) ? Number(queue.count) : Number(queue?.itemCount ?? 0),
    sendQueueCount: sendTasks.length,
    verificationSendCount,
    operatorSendCount,
    waitingCount: Number.isFinite(queue?.waitingCount) ? Number(queue.waitingCount) : 0,
    blockerCount: Array.isArray(queue?.blockers) ? queue.blockers.length : 0,
  };
}

/**
 * Most surfaces only need scheduler + lock state for the header pill. The
 * queue page gets its counts from the queue-only projection instead of
 * rebuilding the queue through this helper.
 *
 * @param {string | null} _userId
 */
function buildLightweightAgentRuntimeSnapshot(_userId = null) {
  return { ...readAgentRuntimeBase(), ...ZERO_AGENT_RUNTIME_COUNTS };
}

/**
 * @param {string} stateDir
 */
function inspectAgentRuntimeLocks(stateDir) {
  const sharedLock = inspectAgentRunLock({ stateDir });
  const laneLocks = AGENT_EXECUTION_LANES.map((lane) => ({
    lane,
    ...inspectAgentRunLock({ stateDir, lane }),
  }));
  if (sharedLock.active) {
    return { lock: sharedLock, laneLocks };
  }

  const activeLaneLocks = laneLocks.filter((lock) => lock.active);
  if (!activeLaneLocks.length) {
    return { lock: sharedLock, laneLocks };
  }

  return {
    lock: {
      exists: true,
      active: true,
      stale: false,
      lockDir: activeLaneLocks.map((lock) => lock.lockDir).join(","),
      pidPath: activeLaneLocks.map((lock) => lock.pidPath).join(","),
      pid: activeLaneLocks.length === 1 ? activeLaneLocks[0].pid : null,
      lanes: activeLaneLocks.map((lock) => ({ lane: lock.lane, pid: lock.pid })),
    },
    laneLocks,
  };
}

/**
 * @param {string | null} preferredUserId
 */
function resolveUiRouteSession(preferredUserId = null) {
  const users = listUsers();
  const { totalUserCount, eligibleUserCount, eligibleUsers } = summarizeExecutionUsers(users);
  const preferredUser = preferredUserId
    ? users.find((user) => user.id === preferredUserId) ?? null
    : null;

  if (preferredUserId) {
    if (preferredUser && Array.isArray(preferredUser.accounts) && preferredUser.accounts.length > 0) {
      return { mode: "workspace", userId: preferredUser.id, preferredUserId: preferredUser.id };
    }
    if (eligibleUserCount === 1) {
      return {
        mode: "workspace",
        userId: eligibleUsers[0].id,
        preferredUserId: eligibleUsers[0].id,
      };
    }
    if (preferredUser) {
      return { mode: "onboarding", userId: null, preferredUserId: preferredUser.id };
    }
  }

  if (eligibleUserCount === 1) {
    return {
      mode: "workspace",
      userId: eligibleUsers[0].id,
      preferredUserId: eligibleUsers[0].id,
    };
  }
  return {
    mode: "onboarding",
    userId: null,
    preferredUserId: totalUserCount === 1 ? users[0].id : null,
  };
}

/**
 * @param {http.Server} server
 * @param {string} host
 * @param {number} requestedPort
 * @param {boolean} allowPortFallback
 */
async function listenWithPortFallback(server, host, requestedPort, allowPortFallback) {
  const candidatePorts = allowPortFallback
    ? [
        requestedPort,
        ...Array.from({ length: 20 }, (_, index) => requestedPort + index + 1),
        0,
      ]
    : [requestedPort];
  let lastError = null;

  for (const candidatePort of candidatePorts) {
    try {
      await listenOnce(server, host, candidatePort);
      return;
    } catch (error) {
      lastError = error;
      if (!allowPortFallback || !isAddressInUseError(error)) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error(`Unable to bind Exo UI to ${host}:${requestedPort}.`);
}

/**
 * @param {http.Server} server
 * @param {string} host
 * @param {number} port
 */
function listenOnce(server, host, port) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

/**
 * @param {unknown} error
 */
function isAddressInUseError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE");
}

/**
 * @param {string | null} filePath
 * @param {string} [label]
 */
function buildFileRevision(filePath, label) {
  if (!filePath) return null;
  try {
    const stat = statSync(filePath);
    return `${label ?? path.basename(filePath)}:${Math.round(stat.mtimeMs)}-${stat.size}`;
  } catch {
    return null;
  }
}

/**
 * @param {string} filePath
 */
function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {Array<any>} motions
 * @param {any | null | undefined} transition
 * @returns {Array<{ id: string, name: string, offerLabel: string, premise: string, status: string | null, statusLabel: string | null }>}
 */
function buildClaimMotionChoices(motions, transition) {
  const choices = [];
  if (transition) {
    choices.push(shapeClaimMotionChoice(transition));
  }
  for (const motion of motions ?? []) {
    if (!motion || motion.id === transition?.id) {
      continue;
    }
    choices.push(shapeClaimMotionChoice(motion));
  }
  return choices;
}

/**
 * @param {Array<any>} motionSummaries
 * @param {Array<any>} rawMotions
 * @returns {Array<{ id: string, name: string, offerLabel: string, offerHost: string | null, icpSummary: string | null }>}
 */
function buildOperatorMotionChoices(motionSummaries, rawMotions) {
  const rawById = new Map((rawMotions ?? [])
    .filter((motion) => motion && typeof motion.id === "string")
    .map((motion) => [motion.id, motion]));
  const summaries = Array.isArray(motionSummaries) && motionSummaries.length > 0
    ? motionSummaries
    : (rawMotions ?? []);

  return summaries
    .filter((motion) => motion?.status === "active" && typeof motion?.id === "string" && typeof motion?.name === "string")
    .map((summary) => {
      const raw = rawById.get(summary.id) ?? summary;
      const name = normalizeClaimText(summary?.name) ?? normalizeClaimText(raw?.name) ?? "untitled-motion";
      return {
        id: String(summary.id),
        name,
        offerLabel: claimMotionOfferLabel(raw, name),
        offerHost: claimMotionOfferHost(raw?.offer?.sourceUrl ?? raw?.offerThesis?.sourceUrl ?? null),
        icpSummary: buildOperatorMotionIcpSummary(raw),
      };
    });
}

/**
 * @param {any} motion
 * @returns {{ id: string, name: string, offerLabel: string, premise: string, status: string | null, statusLabel: string | null }}
 */
function shapeClaimMotionChoice(motion) {
  const name = normalizeClaimText(motion?.name) ?? "untitled-motion";
  const status = normalizeClaimMotionStatus(motion?.status);
  return {
    id: String(motion?.id ?? ""),
    name,
    offerLabel: claimMotionOfferLabel(motion, name),
    premise: normalizeClaimText(motion?.premise?.statement) ?? "No premise authored yet.",
    status,
    statusLabel: formatClaimMotionStatus(status),
  };
}

/**
 * @param {any} motion
 * @returns {string | null}
 */
function buildOperatorMotionIcpSummary(motion) {
  const audienceLabels = Array.isArray(motion?.audienceHypotheses)
    ? motion.audienceHypotheses
      .map((audience) => typeof audience === "string"
        ? normalizeClaimText(audience)
        : normalizeClaimText(audience?.name))
      .filter(Boolean)
    : [];
  const icpTypes = Array.isArray(motion?.targetingProfile?.icpTypes)
    ? motion.targetingProfile.icpTypes
      .map((value) => normalizeClaimText(value))
      .filter(Boolean)
    : [];
  const labels = [];
  for (const label of [...audienceLabels, ...icpTypes]) {
    if (!label || labels.includes(label)) {
      continue;
    }
    labels.push(label);
    if (labels.length >= 2) {
      break;
    }
  }
  if (labels.length === 0) {
    return null;
  }
  const compactLabels = labels
    .map((label) => compactOperatorMotionText(label, 56) ?? label)
    .filter(Boolean);
  return compactOperatorMotionText(compactLabels.join(" · "), 88);
}

/**
 * @param {any} motion
 * @param {string} fallback
 * @returns {string}
 */
function claimMotionOfferLabel(motion, fallback) {
  if (isTransitionMotion(motion)) {
    return "Transition backlog";
  }
  const host = claimMotionOfferHost(motion?.offer?.sourceUrl ?? motion?.offerThesis?.sourceUrl ?? null);
  const sourceTitle = compactOperatorMotionOfferTitle(motion?.offerThesis?.sourceTitle, host);
  if (sourceTitle) {
    return sourceTitle;
  }
  return host ?? fallback;
}

/**
 * @param {unknown} value
 * @param {string | null | undefined} host
 * @returns {string | null}
 */
function compactOperatorMotionOfferTitle(value, host) {
  const title = normalizeClaimText(value);
  if (!title) {
    return null;
  }
  const segments = title
    .split(/\s(?:\||•|·|—|-)\s/g)
    .map((segment) => normalizeClaimText(segment))
    .filter(Boolean);
  if (segments.length > 1) {
    const lead = segments[0] ?? null;
    const tail = segments.at(-1) ?? null;
    if (lead && tail) {
      if (normalizeOperatorMotionCompare(lead) === normalizeOperatorMotionCompare(tail)) {
        return compactOperatorMotionText(lead, 72);
      }
      if (host && operatorMotionTitleMatchesHost(tail, host)) {
        return compactOperatorMotionText(lead, 72);
      }
    }
  }
  return compactOperatorMotionText(title, 72);
}

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {string | null}
 */
function compactOperatorMotionText(value, max) {
  const text = normalizeClaimText(value)?.replace(/[.,;:!?]+$/g, "");
  if (!text) {
    return null;
  }
  if (text.length <= max) {
    return text;
  }
  const clipped = text.slice(0, Math.max(1, max - 1)).replace(/\s+[^\s]*$/, "").trim();
  return `${clipped || text.slice(0, Math.max(1, max - 1)).trim()}…`;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function claimMotionOfferHost(value) {
  const text = normalizeClaimText(value);
  if (!text) {
    return null;
  }
  if (/^data:/i.test(text)) {
    return "Captured offer page";
  }
  try {
    return new URL(text).hostname.replace(/^www\./i, "") || text;
  } catch {
    return text;
  }
}

/**
 * @param {unknown} value
 * @returns {"draft" | "active" | "paused" | "archived" | null}
 */
function normalizeClaimMotionStatus(value) {
  return value === "draft" || value === "active" || value === "paused" || value === "archived"
    ? value
    : null;
}

/**
 * @param {"draft" | "active" | "paused" | "archived" | null} status
 * @returns {string | null}
 */
function formatClaimMotionStatus(status) {
  if (!status) {
    return null;
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeClaimText(value) {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text : null;
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeOperatorMotionCompare(text) {
  return text.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[^a-z0-9]+/g, "");
}

/**
 * @param {string} title
 * @param {string} host
 * @returns {boolean}
 */
function operatorMotionTitleMatchesHost(title, host) {
  const normalizedTitle = normalizeOperatorMotionCompare(title);
  const hostRoot = normalizeOperatorMotionCompare(host.split(".")[0] ?? host);
  return Boolean(
    normalizedTitle
    && hostRoot
    && (normalizedTitle === hostRoot || normalizedTitle.includes(hostRoot) || hostRoot.includes(normalizedTitle)),
  );
}

/**
 * @param {{ userId?: string | null, preferredUserId?: string | null }} session
 * @param {{ id?: string | null } | null | undefined} projectedUser
 */
function resolveCurrentUiUser(session, projectedUser) {
  const userId = session.userId ?? session.preferredUserId ?? projectedUser?.id ?? null;
  return userId ? findUserById(userId) : null;
}

/**
 * @param {any} rawUser
 * @param {any} projectedUser
 */
function buildUiCurrentUserMeta(rawUser, projectedUser) {
  const gmailOptions = buildUiScopedGmailOptions(rawUser);
  return {
    ...(projectedUser ?? {}),
    id: rawUser?.id ?? projectedUser?.id ?? null,
    label: rawUser?.label ?? projectedUser?.label ?? null,
    gmailOptions,
  };
}

/**
 * @param {any} rawUser
 */
function buildUiScopedGmailOptions(rawUser) {
  if (!rawUser || !Array.isArray(rawUser.accounts)) {
    return [];
  }

  const connectorByHarnessId = new Map(
    Array.isArray(rawUser.harnessConnections)
      ? rawUser.harnessConnections.map((connection) => [connection.id, connection.connector ?? null])
      : [],
  );
  const seenRefs = new Set();
  const options = [];

  for (const account of rawUser.accounts) {
    if (account?.capability !== "gmail" || typeof account.handle !== "string" || !account.handle.trim()) {
      continue;
    }

    const ref = `gmail:${account.handle.trim()}`;
    if (seenRefs.has(ref)) {
      continue;
    }

    seenRefs.add(ref);
    const connector = account.harnessConnectionId
      ? connectorByHarnessId.get(account.harnessConnectionId) ?? null
      : null;
    options.push({
      ref,
      handle: account.handle.trim(),
      label: connector && connector !== "gmail"
        ? `${account.handle.trim()} (${connector})`
        : account.handle.trim(),
    });
  }

  return options;
}

function lookupProspectDrafts(motionId, companyId, prospectId) {
  return lookupProspectRecord(motionId, companyId, prospectId)?.drafts ?? [];
}

/**
 * Load the stored prospect record (drafts + touches + provenance) which the
 * projection does not carry, so the detail page can render the real
 * engagement timeline and compose state.
 *
 * @param {string | null} motionId
 * @param {string | null} companyId
 * @param {string} prospectId
 * @returns {any}
 */
function lookupProspectRecord(motionId, companyId, prospectId) {
  if (!motionId) return null;
  const motion = findMotionById(motionId);
  const account = motion?.targetMap?.accounts?.find((a) => a.companyId === companyId) ?? null;
  return account?.prospects?.find((p) => p.id === prospectId) ?? null;
}

/**
 * @param {string} kind
 * @param {string} id
 * @param {string} backHref
 * @param {string} backLabel
 */
function renderNotFound(kind, id, backHref, backLabel) {
  const agentRuntime = buildAgentRuntimeSnapshot();
  const body =
    `<div class="dom-wrap">` +
    `<div class="op-intro"><div><h1>${escapeHtml(kind)} not found</h1>` +
    `<p class="op-line">No ${escapeHtml(kind.toLowerCase())} matches <code>${escapeHtml(id)}</code>.</p></div></div>` +
    `<a class="btn btn-secondary btn-sm" href="${escapeHtml(backHref)}">← Back to ${escapeHtml(backLabel)}</a>` +
    `</div>`;
  const activeId =
    { Users: "execution", Prospects: "prospects", Motions: "motions", Connections: "connections" }[backLabel] ?? "operator";
  return renderShell({
    title: `Exo — ${kind} not found`,
    activeId,
    sectionLabel: backLabel,
    detailLabel: "Not found",
    body,
    interactive: true,
    agentRuntime,
  });
}

/** @param {http.IncomingMessage} request */
async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

/**
 * @param {http.ServerResponse} response
 * @param {string} html
 */
function respondHtml(response, html) {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(html);
}

/**
 * @param {http.ServerResponse} response
 * @param {string} location
 */
function respondRedirect(response, location) {
  response.writeHead(302, { location, "cache-control": "no-store" });
  response.end();
}

/**
 * @param {http.ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 */
function respondJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}
