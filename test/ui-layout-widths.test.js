// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { renderShell } from "../src/lib/exo-ui-components.js";

test("renderShell annotates routes so wide layouts can target the active surface", () => {
  const indexHtml = renderShell({
    title: "Exo — Motions",
    activeId: "motions",
    sectionLabel: "Motions",
    body: '<div class="dom-wrap" id="motions-top"></div>',
  });
  const detailHtml = renderShell({
    title: "Exo — Prospect",
    activeId: "prospects",
    sectionLabel: "Prospects",
    detailLabel: "Lina Park",
    body: '<section class="dom-wrap person-detail" id="p-1"></section>',
    detail: true,
  });

  assert.ok(indexHtml.includes('<body class="view-motions is-index-route">'));
  assert.ok(detailHtml.includes('<body class="view-prospects is-detail-route">'));
});

test("wide workspace surfaces drop the desktop max-width clamps", () => {
  const html = renderShell({
    title: "Exo",
    activeId: "workspace",
    sectionLabel: "Workspace",
    body: '<div class="ws-wrap"></div>',
  });

  assert.ok(html.includes("body.view-motions .dom-wrap,"));
  assert.ok(html.includes("body.view-execution .op-intro,"));
  assert.ok(html.includes("body.view-prospects .pr-table,"));
  assert.ok(html.includes("body.view-connections .conn-main,"));
  assert.ok(html.includes("body.view-execution .user-cards,"));
  assert.ok(html.includes(".user-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));"));
  assert.ok(html.includes("body.view-settings .exec-policy-card{max-width:none}"));
  assert.ok(html.includes("body.view-workspace .ws-wrap{max-width:none}"));
  assert.ok(html.includes(".canvas.is-detail .company-detail,"));
  assert.ok(html.includes(".canvas.is-detail .exec-two,"));
});

test("motion picker dropdown stays inside the main canvas width", () => {
  const html = renderShell({
    title: "Exo — Operator",
    activeId: "operator",
    sectionLabel: "Operator",
    body: '<div class="op-wrap"></div>',
  });

  assert.ok(html.includes(".exo-root{display:grid;grid-template-columns:212px 1fr;height:100vh;--exo-nav-width:212px}"));
  assert.ok(html.includes(".exo-root.nav-collapsed{grid-template-columns:58px 1fr;--exo-nav-width:58px}"));
  assert.ok(html.includes(".seg-motion-picker{position:relative;display:flex;min-width:0}"));
  assert.ok(html.includes(".seg-motion-menu{position:absolute;top:calc(100% + 8px);left:0;right:auto;width:min(430px,calc(100vw - var(--exo-nav-width) - 40px));"));
  assert.ok(html.includes("min-width:min(340px,calc(100vw - var(--exo-nav-width) - 40px));max-width:calc(100vw - var(--exo-nav-width) - 40px);"));
});

test("renderShell includes the shared Exo favicon metadata", () => {
  const html = renderShell({
    title: "Exo",
    activeId: "operator",
    sectionLabel: "Operator",
    body: "<div></div>",
  });

  assert.ok(html.includes('<meta name="theme-color" content="#0f172a">'));
  assert.ok(html.includes('<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,'));
  assert.ok(html.includes("viewBox%3D%220%2012%20182%20190%22"));
  assert.ok(html.includes("%23DB2C5D"));
});
