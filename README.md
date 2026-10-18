# Ares Moderation Bot

The Discord moderation bot for the Ares Orion Drift community. It works alongside the Ares tournament bot, which handles tournaments, servers and players. This bot handles moderation and Discord staff work. It's built with TypeScript, discord.js v14 and SQLite.

## What it does

**Website reports.** Players report rule breakers on aresfleet.com. Every 30 seconds the bot posts new reports to `REPORTS_CHANNEL_ID` as a card with **Resolved** (the player was punished) and **Close** (no valid evidence) buttons. Only staff can press them. The decision goes back to the website, where the player sees the outcome. If staff decide in the website dashboard instead, the card updates on the next check. If a card is deleted, a new one is posted.

**Mod commands and cases.** Every action is saved as a numbered case, logged to `LOG_CHANNEL_ID`, DMed to the member where possible, and copied to the website dashboard.

| Command | What it does |
|---|---|
| `/warn member reason` | Warn |
| `/timeout member length reason` | Time out, e.g. `10m`, `2h`, `1d` (max 28 days) |
| `/untimeout member [reason]` | Remove a timeout |
| `/kick member reason` | Kick |
| `/ban user reason [delete_messages]` | Ban, including people who already left |
| `/unban user_id [reason]` | Unban |
| `/cases user` | A member's history |
| `/case view number`, `/case reason number reason` | Look up or fix a case |
| `/purge count [from]` | Delete up to 100 recent messages (Discord only allows the last 14 days) |
| `/ticket-panel` | Post the "Open a ticket" button |

The bot refuses to act on staff, on itself, or on anyone whose highest role is as high as yours or above the bot's.

**Tickets.** Members press **Open a ticket** and say what they need. The bot creates a private channel in `TICKET_CATEGORY_ID` that only they and staff can see. Either side presses **Close ticket**: the full transcript is saved to the log channel as a `.txt` file and DMed to the member, then the channel is deleted. One open ticket per member.

**Logs.** Deleted and edited messages, joins (new accounts are flagged), leaves, purges, tickets and every case go to the log channel. Nothing in logs pings anyone.

**Automod** (staff are never affected):
- **Spam:** `AUTOMOD_SPAM_COUNT` messages within `AUTOMOD_SPAM_SECONDS`. The message is deleted, the member is timed out and an automod case is created.
- **Mass mentions:** `AUTOMOD_MAX_MENTIONS` or more mentions in one message. Same as spam.
- **Discord invites:** deleted with a short warning (`AUTOMOD_BLOCK_INVITES`, on by default).
- **Other links:** optional (`AUTOMOD_BLOCK_LINKS`). Links to `AUTOMOD_ALLOWED_DOMAINS` and their subdomains are always fine.

## Setup

1. **Create the application.** In the [Discord Developer Portal](https://discord.com/developers/applications), click New Application and name it e.g. "Ares Moderation".
   - On the **Bot** page, Reset Token and copy it into `DISCORD_TOKEN`.
   - Turn on **Server Members Intent** and **Message Content Intent**.
   - On **General Information**, copy the Application ID into `DISCORD_CLIENT_ID`.
2. **Invite the bot.** Under OAuth2 → URL Generator, tick the scopes `bot` and `applications.commands`, and these permissions: View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Messages, Manage Channels, Moderate Members, Kick Members, Ban Members. Open the link and add it to the Ares server.
   - In Server Settings → Roles, drag the bot's role **above** the roles of members it should moderate.
   - If the reports channel is in a separate staff server, invite the bot there too.
3. **Configure.** Copy `.env.example` to `.env` (or `bot.env`) and fill it in. To get IDs, turn on Discord Settings → Advanced → Developer Mode, then right-click a server, role or channel → Copy ID. Ask the website owner for `MOD_BOT_KEY`.
4. **Install and register commands:**
   ```
   npm ci
   npm run deploy:commands
   ```
   Commands are hidden from members without the matching Discord permission (e.g. Moderate Members). To change who sees them, go to Server Settings → Integrations → Ares Moderation. The bot also requires `STAFF_ROLE_ID` or Administrator.
5. **Run:**
   - Development: `npm run dev`
   - Production: `npm run build && npm start`

   On Wispbyte, set the start command to `npm run build && npm start` (Node 22+). The bot doesn't need an open port.

At startup the console lists any missing settings.

## Development

- `npm test` runs the automod, case, report card, transcript and website tests (in-memory database).
- `npm run typecheck` checks the types.

```
src/
  index.ts            client, intents, event and button routing, background tasks
  commands.ts         slash command definitions (deploy with npm run deploy:commands)
  config.ts           settings from .env
  db.ts               SQLite schema (cases, tickets)
  services/           cases, automod rules, transcripts, website API (no Discord code)
  handlers/           moderation commands, report cards, tickets, logs + automod events
```
