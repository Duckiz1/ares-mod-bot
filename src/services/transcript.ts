import { TICKET_TYPES, type Ticket, type TicketMessage } from './tickets.js';

const time = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

/**
 * Plain-text ticket transcript, oldest message first.
 * `forMember` leaves out internal staff notes (the copy DMed to the member).
 */
export function buildTranscript(ticket: Ticket, messages: TicketMessage[], forMember = false): string {
  const lines = [
    `Ares ticket #${ticket.id} · ${TICKET_TYPES[ticket.type].label}`,
    `Member: ${ticket.userName}`,
    `Opened by: ${ticket.openedBy === 'member' ? 'the member' : `staff (${ticket.openedBy})`}`,
    `Topic: ${ticket.topic}`,
    `Opened: ${time(ticket.createdAt)}`,
    ...(ticket.closedAt ? [`Closed: ${time(ticket.closedAt)} by ${ticket.closedBy ?? 'unknown'}${ticket.closeReason ? ` (${ticket.closeReason})` : ''}`] : []),
    '',
    ...messages
      .filter((m) => !(forMember && m.internal))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((m) => {
        const who = m.internal ? `[staff note] ${m.author}` : m.fromStaff ? `${m.author} (staff)` : m.author;
        const extra = m.attachments.length ? `\n    [attachments] ${m.attachments.join(' ')}` : '';
        return `[${time(m.createdAt)}] ${who}: ${m.content || '(no text)'}${extra}`;
      })
  ];
  return lines.join('\n') + '\n';
}
