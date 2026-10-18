import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type CategoryChannel,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
  type User
} from 'discord.js';
import { config } from '../config.js';
import {
  NOTE_PREFIX,
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
  ticketMessages,
  type Ticket,
  type TicketType
} from '../services/tickets.js';
import { buildTranscript } from '../services/transcript.js';
import { Colors, EPHEMERAL, UserError, clip, notice, staffMember } from '../util.js';
import { log } from './log.js';

const name = (user: User) => user.globalName ?? user.username;
const TYPE_COLOR: Record<TicketType, number> = { general: Colors.info, report: Colors.danger, bug: Colors.warning, question: 0x9b59b6, staff: 0x3831ed };

// ---- Opening (member side) ----

/** "Open a ticket" panel in the main server. */
export async function ticketPanel(i: ChatInputCommandInteraction): Promise<void> {
  await staffMember(i);
  if (!i.channel?.isSendable()) throw new UserError('Use this in a text channel.');
  await i.channel.send({
    embeds: [notice('Need help from Ares staff?', 'Press the button and pick what it’s about. You’ll talk to staff privately in your DMs with this bot.', Colors.info)],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('ticket:open').setLabel('Open a ticket').setStyle(ButtonStyle.Primary)
    )]
  });
  await i.reply({ content: 'Ticket panel posted.', flags: EPHEMERAL });
}

const typePicker = () => new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
  new StringSelectMenuBuilder().setCustomId('ticket:type').setPlaceholder('What is your ticket about?').addOptions(
    Object.entries(TICKET_TYPES).map(([value, t]) => ({ value, label: t.label, description: t.description, emoji: t.emoji }))
  )
);

async function assertNoOpenTicket(client: Client, userId: string): Promise<void> {
  const open = openTicketOf(userId);
  if (!open) return;
  // A staff member deleted the channel by hand: treat that ticket as closed.
  if (!(await client.channels.fetch(open.channelId).catch(() => null))) {
    markClosed(open.id, 'channel deleted', null);
    return;
  }
  throw new UserError(`You already have an open ticket (#${open.id}). Just send your messages in your DMs with me.`);
}

/** Button on the panel, or the first DM from someone without a ticket: show the type picker. */
export async function openTicketButton(i: ButtonInteraction): Promise<void> {
  await assertNoOpenTicket(i.client, i.user.id);
  await i.reply({ content: 'What is your ticket about?', components: [typePicker()], flags: i.inGuild() ? EPHEMERAL : undefined });
}

export async function ticketTypeSelected(i: StringSelectMenuInteraction): Promise<void> {
  const type = i.values[0];
  if (!isTicketType(type)) return;
  await assertNoOpenTicket(i.client, i.user.id);
  await i.showModal(new ModalBuilder().setCustomId(`ticket:create:${type}`).setTitle(`${TICKET_TYPES[type].label} ticket`).addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId('topic').setLabel('Tell staff what this is about').setStyle(TextInputStyle.Paragraph)
        .setMinLength(5).setMaxLength(1000).setRequired(true)
    )
  ));
}

export async function ticketModal(i: ModalSubmitInteraction, type: string): Promise<void> {
  if (!isTicketType(type)) return;
  await assertNoOpenTicket(i.client, i.user.id);
  const topic = i.fields.getTextInputValue('topic').trim();
  await i.deferReply({ flags: i.inGuild() ? EPHEMERAL : undefined });
  // The conversation happens in DMs, so make sure we can reach them before creating anything.
  const dm = await i.user.createDM();
  const ticket = await startTicket(i.client, i.user, type, topic, 'member', async (t) => {
    await dm.send(memberOpenedMessage(t));
  });
  await i.editReply(i.inGuild()
    ? `Ticket #${ticket.id} is open. Check your DMs: everything you send me there goes to Ares staff.`
    : `Ticket #${ticket.id} is open. Send your messages here and Ares staff will reply.`);
}

