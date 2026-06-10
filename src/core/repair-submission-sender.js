// @ts-check

import { loadRepairSubmissions, updateRepairSubmissionStatus } from "./contract-repair-store.js";

const SUBMISSION_HTTP_TIMEOUT_MS = 10000;

/**
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {string} bodyText
 * @returns {Promise<{ status: number } | null>}
 */
async function defaultHttpPostImpl(url, headers, bodyText) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: bodyText,
      signal: AbortSignal.timeout(SUBMISSION_HTTP_TIMEOUT_MS)
    });
    return { status: response.status };
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget push of pending repair submissions from the local spool to
 * the hosted append-only intake. Endpoint-optional by design: when upstream
 * submission is disabled or no endpoint is configured this is a no-op and
 * submissions simply accumulate locally. A failed push leaves the submission
 * pending so a later flush retries it; this never throws.
 *
 * @param {{
 *   stateDir: string,
 *   config: { submitUpstream: boolean, submissionEndpoint: string | null },
 *   httpPostImpl?: ((url: string, headers: Record<string, string>, bodyText: string) => Promise<{ status: number } | null>) | null,
 *   now?: string | null
 * }} input
 * @returns {Promise<{ attempted: number, submitted: number, failed: number }>}
 */
export async function flushRepairSubmissions(input) {
  if (!input.config.submitUpstream || !input.config.submissionEndpoint) {
    return { attempted: 0, submitted: 0, failed: 0 };
  }

  const endpoint = input.config.submissionEndpoint;
  const httpPostImpl = input.httpPostImpl ?? defaultHttpPostImpl;
  const pending = loadRepairSubmissions({ stateDir: input.stateDir })
    .filter((submission) => submission.submissionStatus === "pending");

  let submitted = 0;
  let failed = 0;
  for (const submission of pending) {
    let response = null;
    try {
      response = await httpPostImpl(endpoint, { "content-type": "application/json" }, JSON.stringify(submission));
    } catch {
      response = null;
    }
    if (response && response.status >= 200 && response.status < 300) {
      submitted += 1;
      updateRepairSubmissionStatus({
        stateDir: input.stateDir,
        submissionId: submission.submissionId,
        submissionStatus: "submitted",
        submittedAt: input.now ?? new Date().toISOString()
      });
    } else {
      // Leave it pending: the next flush retries. Fire-and-forget means the
      // run never blocks on this, not that a failed push is forgotten.
      failed += 1;
    }
  }

  return { attempted: pending.length, submitted, failed };
}
