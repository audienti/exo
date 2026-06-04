// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { deriveLinkedinCompanyName } from "../src/lib/linkedin-headline.js";

test("deriveLinkedinCompanyName pulls company names from common LinkedIn headline patterns", () => {
  assert.equal(
    deriveLinkedinCompanyName("Head of Strategic Partnerships @ Nassau Street Partners | Bachelor of Psychological Science"),
    "Nassau Street Partners",
  );
  assert.equal(
    deriveLinkedinCompanyName("Vice President, Enterprise IT Vendor Management Office at McKesson"),
    "McKesson",
  );
});

test("deriveLinkedinCompanyName rejects generic lowercase at-phrases", () => {
  assert.equal(
    deriveLinkedinCompanyName("Data Strategy Guru - Driving AI, Cloud, Data Architecture & Governance at the Enterprise Level"),
    null,
  );
});
