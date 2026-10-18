import type { AttachmentBuilder, Client, EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { Colors, notice } from '../util.js';
import type { Case } from '../services/cases.js';
import { minutesText } from '../util.js';

/** Posts to the log channel (or another channel), never pinging anyone. Failures are only printed. */
export async function log(client: Client, embed: EmbedBuilder, files: AttachmentBuilder[] = [], channelId = config.logChannelId): Promise<void> {
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return;
  await channel.send({ embeds: [embed.setTimestamp()], files, allowedMentions: { parse: [] } }).catch((e) => console.error('[log]', e));
}

const ACTION = {
  warn: ['Warned', Colors.warning], timeout: ['Timed out', Colors.warning], untimeout: ['Timeout removed', Colors.success],
  kick: ['Kicked', Colors.danger], ban: ['Banned', Colors.danger], unban: ['Unbanned', Colors.success], automod: ['Automod', Colors.info]
} as const;

export function caseEmbed(c: Case): EmbedBuilder {
  const [label, color] = ACTION[c.action as keyof typeof ACTION] ?? [c.action, Colors.info];
  return notice(`Case #${c.number} · ${label}`, [
    `**Member:** ${c.userName} (<@${c.userId}>, ${c.userId})`,
    `**Moderator:** ${c.moderatorName}`,
    ...(c.duration ? [`**Length:** ${minutesText(c.duration)}`] : []),
    `**Reason:** ${c.reason}`,
    `**When:** <t:${Math.floor(c.createdAt / 1000)}:f>`
  ].join('\n'), color);
}
