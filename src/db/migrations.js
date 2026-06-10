// @ts-check

const CURRENT_SCHEMA_VERSION = 1;

/**
 * @typedef {{
 *   version: number,
 *   name: string,
 *   up: (database: import("node:sqlite").DatabaseSync) => void
 * }} DatabaseMigration
 */

export class ReinitializeRequiredError extends Error {
  constructor() {
    super("Exo database was created by a pre-0.3.0 schema; reinitialize required before using this build.");
    this.name = "ReinitializeRequiredError";
  }
}

/** @type {DatabaseMigration[]} */
const migrations = [
  {
    version: CURRENT_SCHEMA_VERSION,
    name: "normalized-core-baseline",
    up(database) {
      database.exec(`
        CREATE TABLE companies (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          search_name TEXT NOT NULL,
          domain TEXT,
          linkedin_company_url TEXT,
          website_url TEXT,
          schema_version INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX companies_by_domain ON companies(domain);
        CREATE INDEX companies_by_linkedin ON companies(linkedin_company_url);

        CREATE TABLE motions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          source_url TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          schema_version INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );

        CREATE TABLE browser_profiles (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          browser TEXT NOT NULL,
          label TEXT NOT NULL,
          profile_path TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );

        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );

        CREATE TABLE inbound_observations (
          id TEXT PRIMARY KEY,
          dedupe_key TEXT NOT NULL UNIQUE,
          user_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          capability TEXT NOT NULL,
          surface_key TEXT NOT NULL,
          observation_kind TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          motion_id TEXT,
          company_id TEXT,
          prospect_id TEXT,
          person_id TEXT,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX inbound_observations_by_user_observed
          ON inbound_observations (user_id, observed_at DESC);
        CREATE INDEX inbound_observations_by_account_observed
          ON inbound_observations (account_id, observed_at DESC);

        CREATE TABLE inbound_cues (
          id TEXT PRIMARY KEY,
          dedupe_key TEXT NOT NULL UNIQUE,
          user_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          capability TEXT NOT NULL,
          surface_key TEXT NOT NULL,
          cue_kind TEXT NOT NULL,
          cue_status TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          resolved_at TEXT,
          motion_id TEXT,
          company_id TEXT,
          prospect_id TEXT,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX inbound_cues_by_user_status_observed
          ON inbound_cues (user_id, cue_status, observed_at DESC);
        CREATE INDEX inbound_cues_by_account_status_observed
          ON inbound_cues (account_id, cue_status, observed_at DESC);

        CREATE TABLE motion_accounts (
          id TEXT PRIMARY KEY,
          motion_id TEXT NOT NULL REFERENCES motions(id) ON DELETE CASCADE,
          company_id TEXT NOT NULL REFERENCES companies(id),
          execution_user_id TEXT REFERENCES users(id),
          queue_status TEXT NOT NULL CHECK (queue_status IN (
            'discovered','queued_for_research','researched','selected','ready',
            'suppressed','exhausted'
          )),
          packet_claimed_by TEXT,
          packet_claimed_at TEXT,
          last_research_at TEXT,
          schema_version INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          UNIQUE (motion_id, company_id)
        );
        CREATE INDEX motion_accounts_by_user ON motion_accounts(execution_user_id);

        CREATE TABLE signal_matches (
          id TEXT PRIMARY KEY,
          motion_account_id TEXT NOT NULL REFERENCES motion_accounts(id) ON DELETE CASCADE,
          motion_id TEXT NOT NULL,
          company_id TEXT NOT NULL,
          observed_at TEXT,
          created_at TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          payload_json TEXT NOT NULL
        );

        CREATE TABLE people (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          linkedin_member_id TEXT,
          linkedin_public_id TEXT,
          primary_email TEXT,
          schema_version INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
        CREATE UNIQUE INDEX people_by_member_id ON people(linkedin_member_id)
          WHERE linkedin_member_id IS NOT NULL;
        CREATE UNIQUE INDEX people_by_linkedin ON people(linkedin_public_id)
          WHERE linkedin_public_id IS NOT NULL;
        CREATE UNIQUE INDEX people_by_email ON people(primary_email)
          WHERE primary_email IS NOT NULL;

        CREATE TABLE contact_points (
          id TEXT PRIMARY KEY,
          person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          value TEXT NOT NULL,
          verification_status TEXT NOT NULL CHECK (verification_status IN (
            'verified','observed','inferred','rejected','unknown'
          )),
          match_status TEXT NOT NULL CHECK (match_status IN (
            'same_person_verified','same_person_probable','same_person_possible',
            'rejected'
          )),
          confidence REAL,
          source TEXT,
          observed_at TEXT,
          schema_version INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          UNIQUE (kind, value)
        );
        CREATE INDEX contact_points_review ON contact_points(match_status)
          WHERE match_status IN ('same_person_possible', 'same_person_probable');

        CREATE TABLE employments (
          id TEXT PRIMARY KEY,
          person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          company_id TEXT NOT NULL REFERENCES companies(id),
          title TEXT,
          is_current INTEGER NOT NULL DEFAULT 1,
          source TEXT NOT NULL,
          observed_at TEXT,
          ended_observed_at TEXT,
          schema_version INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          UNIQUE (person_id, company_id)
        );
        CREATE INDEX employments_by_company ON employments(company_id, is_current);
        CREATE INDEX employments_by_person ON employments(person_id, is_current);

        CREATE TABLE prospects (
          id TEXT PRIMARY KEY,
          motion_id TEXT NOT NULL REFERENCES motions(id) ON DELETE CASCADE,
          company_id TEXT NOT NULL REFERENCES companies(id),
          person_id TEXT NOT NULL REFERENCES people(id),
          motion_account_id TEXT NOT NULL REFERENCES motion_accounts(id) ON DELETE CASCADE,
          queue_status TEXT NOT NULL CHECK (queue_status IN (
            'discovered','queued_for_research','researched','selected','ready',
            'suppressed','exhausted','held_cross_motion'
          )),
          cadence_status TEXT NOT NULL CHECK (cadence_status IN ('pending','ready')),
          cadence_current_step TEXT,
          cadence_next_action_due_at TEXT,
          cadence_last_touch_at TEXT,
          cadence_last_touch_outcome TEXT,
          packet_claimed_by TEXT,
          packet_claimed_at TEXT,
          schema_version INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          UNIQUE (motion_id, person_id)
        );
        CREATE INDEX prospects_due ON prospects(cadence_status, cadence_next_action_due_at);
        CREATE INDEX prospects_by_motion ON prospects(motion_id, queue_status);
        CREATE INDEX prospects_by_company ON prospects(company_id);
        CREATE INDEX prospects_by_person ON prospects(person_id);

        CREATE TABLE activity_events (
          id TEXT PRIMARY KEY,
          dedupe_key TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL CHECK (kind IN ('touch','timeline_note','system')),
          person_id TEXT,
          prospect_id TEXT,
          motion_id TEXT,
          company_id TEXT,
          user_id TEXT,
          surface TEXT,
          direction TEXT CHECK (direction IS NULL OR direction IN (
            'outbound','inbound','system'
          )),
          outcome TEXT CHECK (outcome IS NULL OR outcome IN (
            'pending','sent','accepted','ignored','opened-no-reply','replied',
            'blocked','nurture'
          )),
          occurred_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX activity_by_person ON activity_events(person_id, occurred_at DESC);
        CREATE INDEX activity_by_prospect ON activity_events(prospect_id, occurred_at DESC);
        CREATE INDEX activity_by_motion ON activity_events(motion_id, occurred_at DESC);
        CREATE INDEX activity_by_user_time ON activity_events(user_id, occurred_at DESC);

        CREATE TABLE prospect_drafts (
          id TEXT PRIMARY KEY,
          prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
          motion_id TEXT NOT NULL,
          person_id TEXT NOT NULL,
          surface TEXT NOT NULL,
          channel TEXT NOT NULL CHECK (channel IN ('linkedin','email')),
          status TEXT NOT NULL CHECK (status IN (
            'drafting','ready','queued','approved','sent','discarded'
          )),
          authored_by TEXT NOT NULL CHECK (authored_by IN ('agent','operator')),
          edited_by_operator INTEGER NOT NULL DEFAULT 0 CHECK (edited_by_operator IN (0,1)),
          approved_by_operator INTEGER NOT NULL DEFAULT 0 CHECK (approved_by_operator IN (0,1)),
          approved_by_user_id TEXT REFERENCES users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          approved_at TEXT,
          sent_at TEXT,
          schema_version INTEGER NOT NULL,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX drafts_by_status ON prospect_drafts(status, updated_at DESC);
        CREATE INDEX drafts_by_prospect ON prospect_drafts(prospect_id, status);
      `);
    },
  },
];

