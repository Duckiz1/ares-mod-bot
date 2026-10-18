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

-- DM tickets: the member talks to the bot in DMs; staff answer in a channel in the staff server.
-- One open ticket per member.
CREATE TABLE IF NOT EXISTS tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL,
  user_name   TEXT NOT NULL,
  type        TEXT NOT NULL,
  topic       TEXT NOT NULL,
  -- 'member', or the staff member's name when staff opened it
  opened_by   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  INTEGER NOT NULL,
  closed_at   INTEGER,
  closed_by   TEXT,
  close_reason TEXT
);
CREATE INDEX IF NOT EXISTS tickets_open ON tickets (user_id, status);

-- Every message in a ticket, for the transcript. internal = staff note that was never sent to the member.
CREATE TABLE IF NOT EXISTS ticket_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author      TEXT NOT NULL,
  from_staff  INTEGER NOT NULL,
  internal    INTEGER NOT NULL DEFAULT 0,
  content     TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket ON ticket_messages (ticket_id, id);
`);