function closeButton(ticketId: number, label = 'Close ticket') {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ticket:userclose:${ticketId}`).setLabel(label).setStyle(ButtonStyle.Secondary)
  );
}

function memberOpenedMessage(t: Ticket) {
  return {
    embeds: [notice(`Ticket #${t.id} · ${TICKET_TYPES[t.type].label}`,
      `**Topic:** ${t.topic}\n\nStaff will reply here. Send your messages, screenshots or videos in this DM and they’ll be passed on. You’ll see ✅ when a message reaches staff.`,
      TYPE_COLOR[t.type])],
    components: [closeButton(t.id)]
  };
}

// ---- Staff server ----

async function staffGuild(client: Client): Promise<Guild> {
  const guild = await client.guilds.fetch(config.staffGuildId).catch(() => null);
  if (!guild) throw new UserError('The ticket system isn’t set up yet: the bot isn’t in the staff server. Please tell an admin.');
  return guild;
}

/** "Report Tickets" etc., created on first use. */
async function categoryFor(guild: Guild, type: TicketType): Promise<CategoryChannel> {
  const wanted = categoryName(type).toLowerCase();
  const channels = await guild.channels.fetch();
  const found = channels.find((c) => c?.type === ChannelType.GuildCategory && c.name.toLowerCase() === wanted);
  if (found) return found as CategoryChannel;
  return guild.channels.create({ name: categoryName(type), type: ChannelType.GuildCategory });
}

/** Creates the staff channel and the ticket. `greet` messages the member; if their DMs are closed nothing is kept. */
async function startTicket(client: Client, user: User, type: TicketType, topic: string, openedBy: string,
  greet: (t: Ticket) => Promise<unknown>): Promise<Ticket> {
  const guild = await staffGuild(client);
  const category = await categoryFor(guild, type);
  const channel = await guild.channels.create({
    name: channelName(nextTicketNumber(), type, user.username),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: clip(`${TICKET_TYPES[type].label} ticket · ${user.tag} (${user.id}) · ${topic}`, 1024)
  });
  const ticket = createTicket({ channelId: channel.id, userId: user.id, userName: name(user), type, topic, openedBy });
  try {
    await greet(ticket);
  } catch {
    markClosed(ticket.id, 'not sent', 'Member’s DMs are closed');
    await channel.delete('Member’s DMs are closed').catch(() => undefined);
    throw new UserError(openedBy === 'member'
      ? 'I can’t DM you. Turn on Server Settings → Privacy → Direct Messages for the Ares server, then try again.'
      : `I can’t DM ${name(user)}: their DMs are closed, so no ticket was opened.`);
  }
  await channel.send({
    embeds: [new EmbedBuilder()
      .setTitle(`Ticket #${ticket.id} · ${TICKET_TYPES[type].label}`)
      .setColor(TYPE_COLOR[type])
      .setThumbnail(user.displayAvatarURL())
      .setDescription([
        `**Member:** ${user.tag} (<@${user.id}>, ${user.id})`,
        `**Account created:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
        `**Opened by:** ${openedBy === 'member' ? 'the member' : openedBy}`,
        `**Topic:** ${topic}`,
        '',
        `Messages you send here go to the member’s DMs (✅ = delivered). Start a message with \`${NOTE_PREFIX}\` to keep it as a staff note.`
      ].join('\n'))],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('ticket:close').setLabel('Close ticket').setStyle(ButtonStyle.Danger)
    )],
    allowedMentions: { parse: [] }
  });
  addTicketMessage(ticket.id, { author: openedBy === 'member' ? ticket.userName : openedBy, fromStaff: openedBy !== 'member', internal: false, content: topic, attachments: [] });
  await log(client, notice(`Ticket #${ticket.id} opened · ${TICKET_TYPES[type].label}`, `**Member:** ${user.tag} (<@${user.id}>)\n**Opened by:** ${openedBy === 'member' ? 'the member' : openedBy}\n**Channel:** <#${channel.id}>\n**Topic:** ${topic}`, TYPE_COLOR[type]), [], config.ticketLogChannelId);
  return ticket;
}