/**
 * @param {import("node:sqlite").DatabaseSync} database
 */
export function applyMigrations(database) {
  database.exec("PRAGMA foreign_keys = ON;");

  for (const migration of migrations) {
    database.exec("BEGIN IMMEDIATE");
    try {
      if (getUserVersion(database) === CURRENT_SCHEMA_VERSION) {
        database.exec("COMMIT");
        continue;
      }

      assertNoPre03Ledger(database);

      if (getUserVersion(database) >= migration.version) {
        database.exec("COMMIT");
        continue;
      }

      migration.up(database);
      setUserVersion(database, migration.version);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      if (error instanceof Error) {
        error.message = `Migration ${migration.version} (${migration.name}) failed: ${error.message}`;
      }
      throw error;
    }
  }
}

/**
 * @param {import("node:sqlite").DatabaseSync} database
 */
function assertNoPre03Ledger(database) {
  const userVersion = getUserVersion(database);
  if (userVersion === CURRENT_SCHEMA_VERSION) return;

  const tables = listUserTables(database);
  if (userVersion > 0 || tables.length > 0) {
    throw new ReinitializeRequiredError();
  }
}

/**
 * @param {import("node:sqlite").DatabaseSync} database
 * @returns {string[]}
 */
function listUserTables(database) {
  return database
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
    `)
    .all()
    .map((row) => String(row.name));
}

/**
 * @param {import("node:sqlite").DatabaseSync} database
 * @returns {number}
 */
function getUserVersion(database) {
  const row = database.prepare("PRAGMA user_version").get();
  return Number(row.user_version ?? 0);
}

/**
 * @param {import("node:sqlite").DatabaseSync} database
 * @param {number} version
 */
function setUserVersion(database, version) {
  database.exec(`PRAGMA user_version = ${version};`);
}
