// @ts-check
//
// Operator steer + notes are first-class inputs to every agent action. A steer
// is a directive ("keep it short", "they work for us, don't target") that the
// agent MUST honor before drafting or sending. Notes are context the agent
// should read. Ignoring them is a correctness bug, not a style choice.

/** @param {any} prospect */
export function prospectTimelineNotes(prospect) {
  return Array.isArray(prospect?.timelineNotes) ? prospect.timelineNotes : [];
}

/** @param {any} prospect */
export function prospectSteers(prospect) {
  return prospectTimelineNotes(prospect).filter((n) => n?.kind === "steer");
}

/** @param {any} prospect — note + steer bodies, for the drafting brief */
export function prospectGuidanceContext(prospect) {
  return prospectTimelineNotes(prospect).map((n) => ({ kind: n.kind ?? "note", body: n.body ?? "", at: n.createdAt ?? null }));
}

// A steer that means "do not contact this person at all" (works for us, internal
// teammate, not a real prospect, explicitly don't target/message/reach). When
// any steer matches, the prospect is removed from BOTH the draft and send
// queues so the unattended loop can never draft or fire at them.
const SUPPRESS_PATTERN =
  /\b(do not|don'?t|never|stop)\s+(target|contact|message|reach|engage|email|dm|pitch)\b|\bworks?\s+(for|at|with)\s+us\b|\b(internal|colleague|teammate|coworker|our employee|on our team|our team|same company)\b|\bnot a (real )?(prospect|target|lead)\b|\bskip (this )?(person|them|her|him)\b|\bdo not target\b/i;

/** @param {any} prospect @returns {{ suppressed: boolean, reason: string|null }} */
export function steerSuppression(prospect) {
  for (const steer of prospectSteers(prospect)) {
    if (SUPPRESS_PATTERN.test(steer.body ?? "")) {
      return { suppressed: true, reason: steer.body ?? "operator steer" };
    }
  }
  return { suppressed: false, reason: null };
}
