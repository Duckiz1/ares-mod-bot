export interface TranscriptMessage {
  author: string;
  bot: boolean;
  createdAt: number;
  content: string;
  attachments: string[];
}

/** Plain-text ticket transcript, oldest message first. */
export function buildTranscript(
  ticket: { id: number; userName: string; topic: string; createdAt: number },
  messages: TranscriptMessage[],
  closedBy: string,
  closedAt = Date.now()
): string {
  const time = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const lines = [
    `Ares ticket #${ticket.id}`,
    `Opened by: ${ticket.userName}`,
    `Topic: ${ticket.topic}`,
    `Opened: ${time(ticket.createdAt)}`,
    `Closed: ${time(closedAt)} by ${closedBy}`,
    '',
    ...[...messages]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((m) => {
        const extra = m.attachments.length ? `\n    [attachments] ${m.attachments.join(' ')}` : '';
        return `[${time(m.createdAt)}] ${m.author}${m.bot ? ' (bot)' : ''}: ${m.content || '(no text)'}${extra}`;
      })
  ];
  return lines.join('\n') + '\n';
}
