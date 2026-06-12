// @ts-check

/**
 * Default weekly invitation quota for harness-backed LinkedIn accounts created
 * via interactive CLI surfaces (`users accounts add`, `users accounts map-runtime`,
 * `exo onboarding`).
 *
 * Daily target ≈ 25 invitations per business day, matching the operator's
 * calibrated number for a warmed LinkedIn account.
 */
export const LINKEDIN_DEFAULT_WEEKLY_INVITATIONS = 125;

/**
 * Hard upper bound on the weekly invitation quota the CLI will accept. Well
 * above any realistic warmed-account weekly limit, but low enough that typos
 * like `1250` get caught at parse time.
 */
export const LINKEDIN_MAX_WEEKLY_INVITATIONS = 500;
