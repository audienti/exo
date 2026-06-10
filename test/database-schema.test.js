// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { applyMigrations } from "../src/db/migrations.js";

test("fresh database creates the consolidated normalized baseline schema", () => {
  const database = new DatabaseSync(":memory:");

  try {
    applyMigrations(database);

    const version = database.prepare("PRAGMA user_version").get().user_version;
    const foreignKeys = database.prepare("PRAGMA foreign_keys").get().foreign_keys;
    const tables = new Set(database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
    `).all().map((row) => row.name));

    assert.equal(version, 1);
    assert.equal(foreignKeys, 1);
    for (const table of [
      "companies",
      "motions",
      "browser_profiles",
      "users",
      "inbound_observations",
      "inbound_cues",
      "motion_accounts",
      "signal_matches",
      "people",
      "contact_points",
      "employments",
      "prospects",
      "activity_events",
      "prospect_drafts",
    ]) {
      assert.equal(tables.has(table), true, `missing table ${table}`);
    }

    assert.deepEqual(tableColumns(database, "motions"), [
      "id",
      "name",
      "status",
      "source_url",
      "version",
      "schema_version",
      "created_at",
      "updated_at",
      "payload_json",
    ]);
    assert.equal(tableColumns(database, "companies").includes("linkedin_company_url"), true);
    assert.equal(tableColumns(database, "inbound_observations").includes("person_id"), true);
  } finally {
    database.close();
  }
});

test("pre-0.3.0 database ledger fails closed with reinitialize required", () => {
  const database = new DatabaseSync(":memory:");

  try {
    database.exec(`
      CREATE TABLE motions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        source_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      PRAGMA user_version = 8;
    `);

    assert.throws(
      () => applyMigrations(database),
      /reinitialize required/i,
    );
  } finally {
    database.close();
  }
});

function tableColumns(database, tableName) {
  return database.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name);
}
