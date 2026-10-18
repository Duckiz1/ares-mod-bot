import {
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type GuildMember,
  type User
} from 'discord.js';
import { addCase, caseCounts, casesFor, getCase, markSynced, unsyncedCases, updateReason, type Case, type CaseAction } from '../services/cases.js';
import { pushCase, websiteEnabled } from '../services/website.js';
import { Colors, EPHEMERAL, UserError, clip, isStaff, minutesText, notice, parseDuration, staffMember } from '../util.js';
import { caseEmbed, log } from './log.js';

const displayName = (user: User) => user.globalName ?? user.username;

/** Saves the case, logs it and copies it to the website (retried later if the website is down). */
export async function recordCase(client: Client, input: Omit<Case, 'number' | 'createdAt'>): Promise<Case> {
  const c = addCase(input);
  await log(client, caseEmbed(c));
  void syncCases().catch(() => undefined);
  return c;
}

let syncing = false;
export async function syncCases(): Promise<void> {
  if (!websiteEnabled() || syncing) return;
  syncing = true;
  try {
    for (const c of unsyncedCases()) {
      await pushCase(c);
      markSynced(c.number);
    }
  } finally {
    syncing = false;
  }
}

/** The member to act on, after checking it's allowed. */
async function target(i: ChatInputCommandInteraction, option: string, moderator: GuildMember): Promise<GuildMember> {
  const user = i.options.getUser(option, true);
  const member = await i.guild!.members.fetch(user.id).catch(() => null);
  if (!member) throw new UserError(`${displayName(user)} isn’t in the server.`);
  if (member.id === moderator.id) throw new UserError('You can’t do that to yourself.');
  if (member.id === i.client.user.id) throw new UserError('I can’t do that to myself.');
  if (isStaff(member)) throw new UserError('Staff can’t be moderated with the bot. Talk to an admin.');
  if (member.roles.highest.position >= moderator.roles.highest.position && moderator.id !== i.guild!.ownerId)
    throw new UserError(`${member.displayName} has a role as high as yours.`);
  return member;
}

/** Tells the member what happened; returns false if their DMs are closed. */
async function dm(user: User, title: string, lines: string[], color: number): Promise<boolean> {
  return user.send({ embeds: [notice(title, lines.join('\n'), color)] }).then(() => true).catch(() => false);
}

async function act(
  i: ChatInputCommandInteraction,
  action: CaseAction,
  member: { id: string; user: User },
  reason: string,
  moderator: GuildMember,
  duration: number | null,
  dmed: boolean
): Promise<void> {
  const c = await recordCase(i.client, {
    action, userId: member.id, userName: displayName(member.user), moderatorId: moderator.id,
    moderatorName: moderator.displayName, reason, duration
  });
  await i.editReply({ embeds: [caseEmbed(c).setFooter({ text: dmed ? 'They were sent a DM.' : 'Their DMs are closed, so they weren’t told by DM.' })] });
}

