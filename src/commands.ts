import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

const mod = PermissionFlagsBits.ModerateMembers;
const reason = (required = true) => (o: import('discord.js').SlashCommandStringOption) =>
  o.setName('reason').setDescription('Why (shown to the member and saved in the case)').setRequired(required).setMaxLength(1000);

/** Slash commands. Mod commands are hidden from members without Moderate Members; the bot also checks the staff role. */
export const commands = [
  new SlashCommandBuilder().setName('warn').setDescription('Warn a member (saved as a case and DMed to them)')
    .setDefaultMemberPermissions(mod)
    .addUserOption((o) => o.setName('member').setDescription('Who to warn').setRequired(true))
    .addStringOption(reason()),
  new SlashCommandBuilder().setName('timeout').setDescription('Time a member out')
    .setDefaultMemberPermissions(mod)
    .addUserOption((o) => o.setName('member').setDescription('Who to time out').setRequired(true))
    .addStringOption((o) => o.setName('length').setDescription('e.g. 10m, 2h, 1d (max 28d)').setRequired(true).setMaxLength(20))
    .addStringOption(reason()),
  new SlashCommandBuilder().setName('untimeout').setDescription('Remove a member’s timeout')
    .setDefaultMemberPermissions(mod)
    .addUserOption((o) => o.setName('member').setDescription('Who to release').setRequired(true))
    .addStringOption(reason(false)),
  new SlashCommandBuilder().setName('kick').setDescription('Kick a member from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName('member').setDescription('Who to kick').setRequired(true))
    .addStringOption(reason()),
  new SlashCommandBuilder().setName('ban').setDescription('Ban someone from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('user').setDescription('Who to ban (works for people who already left)').setRequired(true))
    .addStringOption(reason())
    .addIntegerOption((o) => o.setName('delete_messages').setDescription('Delete their recent messages')
      .addChoices({ name: 'Don’t delete any', value: 0 }, { name: 'Last 24 hours', value: 1 }, { name: 'Last 7 days', value: 7 })),
  new SlashCommandBuilder().setName('unban').setDescription('Unban someone')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((o) => o.setName('user_id').setDescription('Their Discord user ID').setRequired(true).setMaxLength(25))
    .addStringOption(reason(false)),
  new SlashCommandBuilder().setName('cases').setDescription('A member’s moderation history')
    .setDefaultMemberPermissions(mod)
    .addUserOption((o) => o.setName('user').setDescription('Whose history').setRequired(true)),
  new SlashCommandBuilder().setName('case').setDescription('Look up or edit one case')
    .setDefaultMemberPermissions(mod)
    .addSubcommand((s) => s.setName('view').setDescription('Show a case')
      .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('reason').setDescription('Change a case’s reason')
      .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName('reason').setDescription('New reason').setRequired(true).setMaxLength(1000))),
  new SlashCommandBuilder().setName('purge').setDescription('Delete recent messages in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) => o.setName('count').setDescription('How many (1–100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName('from').setDescription('Only messages from this member')),
  new SlashCommandBuilder().setName('ticket-panel').setDescription('Post the "Open a ticket" button in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
];
