import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Collection,
  type Message,
  type ModalSubmitInteraction,
  type TextChannel
} from 'discord.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { buildTranscript } from '../services/transcript.js';
import { Colors, EPHEMERAL, UserError, clip, isStaff, notice, staffMember } from '../util.js';
import { log } from './log.js';

interface Ticket { id: number; channel_id: string; user_id: string; user_name: string; topic: string; created_at: number }

export async function ticketPanel(i: ChatInputCommandInteraction): Promise<void> {
  await staffMember(i);
  if (!i.channel?.isSendable()) throw new UserError('Use this in a text channel.');
  await i.channel.send({
    embeds: [notice('Need help from Ares staff?', 'Press the button to open a private ticket. Only you and staff can see it.', Colors.info)],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('ticket:open').setLabel('Open a ticket').setStyle(ButtonStyle.Primary)
    )]
  });
  await i.reply({ content: 'Ticket panel posted.', flags: EPHEMERAL });
}

const openTicketOf = (userId: string) =>
  db.prepare("SELECT * FROM tickets WHERE user_id = ? AND status = 'open'").get(userId) as Ticket | undefined;

/** "Open a ticket" asks what it's about first. */
export async function openTicketButton(i: ButtonInteraction): Promise<void> {
  const open = openTicketOf(i.user.id);
  if (open && (await i.guild!.channels.fetch(open.channel_id).catch(() => null)))
    throw new UserError(`You already have a ticket open: <#${open.channel_id}>`);
  if (open) db.prepare("UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = 'channel deleted' WHERE id = ?").run(Date.now(), open.id);
  await i.showModal(new ModalBuilder().setCustomId('ticket:create').setTitle('Open a ticket').addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId('topic').setLabel('What do you need help with?').setStyle(TextInputStyle.Paragraph)
        .setMinLength(5).setMaxLength(500).setRequired(true)
    )
  ));
}

export async function createTicket(i: ModalSubmitInteraction): Promise<void> {
  if (openTicketOf(i.user.id)) throw new UserError('You already have a ticket open.');
  const topic = i.fields.getTextInputValue('topic').trim();
  await i.deferReply({ flags: EPHEMERAL });
  const guild = i.guild!;
  const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
  const name = `ticket-${(i.user.username.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'member').slice(0, 20)}`;
  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId,
    topic: clip(`Ticket for ${i.user.tag}: ${topic}`, 1024),
    permissionOverwrites: [
      { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
      { id: i.user.id, type: OverwriteType.Member, allow },
      { id: i.client.user.id, type: OverwriteType.Member, allow: [...allow, PermissionFlagsBits.ManageChannels] },
      ...(config.staffRoleId ? [{ id: config.staffRoleId, type: OverwriteType.Role, allow: [...allow, PermissionFlagsBits.ManageMessages] }] : [])
    ]
  });
  const id = Number(db.prepare('INSERT INTO tickets (channel_id, user_id, user_name, topic, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(channel.id, i.user.id, i.user.globalName ?? i.user.username, topic, Date.now()).lastInsertRowid);
  await channel.send({
    content: `<@${i.user.id}>${config.staffRoleId ? ` <@&${config.staffRoleId}>` : ''}`,
    embeds: [notice(`Ticket #${id}`, `**Topic:** ${topic}\n\nStaff will be with you soon. Add any screenshots or details here.`, Colors.info)],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('ticket:close').setLabel('Close ticket').setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { users: [i.user.id], roles: config.staffRoleId ? [config.staffRoleId] : [] }
  });
  await log(i.client, notice(`Ticket #${id} opened`, `${i.user.tag} (<@${i.user.id}>) · <#${channel.id}>\n**Topic:** ${topic}`, Colors.info));
  await i.editReply(`Your ticket is open: <#${channel.id}>`);
}

async function allMessages(channel: TextChannel): Promise<Message[]> {
  const out: Message[] = [];
  let before: string | undefined;
  while (out.length < 1000) {
    const batch: Collection<string, Message> = await channel.messages.fetch({ limit: 100, before });
    out.push(...batch.values());
    if (batch.size < 100) break;
    before = batch.last()!.id;
  }
  return out;
}

/** The opener or staff can close. Saves a transcript to the log channel and DMs it to the opener. */
export async function closeTicketButton(i: ButtonInteraction): Promise<void> {
  const ticket = db.prepare("SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'").get(i.channelId) as Ticket | undefined;
  if (!ticket) throw new UserError('This ticket is already closed.');
  const member = await i.guild!.members.fetch(i.user.id).catch(() => null);
  if (i.user.id !== ticket.user_id && !isStaff(member)) throw new UserError('Only the member who opened it or staff can close this ticket.');
  await i.deferReply();
  const channel = i.channel as TextChannel;
  const closer = member?.displayName ?? i.user.username;
  const text = buildTranscript(
    { id: ticket.id, userName: ticket.user_name, topic: ticket.topic, createdAt: ticket.created_at },
    (await allMessages(channel)).map((m) => ({
      author: m.author.tag, bot: m.author.bot, createdAt: m.createdTimestamp, content: m.cleanContent,
      attachments: [...m.attachments.values()].map((a) => a.url)
    })),
    closer
  );
  db.prepare("UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = ? WHERE id = ?").run(Date.now(), closer, ticket.id);
  const file = () => new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `ticket-${ticket.id}.txt` });
  await log(i.client, notice(`Ticket #${ticket.id} closed`, `Opened by ${ticket.user_name} (<@${ticket.user_id}>) · closed by ${closer}\n**Topic:** ${ticket.topic}`, Colors.muted), [file()]);
  const opener = await i.client.users.fetch(ticket.user_id).catch(() => null);
  await opener?.send({ embeds: [notice(`Your Ares ticket #${ticket.id} was closed`, 'Here’s a copy of the conversation.', Colors.muted)], files: [file()] }).catch(() => undefined);
  await i.editReply('Ticket closed. The transcript was saved. This channel will be deleted in 5 seconds.');
  setTimeout(() => void channel.delete(`Ticket #${ticket.id} closed by ${closer}`).catch(() => undefined), 5000);
}
