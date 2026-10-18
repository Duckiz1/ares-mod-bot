import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { commands, staffCommands } from './commands.js';

// Registers the slash commands (they show up instantly): moderation in the Ares server, /ticket in the staff server.
const rest = new REST().setToken(config.token);
const sameServer = config.staffGuildId === config.guildId;
const main = sameServer ? [...commands, ...staffCommands] : commands;
await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: main.map((c) => c.toJSON()) });
console.log(`Registered ${main.length} commands in the Ares server (${config.guildId}).`);
if (!sameServer) {
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.staffGuildId), { body: staffCommands.map((c) => c.toJSON()) });
  console.log(`Registered ${staffCommands.length} command in the staff server (${config.staffGuildId}).`);
}