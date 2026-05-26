// @ts-check

/**
 * @param {string[] | undefined} values
 * @returns {string[]}
 */
export function normalizeStringList(values) {
  if (!values) return [];

  return [...new Set(
    values
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

/**
 * @param {string[] | undefined} values
 * @returns {string[]}
 */
export function normalizeRepeatedStringList(values) {
  if (!values) return [];

  return [...new Set(
    values
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}
