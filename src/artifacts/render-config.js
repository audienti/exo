// @ts-check

/**
 * @param {import("../schema/config-bundle.js").configBundleSchema._type} bundle
 * @returns {string}
 */
export function renderConfigExportSummary(bundle) {
  return [
    "Exo Config Export",
    `Schema Version: ${bundle.schemaVersion}`,
    `Exo Version: ${bundle.exoVersion}`,
    `Exported At: ${bundle.exportedAt}`,
    `Motions: ${bundle.motions.length}`,
    `Browser Profiles: ${bundle.browserProfiles.length}`,
    `Companies: ${bundle.companies.length}`
  ].join("\n");
}

/**
 * @param {{
 *   importedAt: string,
 *   source: { exportedAt: string, exoVersion: string, schemaVersion: string },
 *   counts: {
 *     motions: { inserted: number, updated: number, total: number },
 *     browserProfiles: { inserted: number, updated: number, total: number },
 *     companies: { inserted: number, updated: number, total: number }
 *   }
 * }} result
 * @returns {string}
 */
export function renderConfigImportSummary(result) {
  return [
    "Exo Config Import",
    `Imported At: ${result.importedAt}`,
    `Source Exported At: ${result.source.exportedAt}`,
    `Source Exo Version: ${result.source.exoVersion}`,
    `Schema Version: ${result.source.schemaVersion}`,
    `Motions: inserted ${result.counts.motions.inserted}, updated ${result.counts.motions.updated}, total ${result.counts.motions.total}`,
    `Browser Profiles: inserted ${result.counts.browserProfiles.inserted}, updated ${result.counts.browserProfiles.updated}, total ${result.counts.browserProfiles.total}`,
    `Companies: inserted ${result.counts.companies.inserted}, updated ${result.counts.companies.updated}, total ${result.counts.companies.total}`,
    "Browser profiles are re-tested on import."
  ].join("\n");
}
