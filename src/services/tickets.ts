import { db } from '../db.js';

/** Ticket types, in the order members see them. Each gets its own category in the staff server. */
export const TICKET_TYPES = {
  general: { label: 'General', emoji: '💬', description: 'Anything else you need help with' },
  report: { label: 'Report', emoji: '🚩', description: 'Report a player who broke the rules' },
  bug: { label: 'Bug Report', emoji: '🐞', description: 'Something on the server, bot or website is broken' },
  question: { label: 'Question', emoji: '❓', description: 'Ask staff a question' },
  staff: { label: 'Staff Help', emoji: '🛡️', description: 'Talk privately with Ares staff' }
} as const;
export type TicketType = keyof typeof TICKET_TYPES;
export const isTicketType = (value: string): value is TicketType => value in TICKET_TYPES;
export const categoryName = (type: TicketType) => `${TICKET_TYPES[type].label} Tickets`;

export interface Ticket {
  id: number;
  channelId: string;
  userId: string;
  userName: string;
  type: TicketType;
  topic: string;
  openedBy: string;
  status: 'open' | 'closed';
  createdAt: number;
  closedAt: number | null;
  closedBy: string | null;
  closeReason: string | null;
}
export interface TicketMessage {
  author: string;
  fromStaff: boolean;
  internal: boolean;
  content: string;
  attachments: string[];
  createdAt: number;
}

const SELECT = `SELECT id, channel_id AS channelId, user_id AS userId, user_name AS userName, type, topic, opened_by AS openedBy,
  status, created_at AS createdAt, closed_at AS closedAt, closed_by AS closedBy, close_reason AS closeReason FROM tickets`;

export const openTicketOf = (userId: string) =>
  db.prepare(`${SELECT} WHERE user_id = ? AND status = 'open'`).get(userId) as Ticket | undefined;
export const ticketByChannel = (channelId: string) =>
  db.prepare(`${SELECT} WHERE channel_id = ? AND status = 'open'`).get(channelId) as Ticket | undefined;
export const getTicket = (id: number) => db.prepare(`${SELECT} WHERE id = ?`).get(id) as Ticket | undefined;

/** Ticket numbers are known before the channel exists, so the channel can be named after them. */
export const nextTicketNumber = () =>
  ((db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'tickets'").get() as { seq: number } | undefined)?.seq ?? 0) + 1;

export function createTicket(input: { channelId: string; userId: string; userName: string; type: TicketType; topic: string; openedBy: string }): Ticket {
  const id = Number(db.prepare(`INSERT INTO tickets (channel_id, user_id, user_name, type, topic, opened_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(input.channelId, input.userId, input.userName, input.type, input.topic, input.openedBy, Date.now()).lastInsertRowid);
  return getTicket(id)!;
}

export function addTicketMessage(ticketId: number, m: Omit<TicketMessage, 'createdAt'> & { createdAt?: number }): void {
  db.prepare(`INSERT INTO ticket_messages (ticket_id, author, from_staff, internal, content, attachments, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(ticketId, m.author, m.fromStaff ? 1 : 0, m.internal ? 1 : 0, m.content,
    JSON.stringify(m.attachments), m.createdAt ?? Date.now());
}

export function ticketMessages(ticketId: number): TicketMessage[] {
  const rows = db.prepare(`SELECT author, from_staff AS fromStaff, internal, content, attachments, created_at AS createdAt
    FROM ticket_messages WHERE ticket_id = ? ORDER BY id`).all(ticketId) as Array<Omit<TicketMessage, 'attachments' | 'fromStaff' | 'internal'> & { attachments: string; fromStaff: number; internal: number }>;
  return rows.map((r) => ({ ...r, fromStaff: !!r.fromStaff, internal: !!r.internal, attachments: JSON.parse(r.attachments) as string[] }));
}

/** Marks a ticket closed; false if it was already closed (two people closing at once). */
export function markClosed(id: number, closedBy: string, reason: string | null): boolean {
  return db.prepare("UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = ?, close_reason = ? WHERE id = ? AND status = 'open'")
    .run(Date.now(), closedBy, reason, id).changes > 0;
}

/** e.g. "0042-report-hybrid" */
export function channelName(id: number, type: TicketType, userName: string): string {
  const name = userName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'member';
  return `${String(id).padStart(4, '0')}-${type}-${name}`.slice(0, 90);
}

/** A message in a ticket channel starting with this is a staff note: never sent to the member. */
export const NOTE_PREFIX = '//';
