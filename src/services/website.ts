import { config } from '../config.js';
import type { Case } from './cases.js';

/** Talks to the Ares website's /api/mod-bot with MOD_BOT_KEY. Off when the key isn't set. */
export type ReportStatus = 'pending' | 'resolved' | 'closed';
export interface WebsiteReport {
  id: number;
  reporterId: string;
  reporterName: string | null;
  reportedName: string;
  server: string;
  happenedAt: string;
  description: string;
  evidence: string[];
  status: ReportStatus;
  discordMessageId: string | null;
  cardStatus: ReportStatus | null;
  handledBy: string | null;
  handledAt: number | null;
  createdAt: number;
}

export const websiteEnabled = (): boolean => !!config.modBotKey;

async function call<T>(method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const response = await fetch(`${config.websiteUrl}/api/mod-bot`, {
    method,
    headers: { 'x-api-key': config.modBotKey!, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000)
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(`website ${method} -> ${response.status}${data.error ? `: ${data.error}` : ''}`);
  return data;
}

/** Reports whose Discord card is missing or out of date. */
export const reportsToSync = () => call<{ reports: WebsiteReport[] }>('GET').then((d) => d.reports);

export const cardShown = (id: number, cardStatus: ReportStatus, messageId?: string) =>
  call('POST', { type: 'card', id, cardStatus, ...(messageId ? { messageId } : {}) });

/** Records a Resolved/Close click. Returns the report as decided (possibly by someone else first). */
export const decideReport = (id: number, status: 'resolved' | 'closed', staffName: string) =>
  call<{ report: WebsiteReport }>('POST', { type: 'decide', id, status, staffName }).then((d) => d.report);

export const pushCase = (c: Case) => call('POST', { type: 'case', ...c });