/** /ticket open | close (staff server). */
export async function ticketCommand(i: ChatInputCommandInteraction): Promise<void> {
  if (i.options.getSubcommand() === 'close') {
    const ticket = ticketByChannel(i.channelId);
    if (!ticket) throw new UserError('Use this inside an open ticket channel.');
    await i.deferReply();
    await closeTicket(i.client, ticket, staffName(i), i.options.getString('reason'));
    await i.editReply('Ticket closed. The transcript was saved. This channel will be deleted in 5 seconds.');
    return;
  }
  const user = i.options.getUser('member', true);
  const type = i.options.getString('type', true);
  if (!isTicketType(type)) throw new UserError('Pick a ticket type.');
  if (user.bot) throw new UserError('You can’t open a ticket with a bot.');
  await assertNoOpenTicket(i.client, user.id).catch(() => {
    throw new UserError(`${name(user)} already has an open ticket: <#${openTicketOf(user.id)!.channelId}>`);
  });
  const reason = i.options.getString('reason', true).trim();
  await i.deferReply({ flags: EPHEMERAL });
  const opener = staffName(i);
  const ticket = await startTicket(i.client, user, type, reason, opener, async (t) => {
    await user.send({
      embeds: [notice(`Ares staff opened a ticket with you · #${t.id}`,
        `**${TICKET_TYPES[t.type].label}:** ${reason}\n\nReply in this DM to talk to staff. You’ll see ✅ when a message reaches them.`, TYPE_COLOR[t.type])],
      components: [closeButton(t.id)]
    });
  });
  await i.editReply(`Opened ticket #${ticket.id} with ${name(user)}: <#${ticket.channelId}>`);
}

const staffName = (i: { member: unknown; user: User }) =>
  (i.member && typeof i.member === 'object' && 'displayName' in i.member ? String(i.member.displayName) : null) ?? name(i.user);

// ---- Relaying messages ----

const attachmentsOf = (m: Message) => [...m.attachments.values()].map((a) => a.url);

/** DM from a member: pass it to their ticket channel, or offer to open a ticket. */
const offered = new Map<string, number>();
export async function onDirectMessage(client: Client, m: Message): Promise<void> {
  if (m.author.bot) return;
  const ticket = openTicketOf(m.author.id);
  const channel = ticket ? await client.channels.fetch(ticket.channelId).catch(() => null) : null;
  if (!ticket || !channel?.isSendable()) {
    if (ticket) markClosed(ticket.id, 'channel deleted', null);
    // Offer a ticket at most every 10 minutes, so chatty DMs don't get a picker each time.
    if (Date.now() - (offered.get(m.author.id) ?? 0) < 10 * 60_000) return;
    offered.set(m.author.id, Date.now());
    await m.reply({ content: 'Hi! Want to talk to Ares staff? Pick what it’s about to open a ticket.', components: [typePicker()] });
    return;
  }
  const files = attachmentsOf(m);
  await channel.send({
    embeds: [new EmbedBuilder().setAuthor({ name: `${name(m.author)} (member)`, iconURL: m.author.displayAvatarURL() })
      .setDescription(clip(m.content || '*(attachment)*', 4000)).setColor(TYPE_COLOR[ticket.type])],
    files,
    allowedMentions: { parse: [] }
  });
  addTicketMessage(ticket.id, { author: ticket.userName, fromStaff: false, internal: false, content: m.content, attachments: files });
  await m.react('✅').catch(() => undefined);
}

