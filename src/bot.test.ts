import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpamTracker, blockedLinks, checkMessage, hasInvite } from './services/automod.js';
import { buildTranscript } from './services/transcript.js';
import {
  TICKET_TYPES,
  addTicketMessage,
  categoryName,
  channelName,
  createTicket,
  getTicket,
  isTicketType,
  markClosed,
  nextTicketNumber,
  openTicketOf,
  ticketByChannel,
  ticketMessages
} from './services/tickets.js';
import { addCase, caseCounts, casesFor, markSynced, unsyncedCases, updateReason } from './services/cases.js';
import { minutesText, parseDuration } from './util.js';
import { reportCard } from './handlers/reports.js';
import type { WebsiteReport } from './services/website.js';

const rules = { blockInvites: true, blockLinks: false, allowedDomains: ['aresfleet.com', 'youtube.com'], maxMentions: 5 };

describe('automod', () => {
  it('flags a member who sends too many messages in the window, then forgets old ones', () => {
    const spam = new SpamTracker(3, 1000);
    expect(spam.record('a', 0)).toBe(false);
    expect(spam.record('a', 100)).toBe(false);
    expect(spam.record('b', 150)).toBe(false);
    expect(spam.record('a', 200)).toBe(true);
    expect(spam.record('a', 5000)).toBe(false);
  });

  it('finds invites and links that are not allowed', () => {
    expect(hasInvite('join discord.gg/abc123 now')).toBe(true);
    expect(hasInvite('https://discord.com/invite/xyz')).toBe(true);
    expect(hasInvite('i like discord')).toBe(false);
    expect(blockedLinks('see https://aresfleet.com/x and https://www.youtube.com/watch?v=1', rules.allowedDomains)).toEqual([]);
    expect(blockedLinks('free stuff https://evil.example/claim', rules.allowedDomains)).toEqual(['evil.example']);
    expect(blockedLinks('https://aresfleet.com.evil.example', rules.allowedDomains)).toEqual(['aresfleet.com.evil.example']);
  });

  it('picks the right rule: spam and mass mentions time out, invites and links only delete', () => {
    expect(checkMessage({ content: 'hi', mentions: 0, spamming: true }, rules)).toMatchObject({ rule: 'spam', timeout: true });
    expect(checkMessage({ content: 'hi', mentions: 6, spamming: false }, rules)).toMatchObject({ rule: 'mentions', timeout: true });
    expect(checkMessage({ content: 'discord.gg/x', mentions: 0, spamming: false }, rules)).toMatchObject({ rule: 'invite', timeout: false });
    expect(checkMessage({ content: 'https://evil.example', mentions: 0, spamming: false }, rules)).toBeNull();
    expect(checkMessage({ content: 'https://evil.example', mentions: 0, spamming: false }, { ...rules, blockLinks: true }))
      .toMatchObject({ rule: 'link' });
    expect(checkMessage({ content: 'discord.gg/x', mentions: 0, spamming: false }, { ...rules, blockInvites: false })).toBeNull();
  });
});

describe('timeout lengths', () => {
  it('reads minutes, hours and days up to 28 days', () => {
    expect(parseDuration('10')).toBe(10);
    expect(parseDuration('10m')).toBe(10);
    expect(parseDuration('2h')).toBe(120);
    expect(parseDuration('1h30m')).toBe(90);
    expect(parseDuration('1d')).toBe(1440);
    expect(() => parseDuration('29d')).toThrow(/28 days/);
    expect(() => parseDuration('soon')).toThrow(/10m/);
    expect(() => parseDuration('5x')).toThrow(/10m/);
    expect(minutesText(1530)).toBe('1d 1h 30m');
  });
});

describe('cases', () => {
  it('numbers cases, keeps a per-member history and tracks what reached the website', () => {
    const base = { userId: '200', userName: 'Spammer', moderatorId: '300', moderatorName: 'Mod', duration: null };
    const a = addCase({ ...base, action: 'warn', reason: 'Spam' });
    const b = addCase({ ...base, action: 'timeout', reason: '', duration: 10 });
    addCase({ ...base, userId: '201', action: 'ban', reason: 'Cheating' });
    expect(b.number).toBe(a.number + 1);
    expect(b.reason).toBe('No reason given');
    expect(casesFor('200').map((c) => c.number)).toEqual([b.number, a.number]);
    expect(caseCounts('200')).toEqual({ warn: 1, timeout: 1 });
    expect(unsyncedCases().length).toBe(3);
    markSynced(a.number);
    expect(unsyncedCases().map((c) => c.number)).not.toContain(a.number);
    expect(updateReason(a.number, 'Spam in #general')!.reason).toBe('Spam in #general');
    expect(unsyncedCases().map((c) => c.number)).toContain(a.number); // edited reasons are re-sent
  });
});

