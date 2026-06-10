// @ts-check

import { getLocalStateDir } from "../db/paths.js";
import {
  buildRepairOperatorNotice,
  executeRepairableContract,
  resolveRepairRuntimeConfig
} from "../core/execute-repairable-contract.js";
import { flushRepairSubmissions } from "../core/repair-submission-sender.js";

/**
 * CLI wiring for the V1 contract self-repair layer. Inert unless
 * EXO_REPAIR_ENABLED=1 (and never active under EXO_DISABLE_REPAIR=1): the
 * default path returns the builder output untouched without resolving a state
 * dir or reading any repair store.
 *
 * Operator notices go to stderr so `--json` stdout stays parseable.
 *
 * @param {{
 *   contractKind: import("zod").infer<typeof import("../schema/contract-repair.js").repairableContractKindSchema>,
 *   build: () => unknown,
 *   normalizedInputs: unknown
 * }} input
 * @returns {Promise<{ contract: any, repair: unknown | null }>}
 */
export async function runCliRepairableContract(input) {
  const config = resolveRepairRuntimeConfig();
  if (!config.enabled) {
    return { contract: input.build(), repair: null };
  }

  const stateDir = getLocalStateDir();
  const result = await executeRepairableContract({
    contractKind: input.contractKind,
    build: input.build,
    normalizedInputs: input.normalizedInputs,
    stateDir,
    repairConfig: config
  });

  if (result.repair) {
    let flush = { attempted: 0, submitted: 0, failed: 0 };
    try {
      flush = await flushRepairSubmissions({ stateDir, config });
    } catch {
      // fire-and-forget: a flush failure never blocks the repaired run
    }
    for (const line of buildRepairOperatorNotice({ contractKind: input.contractKind, submitted: flush.submitted > 0 })) {
      console.error(`⚠️  ${line}`);
    }
  }

  return result;
}
