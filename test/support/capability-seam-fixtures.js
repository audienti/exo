// @ts-check

/**
 * @param {Record<string, any>} [overrides]
 */
export function buildSeamRegistryRow(overrides = {}) {
  return {
    id: "action:send_email",
    kind: "mutation_action",
    service: "gmail",
    capabilityKey: "send_email",
    label: "Send Email",
    actionKey: "send_email",
    sync: { owner: null },
    reconcile: { owner: "src/core/email-send-reconciliation.js" },
    mutate: { owner: "src/core/record-action-result.js" },
    status: {
      sync: "n/a",
      reconcile: "missing",
      mutate: "partial",
    },
    proofSurfaces: ["gmail-sent-mail", "gmail-inbox-threads"],
    stateKeys: ["messaging.email_sent"],
    syncStrategy: "not-applicable-mutation-starts-at-writeback",
    reconciliationStrategy: "gmail-thread-and-sent-mail-proof",
    mutationDebtPolicy: "pending external proof until gmail-sent-mail or gmail thread proof is available",
    kanbanLane: "now",
    gap: "Email send writeback exists, but no Gmail sent-mail proof surface reconciles it.",
    ...overrides,
  };
}
