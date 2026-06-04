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
import { renderConnectionsPage } from "../artifacts/render-connections.js";
import { renderExecutionPage, renderUserDetailPage } from "../artifacts/render-execution.js";
import { renderMotionsPage, renderMotionDetailPage, renderMotionSettingsPage } from "../artifacts/render-motions.js";
import { renderOperatorPage } from "../artifacts/render-operator.js";
import { renderQueuePage } from "../artifacts/render-queue.js";
import { renderPersonPage } from "../artifacts/render-person.js";
import { renderProspectsPage, renderProspectDetailPage } from "../artifacts/render-prospects.js";
import { renderCompanyDetailPage } from "../artifacts/render-company-detail.js";
import { renderCompanyResearchBriefPage } from "../artifacts/render-company-research-brief-page.js";
import { buildCompanyViewModel } from "../core/build-company-view.js";
import { buildCompanyResearchBrief } from "../core/build-company-research-brief.js";
import { buildMotionPacketSummary } from "../lib/motion-packets.js";
import { renderWorkspaceRollupPage } from "../artifacts/render-workspace-rollup.js";
import { buildConnectionsViewModel } from "../core/build-connections-view.js";
import { buildAgentQueue } from "../core/build-agent-queue.js";
import { buildPersonView } from "../core/build-person-view.js";
import { findTransitionMotion } from "../core/ensure-transition-motion.js";
import { buildExecutionViewModel } from "../core/build-execution-view.js";
import { buildMotionsViewModel } from "../core/build-motions-view.js";
import { buildOperatorViewModel } from "../core/build-operator-view.js";
import { buildProspectsViewModel } from "../core/build-prospects-view.js";
import { buildWorkspaceRollup } from "../core/build-workspace-rollup.js";
import { executeActionIntent } from "../core/execute-action-intent.js";
import { removeUiLock, writeUiLock } from "./ui-lock.js";
import { escapeHtml, renderShell } from "../lib/exo-ui-components.js";
import { findCompanyById, findMotionById, listBrowserProfiles, listCompanies, listInboundCues, listInboundObservations, listMotions, listUsers } from "../db/database.js";
import { accountRefsCanAttachConnectionNote } from "../schema/browser-profile.js";
import { buildWorkspaceProjection } from "./workspace-runtime.js";
import { inspectAgentRoutineState, inspectAgentSchedulerState } from "./commands/agent.js";
import { buildAgentRunLockDir, inspectAgentRunLock } from "../lib/agent-run-lock.js";
import { pruneExpiredBrowserBackoffs } from "../lib/agent-host-state.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;

/**
 * @param {{ userId: string, capability?: string | null, host?: string | null, port?: number | null }} input
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
      if (request.method === "GET" && (url.pathname === "/status" || url.pathname === "/healthz")) {
        respondJson(response, 200, {
          ok: true,
          service: "exo-ui",
          userId: input.userId,
          startedAt: startedAt,
          routes: ["/operator", "/motions", "/prospects", "/users", "/connections", "/workspace", "/queue"],
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
        respondJson(response, 200, result);
        return;
      }

      if (request.method === "GET") {
        const route = url.pathname === "/" ? "/operator" : url.pathname;
        const html = renderRoute(route, { userId: input.userId, capability });
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
  writeUiLock({ host, port, url, userId: input.userId });
  const cleanup = () => removeUiLock();
  server.once("close", cleanup);
  process.once("exit", cleanup);
  process.once("SIGINT", () => { cleanup(); process.exit(0); });
  process.once("SIGTERM", () => { cleanup(); process.exit(0); });

  return { server, host, port, url };
}

/**
 * @param {string} route
 * @param {{ userId: string, capability: string }} ctx
 * @returns {string | null}
 */
