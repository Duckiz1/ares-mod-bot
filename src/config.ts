import dotenv from 'dotenv';
import { existsSync } from 'node:fs';

// Settings come from `.env` (or `bot.env`, for hosts whose file manager can't create dot-files).
for (const file of ['.env', 'bot.env']) if (existsSync(file)) dotenv.config({ path: file });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required setting ${name}. Add it to .env (or bot.env) next to package.json.`);
  return value;
}
const optional = (name: string) => process.env[name]?.trim() || undefined;
const number = (name: string, fallback: number, min: number, max: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
};
const flag = (name: string, fallback: boolean) => {
  const v = process.env[name]?.trim().toLowerCase();
  return v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v);
};

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId: required('DISCORD_GUILD_ID'),
  // Where ticket channels live; defaults to the main server.
  staffGuildId: optional('STAFF_GUILD_ID') ?? required('DISCORD_GUILD_ID'),
  staffRoleId: optional('STAFF_ROLE_ID'),
  logChannelId: optional('LOG_CHANNEL_ID'),
  reportsChannelId: optional('REPORTS_CHANNEL_ID'),
  // Ticket transcripts; defaults to the log channel.
  ticketLogChannelId: optional('TICKET_LOG_CHANNEL_ID') ?? optional('LOG_CHANNEL_ID'),
  websiteUrl: (optional('WEBSITE_URL') ?? 'https://aresfleet.com').replace(/\/+$/, ''),
  modBotKey: optional('MOD_BOT_KEY'),
  automod: {
    spamCount: number('AUTOMOD_SPAM_COUNT', 6, 3, 50),
    spamSeconds: number('AUTOMOD_SPAM_SECONDS', 8, 2, 120),
    timeoutMinutes: number('AUTOMOD_TIMEOUT_MINUTES', 10, 1, 40320),
    blockInvites: flag('AUTOMOD_BLOCK_INVITES', true),
    blockLinks: flag('AUTOMOD_BLOCK_LINKS', false),
    allowedDomains: (optional('AUTOMOD_ALLOWED_DOMAINS') ?? 'aresfleet.com,youtube.com,youtu.be,medal.tv,tenor.com')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    maxMentions: number('AUTOMOD_MAX_MENTIONS', 5, 2, 100)
  }
};
