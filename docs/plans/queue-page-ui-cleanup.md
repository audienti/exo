# Queue page UI cleanup — design

Status: implemented (2026-06-12). UI-only change; no data-layer or behavior changes.
Update during review: the view switcher is a segmented button group (shared
`segTabs()` component), and the motion settings tabs were converted to the same
control so the app has one tab-switch visual.

## Problem

The Agent queue page spends ~2/3 of the first viewport on status chrome before the
queue itself appears:

1. A large AGENT card ("Background agent on" + installed/loaded/running facts + next action).
2. An "Agent status" section rendered as a 2-row grid of panels (Current work,
   Backlog, Throughput, Partial, Inbound surfaces) — Current work is usually an
   empty placeholder, and Inbound surfaces truncates to 4 "interesting" rows with
   an "N more enabled surfaces" footnote.
3. The actual queue cards land below the fold.

The surface rows also omit the last sync time, even though the view model already
carries it.

## Target layout (top to bottom)

```
1  Intro row        h1 + runtime meta chips | queued/oldest/blocked stats | Run agent now
2  Agent bar        one-line <details> disclosure (collapsed by default)
3  Status strip     one row: CURRENT WORK | BACKLOG | THROUGHPUT (| PARTIAL when active)
4  Tabbed section   [ Agent queue (12) ] [ Inbound surfaces (8) ]
5  Footer           unchanged
```

The standalone "Agent status" section header goes away — the strip's micro-caps
labels carry it, and the state + "checked Xm ago" move into the agent bar summary.

### 2. Agent bar (replaces the big AGENT card on this page only)

- `<details class="agent-bar">` with a one-line `<summary>`:
  `AG avatar · headline ("Background agent on") · detail ("draining every 15m") · state dot + "Queued · checked just now" · chevron`.
- Expanded body: the existing `statusFacts` chips (Installed/Loaded/Running/Last pass)
  plus the `nextAction` line.
- Default collapsed. Render with the `open` attribute when `runtime.state === "off"`
  or agent-status state is `blocked`, so problems are never hidden.
- The Operator page keeps the full card — only the queue surface switches.

### 3. Status strip (replaces the ws-grid panels)

Single bordered row, 3 cells (4 when a partial pass is active). Each cell is a
`pulse-cap` label + one value line + one sub line:

- **Current work** — `Idle / No task checked out`, or first active task
  (`Lane: Kind · subject · 42s elapsed`) with `+N more`, or the active-lane-lock
  line when a pass holds the lock without a lease.
- **Backlog** — `12 due · 0 waiting · 0 blockers`, sub line = top due-by-kind
  groups (`7 Send Message · 5 Run Inbound Sync`); waiting/blocker reasons fold
  into the sub line only when nonzero.
- **Throughput** — `Last pass blocked · 1 result · 1s`, sub `24h: 1 result · 9 motion runs`.
- **Partial** — only when `status.partial.active`; reason + next action.

### 4. Tabs: Agent queue | Inbound surfaces

- Rendered as a segmented button group (`segTabs()` in `exo-ui-components.js`) —
  the same joined-pill visual the Prospects page uses — backed by the existing
  generic tabset infra (`[role="tablist"][data-tabset]` in the shell JS: panel
  hiding, hash restore, arrow-key navigation). Tab targets `queue` / `surfaces`
  give `#queue` / `#surfaces` deep links.
- The motion settings page (Premise / Offer / Signals / Execution) was converted
  from loose pill buttons to the same `segTabs()` control; the Prospects radio
  segmented control keeps its markup and shares the visual style.
- Tab buttons carry count badges (queue length, enabled-surface count); the
  contextual sub (`oldest 1d`) stays on the right of the head row.
- **Queue tab**: existing queue cards, unchanged.
- **Surfaces tab**: ALL enabled surfaces — drop the "interesting" filter and the
  `slice(0, 4)` truncation. Each row:
  - left: `capability / handle / surfaceLabel`, detail line (captured counts,
    observations, pagination note, resume cursor, last error),
  - right: status dot + last run status, and `synced Xm ago` from
    `lastSyncedAt ?? lastObservedAt` via `formatRelative(value, generatedAt)`;
    `never synced` (amber) when both are null.
  - Sort: rows with `lastError` first, then the existing capability/handle/key order.

## Code mapping

| Change | Where |
| --- | --- |
| Add compact `renderAgentRuntimeBar(runtime, agentStatus)` next to the card; queue page calls it instead of `renderAgentRuntimeCard` | `src/artifacts/render-agent-runtime-card.js`, `src/artifacts/render-queue.js:35` |
| Replace `renderAgentStatusPanel`'s `ws-grid` with `ws-strip`; collapse panel renderers into cell renderers | `src/artifacts/render-queue.js:100-128` |
| New tabbed section wrapping `renderQueue` + full surfaces list; remove `renderInboundSurfacePanel` filter/slice; add sync stamp | `src/artifacts/render-queue.js:37-46, 262-313` |
| Surface data already has `lastSyncedAt` / `lastObservedAt` — no builder change | `src/core/build-agent-status.js:388-389` |
| CSS: `.ws-strip`, `.agent-bar`, `.sec-tabs` (size variant of `.settings-tabs`), right-aligned `.wsf-when`; strip wraps to column under the existing 1100px breakpoint | `src/lib/exo-ui-components.js` (~2371 for grid styles, ~1860 for tab styles) |
| Update queue-page assertions: tab markup present, all surfaces rendered with sync stamps, strip replaces grid panels, runtime bar summary | `test/operator-view.test.js` (~890, ~943, ~1117, ~1282) |

Panel ids must be unique page-wide (tabset resolves panels via
`document.getElementById(aria-controls)`); use `queue-tab-queue` /
`queue-tab-surfaces` rather than bare `queue`.

## Non-goals

- No changes to queue card content, ordering, or actions.
- No changes to the Operator landing page card.
- No changes to `build-agent-status.js` or the CLI `formatAgentStatusReport` text output.
- No new polling/refresh behavior; the live-refresh pill behavior is untouched.

## Resolved choices

1. View switcher is a segmented button group, not loose tabs (operator request).
2. Second tab label: "Inbound surfaces".
3. Agent bar auto-opens when the runtime is `off` or agent status is `blocked`;
   otherwise collapsed.
4. Errored surfaces sort to the top of the surfaces tab; never-synced surfaces
   show a gray "Enabled" dot with an amber "never synced" stamp.
