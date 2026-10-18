import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { DATABASE_PATH: ':memory:', DISCORD_TOKEN: 'test', DISCORD_CLIENT_ID: 'test', DISCORD_GUILD_ID: '100000000000000000' }
  }
});
