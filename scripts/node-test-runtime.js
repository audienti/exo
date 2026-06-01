// @ts-check

export const EXPERIMENTAL_WARNING_DISABLE_FLAG = "--disable-warning=ExperimentalWarning";

/**
 * @param {NodeJS.ProcessEnv} [baseEnv]
 */
export function buildNodeTestEnv(baseEnv = process.env) {
  const nodeOptions = baseEnv.NODE_OPTIONS?.trim() ?? "";
  const parts = nodeOptions ? nodeOptions.split(/\s+/).filter(Boolean) : [];
  if (!parts.includes(EXPERIMENTAL_WARNING_DISABLE_FLAG)) {
    parts.push(EXPERIMENTAL_WARNING_DISABLE_FLAG);
  }

  return {
    ...baseEnv,
    NODE_OPTIONS: parts.join(" ").trim()
  };
}
