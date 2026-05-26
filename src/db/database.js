// @ts-check

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

let db = null;

/**
 * @returns {DatabaseSync}
 */
function getDatabase() {
  if (db) {
    return db;
  }

  const exoDir = path.join(process.cwd(), ".exo");
  const dbPath = path.join(exoDir, "exo.db");

  fs.mkdirSync(exoDir, { recursive: true });

  db = new DatabaseSync(dbPath);
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

  return db;
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
