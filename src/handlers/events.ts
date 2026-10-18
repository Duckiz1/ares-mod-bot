import type { Client, GuildMember, Message, PartialGuildMember, PartialMessage } from 'discord.js';
import { config } from '../config.js';
import { SpamTracker, checkMessage } from '../services/automod.js';
import { Colors, clip, isStaff, minutesText, notice } from '../util.js';
import { log } from './log.js';
import { recordCase } from './moderation.js';

const inAres = (guildId: string | null | undefined) => guildId === config.guildId;
const skipChannel = (channelId: string) => channelId === config.logChannelId;

export async function onMessageDelete(client: Client, m: Message | PartialMessage): Promise<void> {
  if (!inAres(m.guildId) || skipChannel(m.channelId) || m.author?.bot) return;
  const author = m.author ? `${m.author.tag} (<@${m.author.id}>)` : 'Unknown (message was sent before the bot started)';
  const content = m.content ? clip(m.content, 1500) : '*(no text, or not cached)*';
  const files = m.attachments?.size ? `\n**Attachments:** ${[...m.attachments.values()].map((a) => a.name).join(', ')}` : '';
  await log(client, notice('Message deleted', `**Author:** ${author}\n**Channel:** <#${m.channelId}>\n**Content:** ${content}${files}`, Colors.muted));
}

export async function onMessageUpdate(client: Client, before: Message | PartialMessage, after: Message | PartialMessage): Promise<void> {
  if (!inAres(after.guildId) || skipChannel(after.channelId) || after.author?.bot) return;
  if (before.partial || before.content === after.content) return; // embeds loading, or not cached
  await log(client, notice('Message edited', [
    `**Author:** ${after.author?.tag} (<@${after.author?.id}>) · [jump to message](${after.url})`,
    `**Channel:** <#${after.channelId}>`,
    `**Before:** ${clip(before.content || '*(empty)*', 1000)}`,
    `**After:** ${clip(after.content || '*(empty)*', 1000)}`
  ].join('\n'), Colors.info));
}

export async function onMemberJoin(client: Client, member: GuildMember): Promise<void> {
  if (!inAres(member.guild.id)) return;
  const created = Math.floor(member.user.createdTimestamp / 1000);
  const newAccount = Date.now() - member.user.createdTimestamp < 7 * 86400000;
  await log(client, notice('Member joined', [
    `${member.user.tag} (<@${member.id}>, ${member.id})`,
    `**Account created:** <t:${created}:R>${newAccount ? ' ⚠️ new account' : ''}`,
    `**Members now:** ${member.guild.memberCount}`
  ].join('\n'), newAccount ? Colors.warning : Colors.success));
}

export async function onMemberLeave(client: Client, member: GuildMember | PartialGuildMember): Promise<void> {
  if (!inAres(member.guild.id)) return;
  const joined = member.joinedTimestamp ? ` · joined <t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '';
  await log(client, notice('Member left', `${member.user?.tag ?? 'Unknown'} (<@${member.id}>, ${member.id})${joined}`, Colors.muted));
}

const spam = new SpamTracker(config.automod.spamCount, config.automod.spamSeconds * 1000);

/** Automod: spam and mass mentions get a timeout and a case; invites/links are deleted with a short notice. */
export async function onMessage(client: Client, m: Message): Promise<void> {
  if (!inAres(m.guildId) || m.author.bot || !m.member || m.system) return;
  if (isStaff(m.member)) return;
  const verdict = checkMessage(
    { content: m.content, mentions: m.mentions.users.size + m.mentions.roles.size, spamming: spam.record(m.author.id) },
    config.automod
  );
  if (!verdict) return;
  await m.delete().catch(() => undefined);
  if (verdict.timeout) {
    spam.reset(m.author.id);
    const minutes = config.automod.timeoutMinutes;
    if (!m.member.moderatable) return;
    await m.member.timeout(minutes * 60_000, verdict.reason).catch(() => undefined);
    await recordCase(client, {
      action: 'automod', userId: m.author.id, userName: m.author.globalName ?? m.author.username,
      moderatorId: client.user!.id, moderatorName: 'Automod', reason: verdict.reason, duration: minutes
    });
    if (m.channel.isSendable())
      await m.channel.send({ content: `<@${m.author.id}> was timed out for ${minutesText(minutes)} (${verdict.rule === 'spam' ? 'spam' : 'mass mentions'}).`, allowedMentions: { parse: [] } })
        .then((n) => setTimeout(() => void n.delete().catch(() => undefined), 10_000)).catch(() => undefined);
    return;
  }
  await log(client, notice('Automod removed a message', `**Author:** ${m.author.tag} (<@${m.author.id}>)\n**Channel:** <#${m.channelId}>\n**Why:** ${verdict.reason}\n**Content:** ${clip(m.content, 1500)}`, Colors.warning));
  if (m.channel.isSendable())
    await m.channel.send({ content: `<@${m.author.id}>, ${verdict.rule === 'invite' ? 'Discord invite links aren’t allowed here' : 'that link isn’t allowed here'}.`, allowedMentions: { users: [m.author.id] } })
      .then((n) => setTimeout(() => void n.delete().catch(() => undefined), 8_000)).catch(() => undefined);
}
