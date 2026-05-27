// @ts-check

import { rehydrateMotion } from "../core/rehydrate-motion.js";

/**
 * @typedef {{
 *   version: number,
 *   name: string,
 *   up: (database: import("node:sqlite").DatabaseSync) => void
 * }} DatabaseMigration
 */

/** @type {DatabaseMigration[]} */
const migrations = [
  {
    version: 1,
    name: "bootstrap-core-tables",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS motions (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          source_url TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
      `);

      database.exec(`
        CREATE TABLE IF NOT EXISTS browser_profiles (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          browser TEXT NOT NULL,
          label TEXT NOT NULL,
          profile_path TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
      `);

      database.exec(`
        CREATE TABLE IF NOT EXISTS companies (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          search_name TEXT NOT NULL,
          domain TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
      `);
    }
  },
  {
    version: 2,
    name: "rehydrate-legacy-motion-payloads",
    up(database) {
      normalizeMotionPayloads(database);
    }
  },
  {
    version: 3,
    name: "backfill-human-friendly-motion-names",
    up(database) {
      normalizeMotionPayloads(database);
    }
  },
  {
    version: 4,
    name: "convert-motion-names-to-generated-codenames",
    up(database) {
      normalizeMotionPayloads(database);
    }
  },
  {
    version: 5,
    name: "move-target-account-engagement-state-to-prospects",
    up(database) {
      normalizeMotionPayloads(database);
    }
  },
  {
    version: 6,
    name: "add-users-table",
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
      `);
    }
  }
];

/**
 * @param {import("node:sqlite").DatabaseSync} database
 */
export function applyMigrations(database) {
  for (const migration of migrations) {
    if (getUserVersion(database) >= migration.version) {
      continue;
    }

    database.exec("BEGIN IMMEDIATE");
    try {
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

/**
 * @param {import("node:sqlite").DatabaseSync} database
 */
function normalizeMotionPayloads(database) {
  const rows = database
    .prepare(`
      SELECT id, payload_json
      FROM motions
    `)
    .all();
  const update = database.prepare(`
    UPDATE motions
    SET status = @status,
        source_url = @sourceUrl,
        payload_json = @payloadJson
    WHERE id = @id
  `);

  for (const row of rows) {
    const rawMotion = JSON.parse(row.payload_json);
    const { motion, repaired } = rehydrateMotion(rawMotion);

    if (!repaired) {
      continue;
    }

    update.run({
      id: motion.id,
      status: motion.status,
      sourceUrl: motion.offer.sourceUrl,
      payloadJson: JSON.stringify(motion, null, 2)
    });
  }
}
