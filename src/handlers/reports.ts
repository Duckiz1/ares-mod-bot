import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  DiscordAPIError,
  EmbedBuilder,
  type ButtonInteraction,
  type Client,
  type MessageCreateOptions
} from 'discord.js';
import { config } from '../config.js';
import { cardShown, decideReport, reportsToSync, websiteEnabled, type WebsiteReport } from '../services/website.js';
import { clip, staffMember } from '../util.js';

const COLOR = { pending: 0xf0a020, resolved: 0x2ecc71, closed: 0x7f8c8d } as const;
const OUTCOME = {
  pending: 'Waiting for staff',
  resolved: 'Resolved: the player was punished',
  closed: 'Closed: no valid evidence to punish'
} as const;

/** The staff card for a website report. Buttons only while it's pending. */
export function reportCard(r: WebsiteReport): Pick<MessageCreateOptions, 'embeds' | 'components' | 'allowedMentions'> {
  const embed = new EmbedBuilder()
    .setTitle(`Website report #${r.id}`)
    .setColor(COLOR[r.status])
    .addFields(
      { name: 'Reported player', value: clip(r.reportedName, 256), inline: true },
      { name: 'Server', value: clip(r.server, 256), inline: true },
      { name: 'When', value: clip(r.happenedAt, 256), inline: true },
      { name: 'Reported by', value: `${clip(r.reporterName ?? 'Unknown', 100)} (<@${r.reporterId}>)` },
      { name: 'What happened', value: clip(r.description, 1024) },
      { name: 'Evidence', value: clip(r.evidence.map((link, n) => `[Link ${n + 1}](${link})`).join('\n') || 'None', 1024) },
      { name: 'Status', value: r.status === 'pending' ? OUTCOME.pending : `${OUTCOME[r.status]} (by ${clip(r.handledBy ?? 'staff', 100)})` }
    )
    .setFooter({ text: 'Resolved = player punished · Close = no valid evidence' })
    .setTimestamp(r.createdAt);
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (r.status === 'pending')
    row.addComponents(
      new ButtonBuilder().setCustomId(`report:resolved:${r.id}`).setLabel('Resolved').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`report:closed:${r.id}`).setLabel('Close').setStyle(ButtonStyle.Danger)
    );
  row.addComponents(new ButtonBuilder().setLabel('Open dashboard').setStyle(ButtonStyle.Link).setURL(`${config.websiteUrl}/admin`));
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

const UNKNOWN_MESSAGE = 10008;

/** Posts new reports and refreshes cards whose report was decided on the website. Runs every 30 seconds. */
export async function syncReports(client: Client): Promise<void> {
  if (!websiteEnabled() || !config.reportsChannelId) return;
  const channel = await client.channels.fetch(config.reportsChannelId);
  if (!channel?.isSendable() || !('messages' in channel)) throw new Error('REPORTS_CHANNEL_ID is not a text channel the bot can post in');
  for (const report of await reportsToSync()) {
    if (report.discordMessageId) {
      try {
        const message = await channel.messages.fetch(report.discordMessageId);
        await message.edit(reportCard(report));
        await cardShown(report.id, report.status);
        continue;
      } catch (error) {
        // Card deleted in Discord: post a fresh one below.
        if (!(error instanceof DiscordAPIError && error.code === UNKNOWN_MESSAGE)) throw error;
      }
    }
    const message = await channel.send(reportCard(report));
    await cardShown(report.id, report.status, message.id);
  }
}

/** Resolved / Close buttons: staff only. The website decides who was first. */
export async function handleReportButton(i: ButtonInteraction, status: string, rawId: string): Promise<void> {
  const member = await staffMember(i);
  if (status !== 'resolved' && status !== 'closed') return;
  await i.deferUpdate();
  const report = await decideReport(Number(rawId), status, member.displayName);
  await i.editReply(reportCard(report));
  await cardShown(report.id, report.status);
}
