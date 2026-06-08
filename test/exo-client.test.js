// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { EXO_CLIENT_JS } from "../src/lib/exo-ui-components.js";

test("EXO_CLIENT_JS navigates immediately for return-style actions and treats any busy action host as operator-busy", () => {
  assert.match(EXO_CLIENT_JS, /\[data-exo-args\]\.busy/);
  assert.match(EXO_CLIENT_JS, /var navTarget = \(data && data\.redirect\) \? data\.redirect : ret;/);
  assert.match(EXO_CLIENT_JS, /if \(navTarget\) \{[\s\S]*location\.assign\(navTarget\);[\s\S]*return;/);
});
