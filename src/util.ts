import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type GuildMember,
  type Interaction,
  type RepliableInteraction
} from 'discord.js';
import { config } from './config.js';

/** A problem to show the person who used a command, rather than a crash. */
export class UserError extends Error {}

export const Colors = { info: 0x8fcee4, success: 0x2ecc71, warning: 0xf0a020, danger: 0xe74c3c, muted: 0x7f8c8d } as const;
export const EPHEMERAL = MessageFlags.Ephemeral;

export const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
export const notice = (title: string, description: string, color: number = Colors.info) =>
  new EmbedBuilder().setTitle(clip(title, 256)).setDescription(clip(description, 4000)).setColor(color);

/** Staff = Administrator, or the configured staff role. */
export function isStaff(member: GuildMember | null | undefined): boolean {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return !!config.staffRoleId && member.roles.cache.has(config.staffRoleId);
}

export async function staffMember(i: Interaction): Promise<GuildMember> {
  const member = i.inGuild() && i.guild ? await i.guild.members.fetch(i.user.id).catch(() => null) : null;
  if (!isStaff(member)) throw new UserError('Only Ares staff can do that.');
  return member!;
}

export async function replyError(i: RepliableInteraction, error: unknown): Promise<void> {
  const message = error instanceof UserError ? error.message : 'Something went wrong. Please try again.';
  if (!(error instanceof UserError)) console.error(error);
  const payload = { embeds: [notice('Can’t do that', message, Colors.danger)], flags: EPHEMERAL } as const;
  await (i.deferred || i.replied ? i.followUp(payload) : i.reply(payload)).catch(() => undefined);
}

/** "1d 2h 5m" style text for a number of minutes. */
export function minutesText(minutes: number): string {
  const d = Math.floor(minutes / 1440), h = Math.floor((minutes % 1440) / 60), m = minutes % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || '0m';
}

/** Parses "10m", "2h", "1d", "1h30m" or a plain number of minutes. Max 28 days (Discord's limit). */
export function parseDuration(text: string): number {
  const raw = text.trim().toLowerCase();
  if (/^\d+$/.test(raw)) return check(Number(raw));
  const parts = [...raw.matchAll(/(\d+)\s*(d|h|m)/g)];
  if (!parts.length || parts.map((p) => p[0]).join('').replace(/\s/g, '') !== raw.replace(/\s/g, ''))
    throw new UserError('Use a length like 10m, 2h, 1d or 1h30m.');
  return check(parts.reduce((sum, [, n, unit]) => sum + Number(n) * (unit === 'd' ? 1440 : unit === 'h' ? 60 : 1), 0));
}
function check(minutes: number): number {
  if (minutes < 1 || minutes > 40320) throw new UserError('Timeouts must be between 1 minute and 28 days.');
  return minutes;
}