export async function moderationCommand(i: ChatInputCommandInteraction): Promise<void> {
  const moderator = await staffMember(i);
  const server = i.guild!.name;
  const reason = (i.options.getString('reason') ?? '').trim() || 'No reason given';

  if (i.commandName === 'warn') {
    const member = await target(i, 'member', moderator);
    await i.deferReply();
    const dmed = await dm(member.user, `You were warned in ${server}`, [`**Reason:** ${reason}`], Colors.warning);
    return act(i, 'warn', member, reason, moderator, null, dmed);
  }
  if (i.commandName === 'timeout') {
    const member = await target(i, 'member', moderator);
    const minutes = parseDuration(i.options.getString('length', true));
    if (!member.moderatable) throw new UserError(`I can’t time out ${member.displayName}: their role is above mine.`);
    await i.deferReply();
    await member.timeout(minutes * 60_000, clip(reason, 500));
    const dmed = await dm(member.user, `You were timed out in ${server}`, [`**Length:** ${minutesText(minutes)}`, `**Reason:** ${reason}`], Colors.warning);
    return act(i, 'timeout', member, reason, moderator, minutes, dmed);
  }
  if (i.commandName === 'untimeout') {
    const member = await target(i, 'member', moderator);
    if (!member.isCommunicationDisabled()) throw new UserError(`${member.displayName} isn’t timed out.`);
    await i.deferReply();
    await member.timeout(null, clip(reason, 500));
    return act(i, 'untimeout', member, reason, moderator, null, false);
  }
  if (i.commandName === 'kick') {
    const member = await target(i, 'member', moderator);
    if (!member.kickable) throw new UserError(`I can’t kick ${member.displayName}: their role is above mine.`);
    await i.deferReply();
    // Tell them first: once kicked we may no longer share a server.
    const dmed = await dm(member.user, `You were kicked from ${server}`, [`**Reason:** ${reason}`], Colors.danger);
    await member.kick(clip(reason, 500));
    return act(i, 'kick', member, reason, moderator, null, dmed);
  }
  if (i.commandName === 'ban') {
    const user = i.options.getUser('user', true);
    const member = await i.guild!.members.fetch(user.id).catch(() => null);
    if (member) {
      await target(i, 'user', moderator);
      if (!member.bannable) throw new UserError(`I can’t ban ${member.displayName}: their role is above mine.`);
    }
    if (await i.guild!.bans.fetch(user.id).catch(() => null)) throw new UserError(`${displayName(user)} is already banned.`);
    await i.deferReply();
    const dmed = member ? await dm(user, `You were banned from ${server}`, [`**Reason:** ${reason}`], Colors.danger) : false;
    const days = i.options.getInteger('delete_messages') ?? 0;
    await i.guild!.bans.create(user.id, { reason: clip(reason, 500), deleteMessageSeconds: days * 86400 });
    return act(i, 'ban', { id: user.id, user }, reason, moderator, null, dmed);
  }
  if (i.commandName === 'unban') {
    const userId = i.options.getString('user_id', true).trim();
    if (!/^\d{5,25}$/.test(userId)) throw new UserError('That isn’t a Discord user ID (right-click them → Copy User ID).');
    const ban = await i.guild!.bans.fetch(userId).catch(() => null);
    if (!ban) throw new UserError('That user isn’t banned.');
    await i.deferReply();
    await i.guild!.bans.remove(userId, clip(reason, 500));
    return act(i, 'unban', { id: userId, user: ban.user }, reason, moderator, null, false);
  }
  if (i.commandName === 'cases') {
    const user = i.options.getUser('user', true);
    const list = casesFor(user.id, 15);
    const counts = caseCounts(user.id);
    const summary = Object.entries(counts).map(([action, n]) => `${n} ${action}`).join(' · ') || 'No cases';
    const embed = new EmbedBuilder().setTitle(clip(`Cases for ${displayName(user)}`, 256)).setColor(Colors.info)
      .setDescription(clip([summary, '', ...list.map((c) =>
        `**#${c.number}** ${c.action}${c.duration ? ` (${minutesText(c.duration)})` : ''} · <t:${Math.floor(c.createdAt / 1000)}:d> · ${clip(c.reason, 120)}`)].join('\n'), 4000));
    await i.reply({ embeds: [embed], flags: EPHEMERAL });
    return;
  }
  if (i.commandName === 'case') {
    const number = i.options.getInteger('number', true);
    if (i.options.getSubcommand() === 'reason') {
      if (!getCase(number)) throw new UserError(`There’s no case #${number}.`);
      const c = updateReason(number, i.options.getString('reason', true))!;
      void syncCases().catch(() => undefined);
      await log(i.client, caseEmbed(c).setFooter({ text: `Reason edited by ${moderator.displayName}` }));
      await i.reply({ embeds: [caseEmbed(c)], flags: EPHEMERAL });
      return;
    }
    const c = getCase(number);
    if (!c) throw new UserError(`There’s no case #${number}.`);
    await i.reply({ embeds: [caseEmbed(c)], flags: EPHEMERAL });
    return;
  }
  if (i.commandName === 'purge') {
    const channel = i.channel;
    if (!channel || !('bulkDelete' in channel)) throw new UserError('Use this in a text channel.');
    const count = i.options.getInteger('count', true);
    const from = i.options.getUser('from');
    await i.deferReply({ flags: EPHEMERAL });
    const fetched = await channel.messages.fetch({ limit: 100 });
    const pick = [...fetched.values()].filter((m) => !from || m.author.id === from.id).slice(0, count);
    // Discord can only bulk-delete messages from the last 14 days.
    const deleted = await channel.bulkDelete(pick, true);
    await log(i.client, notice('Messages purged', `${moderator.displayName} deleted ${deleted.size} message(s) in <#${channel.id}>${from ? ` from ${displayName(from)}` : ''}.`, Colors.muted));
    await i.editReply(`Deleted ${deleted.size} message(s).${deleted.size < pick.length ? ' Messages older than 14 days can’t be bulk-deleted.' : ''}`);
  }
}
