import { Client, Events, GatewayIntentBits, Partials, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { config } from './config.js';
import { db } from './db.js';
import { replyError } from './util.js';
import { moderationCommand, syncCases } from './handlers/moderation.js';
import { handleReportButton, syncReports } from './handlers/reports.js';
import { closeTicketButton, createTicket, openTicketButton, ticketPanel } from './handlers/tickets.js';
import { onMemberJoin, onMemberLeave, onMessage, onMessageDelete, onMessageUpdate } from './handlers/events.js';
import { websiteEnabled } from './services/website.js';

// Members and Message Content are privileged intents: turn them on in the Developer Portal → Bot.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

async function onCommand(i: ChatInputCommandInteraction): Promise<void> {
  try {
    if (!i.inGuild()) return void (await i.reply('Use my commands inside the Ares server.'));
    if (i.commandName === 'ticket-panel') return await ticketPanel(i);
    await moderationCommand(i);
  } catch (error) {
    await replyError(i, error);
  }
}

async function onButton(i: ButtonInteraction): Promise<void> {
  try {
    const [scope, action, id] = i.customId.split(':');
    if (scope === 'report') return await handleReportButton(i, action, id);
    if (scope === 'ticket' && action === 'open') return await openTicketButton(i);
    if (scope === 'ticket' && action === 'close') return await closeTicketButton(i);
  } catch (error) {
    await replyError(i, error);
  }
}

/** Runs a background task, printing failures (once per 10 minutes per task) instead of crashing. */
const lastError = new Map<string, number>();
const guarded = (name: string, task: () => Promise<unknown>) => () =>
  void task().catch((error) => {
    if (Date.now() - (lastError.get(name) ?? 0) < 10 * 60_000) return;
    lastError.set(name, Date.now());
    console.error(`[${name}]`, error instanceof Error ? error.message : error);
  });

client.once(Events.ClientReady, (ready) => {
  console.log(`Logged in as ${ready.user.tag}`);
  const checks = [
    ['DISCORD_GUILD_ID', ready.guilds.cache.has(config.guildId) ? 'ok' : 'the bot is not in this server'],
    ['STAFF_ROLE_ID', config.staffRoleId ? 'ok' : 'missing: only Administrators count as staff'],
    ['LOG_CHANNEL_ID', config.logChannelId ? 'ok' : 'missing: logs and ticket transcripts are off'],
    ['REPORTS_CHANNEL_ID', config.reportsChannelId ? 'ok' : 'missing: website reports are not posted'],
    ['MOD_BOT_KEY', websiteEnabled() ? 'ok' : 'missing: website reports and cases are off'],
    ['TICKET_CATEGORY_ID', config.ticketCategoryId ? 'ok' : 'missing: tickets are created without a category']
  ];
  console.log('[setup]\n' + checks.map(([k, v]) => `  ${v === 'ok' ? '✓' : '!'} ${k}: ${v}`).join('\n'));
  const reports = guarded('website reports', () => syncReports(ready));
  const cases = guarded('website cases', () => syncCases());
  reports();
  cases();
  setInterval(reports, 30_000).unref();
  setInterval(cases, 60_000).unref();
});

client.on(Events.InteractionCreate, (i) => {
  if (i.isChatInputCommand()) void onCommand(i);
  else if (i.isButton()) void onButton(i);
  else if (i.isModalSubmit() && i.customId === 'ticket:create') void createTicket(i).catch((e) => replyError(i, e));
});
client.on(Events.MessageCreate, (m) => void onMessage(client, m).catch((e) => console.error('[automod]', e)));
client.on(Events.MessageDelete, (m) => void onMessageDelete(client, m).catch((e) => console.error('[log]', e)));
client.on(Events.MessageUpdate, (a, b) => void onMessageUpdate(client, a, b).catch((e) => console.error('[log]', e)));
client.on(Events.GuildMemberAdd, (m) => void onMemberJoin(client, m).catch((e) => console.error('[log]', e)));
client.on(Events.GuildMemberRemove, (m) => void onMemberLeave(client, m).catch((e) => console.error('[log]', e)));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(`[bot] ${signal}, shutting down`);
    void client.destroy();
    db.close();
    process.exit(0);
  });
}

void client.login(config.token);
