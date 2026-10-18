/** Automod rules without Discord code, so they can be tested. */

/** Counts each member's messages in a sliding window. */
export class SpamTracker {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  /** Records a message; true when the member just went over the limit. */
  record(userId: string, now = Date.now()): boolean {
    const recent = (this.hits.get(userId) ?? []).filter((t) => now - t < this.windowMs);
    recent.push(now);
    this.hits.set(userId, recent);
    if (this.hits.size > 5000) for (const [id, times] of this.hits) if (!times.some((t) => now - t < this.windowMs)) this.hits.delete(id);
    return recent.length >= this.limit;
  }

  reset(userId: string): void {
    this.hits.delete(userId);
  }
}

const INVITE = /(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg)\/[\w-]+/i;
export const hasInvite = (content: string): boolean => INVITE.test(content);

const LINK = /\bhttps?:\/\/([^\s/?#<>]+)/gi;
/** Hosts of links in the message that aren't on the allowed list (subdomains of allowed domains are fine). */
export function blockedLinks(content: string, allowed: string[]): string[] {
  const hosts = [...content.matchAll(LINK)].map((m) => m[1].toLowerCase().replace(/:\d+$/, ''));
  return hosts.filter((host) => !allowed.some((domain) => host === domain || host.endsWith('.' + domain)));
}

export type AutomodVerdict = { rule: 'spam' | 'invite' | 'link' | 'mentions'; timeout: boolean; reason: string } | null;

export function checkMessage(
  input: { content: string; mentions: number; spamming: boolean },
  rules: { blockInvites: boolean; blockLinks: boolean; allowedDomains: string[]; maxMentions: number }
): AutomodVerdict {
  if (input.spamming) return { rule: 'spam', timeout: true, reason: 'Automod: sending messages too fast (spam)' };
  if (input.mentions >= rules.maxMentions)
    return { rule: 'mentions', timeout: true, reason: `Automod: mass mentions (${input.mentions} in one message)` };
  if (rules.blockInvites && hasInvite(input.content)) return { rule: 'invite', timeout: false, reason: 'Automod: Discord invite link' };
  if (rules.blockLinks) {
    const hosts = blockedLinks(input.content, rules.allowedDomains);
    if (hosts.length) return { rule: 'link', timeout: false, reason: `Automod: link not allowed (${hosts[0]})` };
  }
  return null;
}
