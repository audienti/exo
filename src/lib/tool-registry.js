// @ts-check

import { z } from "zod";
import { canonicalSurfaceModeSchema } from "../schema/surfaces/index.js";

export const toolMethodModeSchema = z.enum(["sync", "action"]);

export const toolBatchingContractSchema = z.object({
  batchable: z.boolean(),
  batchKey: z.string().trim().min(1),
  maxBatchSize: z.coerce.number().int().min(1).nullable().default(null),
  sharedNavigationTarget: z.string().trim().min(1).nullable().default(null),
  perItemVerificationRequired: z.boolean(),
  perItemWritebackRequired: z.boolean()
}).nullable().default(null);

export const toolDevelopmentContractSchema = z.object({
  artifactPostmortem: z.boolean().default(false),
  liveContinuation: z.boolean().default(false),
  repairNotes: z.boolean().default(false)
});

export const toolRuntimeRequirementsSchema = z.object({
  connector: z.string().trim().min(1),
  browser: z.string().trim().min(1).nullable().default(null),
  signedInIdentityRequired: z.boolean()
});

export const toolMethodRegistrationMetadataSchema = z.object({
  toolMethodId: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  publicMethodName: z.string().trim().min(1),
  mode: toolMethodModeSchema,
  capability: z.string().trim().min(1),
  inputSchemaRef: z.string().trim().min(1),
  outputSchemaRef: z.string().trim().min(1),
  runtimeRequirements: toolRuntimeRequirementsSchema,
  lifecycleHooksRequired: z.boolean(),
  implementationRef: z.string().trim().min(1),
  development: toolDevelopmentContractSchema,
  batching: toolBatchingContractSchema
});

export const toolMethodResultEnvelopeSchema = z.object({
  toolMethodId: z.string().trim().min(1),
  output: z.unknown()
});

export const toolMethodResultBatchSchema = z.object({
  mode: canonicalSurfaceModeSchema,
  results: z.array(toolMethodResultEnvelopeSchema).min(1)
});

/** @type {Map<string, {
 *   metadata: z.infer<typeof toolMethodRegistrationMetadataSchema>,
 *   inputSchema: z.ZodTypeAny,
 *   outputSchema: z.ZodTypeAny,
 *   execute: (session: unknown, input: any) => any
 * }>} */
const registry = new Map();

/**
 * @param {{
 *   toolMethodId: string,
 *   provider: string,
 *   publicMethodName: string,
 *   mode: z.infer<typeof toolMethodModeSchema>,
 *   capability: string,
 *   inputSchemaRef: string,
 *   outputSchemaRef: string,
 *   runtimeRequirements: z.infer<typeof toolRuntimeRequirementsSchema>,
 *   lifecycleHooksRequired: boolean,
 *   implementationRef: string,
 *   development?: z.infer<typeof toolDevelopmentContractSchema>,
 *   batching?: z.infer<typeof toolBatchingContractSchema>,
 *   inputSchema: z.ZodTypeAny,
 *   outputSchema: z.ZodTypeAny,
 *   execute: (session: unknown, input: any) => any
 * }} definition
 */
export function registerToolMethod(definition) {
  const metadata = toolMethodRegistrationMetadataSchema.parse({
    toolMethodId: definition.toolMethodId,
    provider: definition.provider,
    publicMethodName: definition.publicMethodName,
    mode: definition.mode,
    capability: definition.capability,
    inputSchemaRef: definition.inputSchemaRef,
    outputSchemaRef: definition.outputSchemaRef,
    runtimeRequirements: definition.runtimeRequirements,
    lifecycleHooksRequired: definition.lifecycleHooksRequired,
    implementationRef: definition.implementationRef,
    development: definition.development ?? {},
    batching: definition.batching ?? null
  });

  if (registry.has(metadata.toolMethodId)) {
    throw new Error(`Tool method is already registered: ${metadata.toolMethodId}`);
  }

  registry.set(metadata.toolMethodId, {
    metadata,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    execute: definition.execute
  });

  return metadata;
}

/**
 * @param {string} toolMethodId
 */
export function findToolMethodRegistration(toolMethodId) {
  return registry.get(toolMethodId) ?? null;
}

export function listToolMethodRegistrations() {
  return Array.from(registry.values(), (entry) => entry.metadata);
}

/**
 * @param {string} toolMethodId
 * @param {unknown} rawOutput
 */
export function parseToolMethodOutput(toolMethodId, rawOutput) {
  const registration = registry.get(toolMethodId);
  if (!registration) {
    throw new Error(`Tool method is not registered: ${toolMethodId}`);
  }

  return registration.outputSchema.parse(rawOutput);
}

/**
 * @param {unknown} rawBatch
 */
export function parseToolMethodResultBatch(rawBatch) {
  const batch = toolMethodResultBatchSchema.parse(rawBatch);
  return {
    mode: batch.mode,
    results: batch.results.map((result) => ({
      toolMethodId: result.toolMethodId,
      output: parseToolMethodOutput(result.toolMethodId, result.output)
    }))
  };
}

/**
 * @param {string} toolMethodId
 * @param {unknown} session
 * @param {unknown} rawInput
 */
export function executeToolMethodSync(toolMethodId, session, rawInput) {
  const registration = registry.get(toolMethodId);
  if (!registration) {
    throw new Error(`Tool method is not registered: ${toolMethodId}`);
  }

  const input = registration.inputSchema.parse(rawInput);
  const output = registration.execute(session, input);
  if (output && typeof output.then === "function") {
    throw new Error(`Tool method ${toolMethodId} returned a Promise during sync execution.`);
  }
  return registration.outputSchema.parse(output);
}