function renderRoute(route, ctx) {
  const agentRuntime = buildAgentRuntimeSnapshot(ctx.userId);
  const meta = (regenerateCommand) => ({
    user: { label: undefined },
    generatedAt: new Date().toISOString(),
    regenerateCommand,
    interactive: true,
    agentRuntime,
  });

  // Users roster + per-user detail are sourced from raw state (all users).
  if (route === "/users" || route.startsWith("/users/")) {
    const model = buildExecutionViewModel({
      rawUsers: listUsers(),
      rawMotions: listMotions(),
      rawCompanies: listCompanies(),
      rawProfiles: listBrowserProfiles(),
      runtimeAccountDiscovery: {
        runtime: "codex",
        codexHome: process.env.CODEX_HOME ?? null,
        claudeCli: process.env.EXO_CLAUDE_CLI ?? null,
      },
    });
    if (route === "/users") {
      return renderExecutionPage(model, meta("exo ui"));
    }
    const id = decodeURIComponent(route.slice("/users/".length));
    const user = model.users.find((candidate) => candidate.id === id);
    if (!user) {
      return renderNotFound("User", id, "/users", "Users");
    }
    return renderUserDetailPage(user, meta("exo ui"));
  }

  // Internal person show page (works for any inbound person, not just prospects).
  if (route.startsWith("/people/")) {
    const id = decodeURIComponent(route.slice("/people/".length));
    const person = buildPersonView({
      observationId: id,
      rawObservations: listInboundObservations({ userId: ctx.userId }),
      rawMotions: listMotions(),
      rawCompanies: listCompanies(),
    });
    if (!person) {
      return renderNotFound("Person", id, "/connections", "Connections");
    }
    const transition = findTransitionMotion();
    return renderPersonPage(person, {
      interactive: true,
      userId: ctx.userId,
      transitionMotionId: transition?.id ?? null,
      // Transition backlog first (the default add target), then real motions.
      motions: [
        ...(transition ? [{ id: transition.id, name: transition.name }] : []),
        ...listMotions()
          .filter((motion) => motion.id !== transition?.id)
          .map((motion) => ({ id: motion.id, name: motion.name })),
      ],
    });
  }

  const projection = buildWorkspaceProjection({
    userId: ctx.userId,
    capability: ctx.capability,
    regenerateCommand: "exo ui",
  });
  const data = projection.data;
  const baseMeta = { user: data.user, generatedAt: data.generatedAt, regenerateCommand: "exo ui", interactive: true, agentRuntime };

  // Motion settings page.
  if (route.startsWith("/motions/") && route.endsWith("/settings")) {
    const segments = route.split("/").filter(Boolean);
    const id = decodeURIComponent(segments[1] ?? "");
    const model = buildMotionsViewModel({ motionSummaries: data.motionSummaries, motionDetails: data.motionDetails });
    const motion = model.details.find((candidate) => candidate.id === id);
    if (!motion) {
      return renderNotFound("Motion", id, "/motions", "Motions");
    }
    return renderMotionSettingsPage(motion, baseMeta);
  }

  // Per-motion detail page.
  if (route.startsWith("/motions/")) {
    const segments = route.split("/").filter(Boolean);
    const id = decodeURIComponent(segments[1] ?? "");
    const model = buildMotionsViewModel({ motionSummaries: data.motionSummaries, motionDetails: data.motionDetails });
    const motion = model.details.find((candidate) => candidate.id === id);
    if (!motion) {
      return renderNotFound("Motion", id, "/motions", "Motions");
    }
    return renderMotionDetailPage(motion, baseMeta);
  }

  // Per-prospect detail page.
  if (route.startsWith("/prospects/")) {
    const id = decodeURIComponent(route.slice("/prospects/".length));
    const model = buildProspectsViewModel({
      prospectPrepLanes: data.prospectPrepLanes,
      engagementLanes: data.engagementLanes,
      motionDetails: data.motionDetails,
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
    person.firstSeenAt = record?.observedAt ?? record?.profileViewedAt ?? null;
    person.selectedAt = record?.queueState?.selectedAt ?? null;
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
    const detailMeta = {
      ...baseMeta,
      userId: ctx.userId,
      transitionMotionId: transition?.id ?? null,
      // Whether the sending identity can attach a note to a connection request
      // (Premium / Sales Navigator). null = no identity pinned yet.
      connectionNoteCapable: company?.engagementUserAssignment?.accountRefs
        ? accountRefsCanAttachConnectionNote(company.engagementUserAssignment.accountRefs)
        : null,
      assignedIdentity: company?.engagementUserAssignment?.label ?? null,
      motions: listMotions()
        .filter((motion) => motion.id !== transition?.id)
        .map((motion) => ({ id: motion.id, name: motion.name })),
      // Execution users for the "Assign owner" picker.
      users: listUsers().map((user) => ({ id: user.id, label: user.label })),
    };
    return renderProspectDetailPage(person, detailMeta);
  }

  // Motion-scoped company research brief page.
  if (route.startsWith("/companies/") && route.includes("/research-brief/")) {
    const segments = route.split("/").filter(Boolean);
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
      agentRuntime,
    });
  }

  // Per-company detail page (the canonical company record).
  if (route.startsWith("/companies/")) {
    const id = decodeURIComponent(route.slice("/companies/".length));
    const company = findCompanyById(id);
    if (!company) {
      return renderNotFound("Company", id, "/prospects", "Prospects");
    }
    const prospectsModel = buildProspectsViewModel({
      prospectPrepLanes: data.prospectPrepLanes,
      engagementLanes: data.engagementLanes,
      motionDetails: data.motionDetails,
    });
    const model = buildCompanyViewModel({
      company,
      prospects: prospectsModel.all,
      motions: listMotions(),
      users: listUsers(),
    });
    return renderCompanyDetailPage(model, baseMeta);
  }

  switch (route) {
    case "/operator": {
      const model = buildOperatorViewModel({
        user: data.user,
        generatedAt: data.generatedAt,
        regenerateCommand: "exo ui",
        operatorSummary: data.operatorSummary,
        decisionQueue: data.decisionQueue,
        agentQueue: data.agentQueue,
        blockedQueue: data.blockedQueue,
        truthAccounts: data.truthAccounts,
        agentRuntime,
      });
      return renderOperatorPage(model, baseMeta);
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
        truthAccounts: data.truthAccounts,
        agentRuntime,
      });
      return renderQueuePage(model, baseMeta);
    }
    case "/motions": {
      const model = buildMotionsViewModel({ motionSummaries: data.motionSummaries, motionDetails: data.motionDetails });
      return renderMotionsPage(model, baseMeta);
    }
    case "/prospects": {
      const model = buildProspectsViewModel({
        prospectPrepLanes: data.prospectPrepLanes,
        engagementLanes: data.engagementLanes,
        motionDetails: data.motionDetails,
      });
      return renderProspectsPage(model, baseMeta);
    }
    case "/connections": {
      const model = buildConnectionsViewModel({
        reviewItems: data.reviewItems,
        truthAccounts: data.truthAccounts,
        // Authoritative connection-degree by profile URL, so the Sent / Received
        // tabs reconcile against the real connection state (1st-degree = accepted).
        degreeByProfile: buildDegreeByProfile(),
        // Exact send time by profile URL, taken from our own outbound touches, so
        // the Sent tab shows true age instead of LinkedIn's rounded label.
        sentAtByProfile: buildSentAtByProfile(),
      });
      return renderConnectionsPage(model, { ...baseMeta, userId: ctx.userId });
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
        executionUsers: executionModel.users,
      });
      return renderWorkspaceRollupPage(model, baseMeta);
    }
    default:
      return null;
  }
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
  const agentRunLockPidPath = homeStateDir
    ? path.join(buildAgentRunLockDir({ stateDir: homeStateDir }), "pid")
    : null;
  const parts = [
    buildFileRevision(statePaths.localDatabasePath ?? null),
    buildFileRevision(statePaths.homeDatabasePath ?? null),
    buildFileRevision(statePaths.repoPolicyPath ?? null),
    buildFileRevision(statePaths.homePolicyPath ?? null),
    buildFileRevision(homeStateDir ? path.join(homeStateDir, "agent-preflight.json") : null),
    buildFileRevision(homeStateDir ? path.join(homeStateDir, "agent-host-state.json") : null),
    buildFileRevision(homeStateDir ? path.join(homeStateDir, "agent-last-pass.json") : null),
    buildFileRevision(agentRunLockPidPath),
  ].filter(Boolean);
  return parts.length ? parts.join("|") : "0";
}

function buildAgentRuntimeSnapshot(userId = null) {
  const stateDir = resolveStatePaths().homeStateDir;
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
  });
  return {
    lock: inspectAgentRunLock({ stateDir }),
    scheduler: inspectAgentSchedulerState(),
    routine: inspectAgentRoutineState(stateDir),
    hostState: pruneExpiredBrowserBackoffs(readJsonIfExists(path.join(stateDir, "agent-host-state.json"))),
    lastPass: readJsonIfExists(path.join(stateDir, "agent-last-pass.json")),
    queueCount: Number.isFinite(queue?.count) ? Number(queue.count) : Number(queue?.itemCount ?? 0),
    waitingCount: Number.isFinite(queue?.waitingCount) ? Number(queue.waitingCount) : 0,
    blockerCount: Array.isArray(queue?.blockers) ? queue.blockers.length : 0,
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
 * @param {string} filePath
 */
function buildFileRevision(filePath) {
  try {
    const stat = statSync(filePath);
    return `${path.basename(filePath)}:${Math.round(stat.mtimeMs)}-${stat.size}`;
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
 * @param {number} status
 * @param {unknown} payload
 */
function respondJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}