describe('report cards', () => {
  const report: WebsiteReport = {
    id: 7, reporterId: '400', reporterName: 'Reporter', reportedName: 'Griefer', server: 'Ares Alpha', happenedAt: 'yesterday',
    description: 'Team killing at spawn.', evidence: ['https://youtu.be/a', 'https://imgur.com/b'], status: 'pending',
    discordMessageId: null, cardStatus: null, handledBy: null, handledAt: null, createdAt: 1700000000000
  };
  const buttons = (card: ReturnType<typeof reportCard>) =>
    (card.components![0] as { toJSON(): { components: Array<{ label?: string; custom_id?: string }> } }).toJSON().components;

  it('shows Resolved / Close while pending, and never pings', () => {
    const card = reportCard(report);
    expect(buttons(card).map((b) => b.custom_id)).toEqual(['report:resolved:7', 'report:closed:7', undefined]);
    expect(card.allowedMentions).toEqual({ parse: [] });
    const embed = (card.embeds![0] as { toJSON(): { fields: Array<{ name: string; value: string }> } }).toJSON();
    expect(embed.fields.find((f) => f.name === 'Evidence')!.value).toBe('[Link 1](https://youtu.be/a)\n[Link 2](https://imgur.com/b)');
  });

  it('drops the buttons and shows who decided once handled', () => {
    const card = reportCard({ ...report, status: 'closed', handledBy: 'Mod A' });
    expect(buttons(card).map((b) => b.label)).toEqual(['Open dashboard']);
    const embed = (card.embeds![0] as { toJSON(): { fields: Array<{ name: string; value: string }>; color: number } }).toJSON();
    expect(embed.fields.at(-1)!.value).toBe('Closed: no valid evidence to punish (by Mod A)');
  });
});

describe('tickets', () => {
  it('keeps one open ticket per member, a full message log and a closed state', () => {
    const t = createTicket({ channelId: 'chan-1', userId: 'member-1', userName: 'Member', type: 'bug', topic: 'Map is broken', openedBy: 'member' });
    expect(openTicketOf('member-1')?.id).toBe(t.id);
    expect(ticketByChannel('chan-1')?.type).toBe('bug');
    addTicketMessage(t.id, { author: 'Member', fromStaff: false, internal: false, content: 'Map is broken', attachments: [], createdAt: 1000 });
    addTicketMessage(t.id, { author: 'Mod A', fromStaff: true, internal: true, content: 'probably the new patch', attachments: [], createdAt: 2000 });
    addTicketMessage(t.id, { author: 'Mod A', fromStaff: true, internal: false, content: 'Thanks, we’re on it', attachments: ['https://cdn/x.png'], createdAt: 3000 });
    expect(ticketMessages(t.id).map((m) => [m.author, m.internal])).toEqual([['Member', false], ['Mod A', true], ['Mod A', false]]);
    expect(markClosed(t.id, 'Mod A', 'Fixed')).toBe(true);
    expect(markClosed(t.id, 'Mod B', null)).toBe(false); // already closed
    expect(openTicketOf('member-1')).toBeUndefined();
    expect(getTicket(t.id)).toMatchObject({ status: 'closed', closedBy: 'Mod A', closeReason: 'Fixed' });
  });

  it('names channels by number, type and member, and knows the next number', () => {
    expect(channelName(42, 'report', 'Hybrid Dash!!')).toBe('0042-report-hybrid-dash');
    expect(channelName(7, 'staff', '???')).toBe('0007-staff-member');
    const next = nextTicketNumber();
    expect(createTicket({ channelId: 'chan-2', userId: 'member-2', userName: 'M2', type: 'general', topic: 'Hi', openedBy: 'Mod A' }).id).toBe(next);
    expect(categoryName('bug')).toBe('Bug Report Tickets');
    expect(Object.values(TICKET_TYPES).map((t) => t.label)).toEqual(['General', 'Report', 'Bug Report', 'Question', 'Staff Help']);
    expect(isTicketType('report')).toBe(true);
    expect(isTicketType('spam')).toBe(false);
  });

  it('transcripts list messages in order, and the member’s copy leaves out staff notes', () => {
    const t = createTicket({ channelId: 'chan-3', userId: 'member-3', userName: 'Member', type: 'question', topic: 'How do I join?', openedBy: 'member' });
    addTicketMessage(t.id, { author: 'Mod A', fromStaff: true, internal: false, content: 'Use the Join button', attachments: [], createdAt: 2000 });
    addTicketMessage(t.id, { author: 'Member', fromStaff: false, internal: false, content: '', attachments: ['https://cdn/x.png'], createdAt: 1000 });
    addTicketMessage(t.id, { author: 'Mod B', fromStaff: true, internal: true, content: 'they asked last week too', attachments: [], createdAt: 3000 });
    markClosed(t.id, 'Mod A', null);
    const ticket = getTicket(t.id)!;
    const staffCopy = buildTranscript(ticket, ticketMessages(t.id));
    const memberCopy = buildTranscript(ticket, ticketMessages(t.id), true);
    expect(staffCopy.split('\n')[0]).toBe(`Ares ticket #${t.id} · Question`);
    expect(staffCopy.indexOf('Member: (no text)')).toBeLessThan(staffCopy.indexOf('Mod A (staff): Use the Join button'));
    expect(staffCopy).toContain('[staff note] Mod B: they asked last week too');
    expect(staffCopy).toContain('    [attachments] https://cdn/x.png');
    expect(memberCopy).not.toContain('staff note');
    expect(memberCopy).toContain('Use the Join button');
  });
});
describe('website calls', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sends the key and the right request bodies', async () => {
    process.env.MOD_BOT_KEY = 'k'.repeat(64);
    vi.resetModules();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ reports: [], report: { id: 1, status: 'resolved' } }), { status: 200 });
    });
    const site = await import('./services/website.js');
    await site.reportsToSync();
    await site.decideReport(1, 'resolved', 'Mod A');
    await site.cardShown(1, 'resolved', '123456');
    expect(calls[0].url).toBe('https://aresfleet.com/api/mod-bot');
    expect((calls[0].init.headers as Record<string, string>)['x-api-key']).toBe('k'.repeat(64));
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ type: 'decide', id: 1, status: 'resolved', staffName: 'Mod A' });
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ type: 'card', id: 1, cardStatus: 'resolved', messageId: '123456' });
  });
});
