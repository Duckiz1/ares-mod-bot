import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import './config.js';

const databasePath = process.env.DATABASE_PATH || './data/moderation.sqlite';
if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);
db.pragma('journal_mode = WAL');

db.exec(`
-- Every moderation action. Numbers are this bot's case numbers (shown as #12).
CREATE TABLE IF NOT EXISTS cases (
  number         INTEGER PRIMARY KEY AUTOINCREMENT,
  action         TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  user_name      TEXT NOT NULL,
  moderator_id   TEXT NOT NULL,
  moderator_name TEXT NOT NULL,
  reason         TEXT NOT NULL,
  duration       INTEGER,
  created_at     INTEGER NOT NULL,
  synced         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS cases_user ON cases (user_id, number);

-- Support tickets: one private channel per member at a time.
CREATE TABLE IF NOT EXISTS tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL,
  user_name   TEXT NOT NULL,
  topic       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  INTEGER NOT NULL,
  closed_at   INTEGER,
  closed_by   TEXT
);
CREATE INDEX IF NOT EXISTS tickets_open ON tickets (user_id, status);
`);