/** Message in a ticket channel: send it to the member, unless it's a staff note. */
export async function onTicketChannelMessage(m: Message): Promise<boolean> {
  const ticket = ticketByChannel(m.channelId);
  if (!ticket) return false;
  if (m.author.bot) return true;
  const author = m.member?.displayName ?? name(m.author);
  if (m.content.startsWith(NOTE_PREFIX)) {
    addTicketMessage(ticket.id, { author, fromStaff: true, internal: true, content: m.content.slice(NOTE_PREFIX.length).trim(), attachments: attachmentsOf(m) });
    await m.react('📝').catch(() => undefined);
    return true;
  }
  const files = attachmentsOf(m);
  try {
    const user = await m.client.users.fetch(ticket.userId);
    await user.send({
      embeds: [new EmbedBuilder().setAuthor({ name: `${author} · Ares Staff`, iconURL: m.author.displayAvatarURL() })
        .setDescription(clip(m.content || '*(attachment)*', 4000)).setColor(TYPE_COLOR[ticket.type])
        .setFooter({ text: `Ticket #${ticket.id}` })],
      files
    });
    addTicketMessage(ticket.id, { author, fromStaff: true, internal: false, content: m.content, attachments: files });
    await m.react('✅').catch(() => undefined);
  } catch {
    await m.react('❌').catch(() => undefined);
    await m.reply({ content: 'Couldn’t deliver that: the member’s DMs are closed or they left. It wasn’t sent.', allowedMentions: { parse: [] } }).catch(() => undefined);
  }
  return true;
}

// ---- Closing ----

export async function closeTicket(client: Client, ticket: Ticket, closedBy: string, reason: string | null): Promise<void> {
  if (!markClosed(ticket.id, closedBy, reason)) throw new UserError('This ticket is already closed.');
  const closed = getTicket(ticket.id)!;
  const messages = ticketMessages(ticket.id);
  const file = (forMember: boolean) =>
    new AttachmentBuilder(Buffer.from(buildTranscript(closed, messages, forMember), 'utf8'), { name: `ticket-${ticket.id}.txt` });
  await log(client, notice(`Ticket #${ticket.id} closed · ${TICKET_TYPES[ticket.type].label}`,
    `**Member:** ${ticket.userName} (<@${ticket.userId}>)\n**Closed by:** ${closedBy}${reason ? `\n**Reason:** ${reason}` : ''}\n**Topic:** ${ticket.topic}`,
    Colors.muted), [file(false)], config.ticketLogChannelId);
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  await user?.send({
    embeds: [notice(`Ticket #${ticket.id} closed`, `${closedBy === ticket.userName ? 'You closed this ticket.' : `Closed by ${closedBy}.`}${reason ? `\n**Reason:** ${reason}` : ''}\nHere’s a copy of the conversation. DM me again any time to open a new ticket.`, Colors.muted)],
    files: [file(true)]
  }).catch(() => undefined);
  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (channel?.isSendable()) {
    await channel.send({ embeds: [notice('Ticket closed', `Closed by ${closedBy}. This channel will be deleted in 5 seconds.`, Colors.muted)] }).catch(() => undefined);
    setTimeout(() => void (channel as TextChannel).delete(`Ticket #${ticket.id} closed by ${closedBy}`).catch(() => undefined), 5000);
  }
}

/** "Close ticket" in the staff channel. */
export async function closeTicketButton(i: ButtonInteraction): Promise<void> {
  const ticket = ticketByChannel(i.channelId);
  if (!ticket) throw new UserError('This ticket is already closed.');
  await i.deferUpdate();
  await closeTicket(i.client, ticket, staffName(i), null);
}

/** "Close ticket" in the member's DMs. */
export async function memberCloseButton(i: ButtonInteraction, rawId: string): Promise<void> {
  const ticket = getTicket(Number(rawId));
  if (!ticket || ticket.userId !== i.user.id || ticket.status !== 'open') throw new UserError('This ticket is already closed.');
  await i.deferUpdate();
  await closeTicket(i.client, ticket, ticket.userName, null);
}

/** A ticket channel deleted by hand counts as closed. */
export function onChannelDeleted(channelId: string): void {
  const ticket = ticketByChannel(channelId);
  if (ticket) markClosed(ticket.id, 'channel deleted', null);
}
