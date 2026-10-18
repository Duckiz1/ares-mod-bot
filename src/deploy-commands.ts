import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { commands } from './commands.js';

// Registers the slash commands in the Ares server (they show up instantly).
const rest = new REST().setToken(config.token);
await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands.map((c) => c.toJSON()) });
console.log(`Registered ${commands.length} commands in server ${config.guildId}.`);
