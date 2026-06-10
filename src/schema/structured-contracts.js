// @ts-check

import { z } from "zod";

/**
 * Output contracts for the repairable structured builders (V1 repair scope:
 * next, daily, inbox, agent_queue).
 *
 * These are deliberately shallow-strict and deep-loose: they assert the
 * top-level shape and the invariants downstream consumers rely on, and
 * passthrough everything else. An over-strict contract here would mint false
 * repair fingerprints in the field, so a field is only constrained when a
 * consumer genuinely depends on it.
 */

const contractUserSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1)
}).passthrough();

export const nextViewContractSchema = z.object({
  source: z.string().trim().min(1),
  headline: z.string().trim().min(1),
  nextMove: z.string().trim().min(1),
  status: z.object({
    kind: z.string().trim().min(1)
  }).passthrough(),
  guidance: z.unknown(),
  context: z.object({}).passthrough()
}).passthrough();

export const dailyViewContractSchema = z.object({
  user: contractUserSchema,
  generatedAt: z.string().datetime(),
  counts: z.object({
    itemCount: z.number().int().min(0)
  }).passthrough(),
  capacity: z.object({}).passthrough(),
  items: z.array(z.object({}).passthrough())
}).passthrough();

export const inboxViewContractSchema = z.object({
  user: contractUserSchema,
  counts: z.object({
    itemCount: z.number().int().min(0)
  }).passthrough(),
  surfaces: z.object({}).passthrough(),
  items: z.array(z.object({}).passthrough())
}).passthrough();

export const agentQueueContractSchema = z.object({
  count: z.number().int().min(0),
  itemCount: z.number().int().min(0),
  waitingCount: z.number().int().min(0),
  tasks: z.array(z.object({
    kind: z.string().trim().min(1)
  }).passthrough()),
  waiting: z.array(z.object({
    kind: z.string().trim().min(1)
  }).passthrough()),
  blockers: z.array(z.unknown())
}).passthrough();

export const STRUCTURED_CONTRACT_SCHEMAS = {
  next: nextViewContractSchema,
  daily: dailyViewContractSchema,
  inbox: inboxViewContractSchema,
  agent_queue: agentQueueContractSchema
};
