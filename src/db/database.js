// @ts-check

import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { getDatabasePath, getStateDir } from "./paths.js";

let db = null;

/**
 * @returns {DatabaseSync}
 */
function getDatabase() {
  if (db) {
    return db;
  }

  const exoDir = getStateDir();
  const dbPath = getDatabasePath();

  fs.mkdirSync(exoDir, { recursive: true });

  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000;");
  safelyEnableWal(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS motions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      source_url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
  `);

  db.exec(`
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

  return db;
}

/**
 * @param {DatabaseSync} database
 */
function safelyEnableWal(database) {
  try {
    database.exec("PRAGMA journal_mode = WAL;");
  } catch (error) {
    if (!(error instanceof Error) || !/database is locked/i.test(error.message)) {
      throw error;
    }
  }
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 */
export function insertMotion(motion) {
  const statement = getDatabase().prepare(`
    INSERT INTO motions (id, status, source_url, created_at, updated_at, payload_json)
    VALUES (@id, @status, @sourceUrl, @createdAt, @updatedAt, @payloadJson)
  `);

  statement.run({
    id: motion.id,
    status: motion.status,
    sourceUrl: motion.offer.sourceUrl,
    createdAt: motion.createdAt,
    updatedAt: motion.updatedAt,
    payloadJson: JSON.stringify(motion, null, 2)
  });
}

/**
 * @param {string} id
 * @returns {unknown | null}
 */
export function findMotionById(id) {
  const row = getDatabase()
    .prepare(`SELECT payload_json FROM motions WHERE id = ?`)
    .get(id);

  if (!row) return null;
  return JSON.parse(row.payload_json);
}

/**
 * @returns {unknown[]}
 */
export function listMotions() {
  const rows = getDatabase()
    .prepare(`
      SELECT payload_json
      FROM motions
      ORDER BY created_at DESC
    `)
    .all();

  return rows.map((row) => JSON.parse(row.payload_json));
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type} profile
 */
export function insertBrowserProfile(profile) {
  const statement = getDatabase().prepare(`
    INSERT INTO browser_profiles (id, status, browser, label, profile_path, created_at, updated_at, payload_json)
    VALUES (@id, @status, @browser, @label, @profilePath, @createdAt, @updatedAt, @payloadJson)
  `);

  statement.run({
    id: profile.id,
    status: profile.status,
    browser: profile.browser,
    label: profile.label,
    profilePath: profile.profilePath,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    payloadJson: JSON.stringify(profile, null, 2)
  });
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type} profile
 */
export function updateBrowserProfile(profile) {
  const statement = getDatabase().prepare(`
    UPDATE browser_profiles
    SET status = @status,
        browser = @browser,
        label = @label,
        profile_path = @profilePath,
        updated_at = @updatedAt,
        payload_json = @payloadJson
    WHERE id = @id
  `);

  statement.run({
    id: profile.id,
    status: profile.status,
    browser: profile.browser,
    label: profile.label,
    profilePath: profile.profilePath,
    updatedAt: profile.updatedAt,
    payloadJson: JSON.stringify(profile, null, 2)
  });
}

/**
 * @param {string} id
 * @returns {unknown | null}
 */
export function findBrowserProfileById(id) {
  const row = getDatabase()
    .prepare(`SELECT payload_json FROM browser_profiles WHERE id = ?`)
    .get(id);

  if (!row) return null;
  return JSON.parse(row.payload_json);
}

/**
 * @param {string} profilePath
 * @returns {unknown | null}
 */
export function findBrowserProfileByPath(profilePath) {
  const row = getDatabase()
    .prepare(`SELECT payload_json FROM browser_profiles WHERE profile_path = ?`)
    .get(profilePath);

  if (!row) return null;
  return JSON.parse(row.payload_json);
}

/**
 * @returns {unknown[]}
 */
export function listBrowserProfiles() {
  const rows = getDatabase()
    .prepare(`
      SELECT payload_json
      FROM browser_profiles
      ORDER BY created_at DESC
    `)
    .all();

  return rows.map((row) => JSON.parse(row.payload_json));
}

/**
 * @param {string} id
 */
export function deleteBrowserProfile(id) {
  getDatabase()
    .prepare(`DELETE FROM browser_profiles WHERE id = ?`)
    .run(id);
}
