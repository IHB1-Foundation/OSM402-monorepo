/**
 * SQLite database initialisation and migration.
 * Creates tables on first run; safe to call multiple times.
 */

import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = process.env.DATABASE_URL?.replace('file:', '') || path.join(process.cwd(), 'dev.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  migrate(_db);
  return _db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      id            TEXT PRIMARY KEY,
      repoKey       TEXT NOT NULL,
      issueNumber   INTEGER NOT NULL,
      bountyCap     TEXT NOT NULL,
      asset         TEXT NOT NULL,
      chainId       INTEGER NOT NULL,
      policyHash    TEXT NOT NULL,
      escrowAddress TEXT,
      intentHash    TEXT,
      fundingTxHash TEXT,
      status        TEXT NOT NULL DEFAULT 'PENDING',
      createdAt     TEXT NOT NULL,
      fundedAt      TEXT,
      UNIQUE(repoKey, issueNumber)
    );

    CREATE TABLE IF NOT EXISTS prs (
      id                  TEXT PRIMARY KEY,
      prKey               TEXT NOT NULL UNIQUE,
      repoKey             TEXT NOT NULL,
      prNumber            INTEGER NOT NULL,
      issueNumber         INTEGER,
      mergeSha            TEXT,
      contributorGithub   TEXT NOT NULL,
      contributorAddress  TEXT,
      filesChanged        INTEGER DEFAULT 0,
      additions           INTEGER DEFAULT 0,
      deletions           INTEGER DEFAULT 0,
      changedFiles        TEXT DEFAULT '[]',
      status              TEXT NOT NULL DEFAULT 'OPEN',
      createdAt           TEXT NOT NULL,
      updatedAt           TEXT NOT NULL,
      UNIQUE(repoKey, prNumber)
    );

    CREATE TABLE IF NOT EXISTS payouts (
      id          TEXT PRIMARY KEY,
      issueKey    TEXT NOT NULL,
      prKey       TEXT NOT NULL UNIQUE,
      repoKey     TEXT NOT NULL,
      issueNumber INTEGER NOT NULL,
      prNumber    INTEGER NOT NULL,
      mergeSha    TEXT NOT NULL,
      recipient   TEXT,
      amountUsd   REAL NOT NULL,
      amountRaw   TEXT,
      tier        TEXT,
      cartHash    TEXT,
      intentHash  TEXT,
      txHash      TEXT,
      holdReasons TEXT,
      status      TEXT NOT NULL DEFAULT 'PENDING',
      createdAt   TEXT NOT NULL,
      updatedAt   TEXT NOT NULL,
      UNIQUE(issueKey, status)
    );

    CREATE TABLE IF NOT EXISTS events (
      id          TEXT PRIMARY KEY,
      deliveryId  TEXT NOT NULL UNIQUE,
      type        TEXT NOT NULL,
      action      TEXT,
      payloadHash TEXT NOT NULL,
      createdAt   TEXT NOT NULL
    );
  `);
}

/** Close the database (for graceful shutdown / tests). */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
