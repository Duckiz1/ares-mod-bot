import { db } from '../db.js';

export const ACTIONS = ['warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'automod'] as const;
export type CaseAction = (typeof ACTIONS)[number];
export interface Case {
  number: number;
  action: CaseAction;
  userId: string;
  userName: string;
  moderatorId: string;
  moderatorName: string;
  reason: string;
  duration: number | null;
  createdAt: number;
}
const SELECT = `SELECT number, action, user_id AS userId, user_name AS userName, moderator_id AS moderatorId,
  moderator_name AS moderatorName, reason, duration, created_at AS createdAt FROM cases`;

export function addCase(input: Omit<Case, 'number' | 'createdAt'> & { createdAt?: number }): Case {
  const createdAt = input.createdAt ?? Date.now();
  const number = Number(db.prepare(`INSERT INTO cases (action, user_id, user_name, moderator_id, moderator_name, reason, duration, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(input.action, input.userId, input.userName, input.moderatorId, input.moderatorName,
    input.reason.trim() || 'No reason given', input.duration, createdAt).lastInsertRowid);
  return getCase(number)!;
}

export function getCase(number: number): Case | undefined {
  return db.prepare(`${SELECT} WHERE number = ?`).get(number) as Case | undefined;
}

export function casesFor(userId: string, limit = 25): Case[] {
  return db.prepare(`${SELECT} WHERE user_id = ? ORDER BY number DESC LIMIT ?`).all(userId, limit) as Case[];
}

export function caseCounts(userId: string): Record<string, number> {
  const rows = db.prepare('SELECT action, COUNT(*) AS c FROM cases WHERE user_id = ? GROUP BY action').all(userId) as Array<{ action: string; c: number }>;
  return Object.fromEntries(rows.map((r) => [r.action, r.c]));
}

/** Cases not yet copied to the website (retried until the website accepts them). */
export function unsyncedCases(limit = 50): Case[] {
  return db.prepare(`${SELECT} WHERE synced = 0 ORDER BY number LIMIT ?`).all(limit) as Case[];
}

export function markSynced(number: number): void {
  db.prepare('UPDATE cases SET synced = 1 WHERE number = ?').run(number);
}

export function updateReason(number: number, reason: string): Case | undefined {
  db.prepare('UPDATE cases SET reason = ?, synced = 0 WHERE number = ?').run(reason.trim() || 'No reason given', number);
  return getCase(number);
}
