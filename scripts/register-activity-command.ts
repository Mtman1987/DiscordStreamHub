import 'dotenv/config';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_APP_ID =
  process.env.DISCORD_ACTIVITY_APPLICATION_ID ||
  process.env.DISCORD_APP_ID ||
  process.env.DISCORD_CLIENT_ID ||
  process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;

const API_BASE = 'https://discord.com/api/v10';

type DiscordCommand = {
  id: string;
  name: string;
  type?: number;
  handler?: number;
};

async function discordApi<T>(path: string, init: RequestInit = {}) {
  if (!DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN is required in .env');
  if (!DISCORD_APP_ID) throw new Error('DISCORD_APP_ID or DISCORD_CLIENT_ID is required in .env');

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`Discord API ${response.status}: ${JSON.stringify(payload, null, 2)}`);
  }

  return payload as T;
}

async function main() {
  const commands = await discordApi<DiscordCommand[]>(`/applications/${DISCORD_APP_ID}/commands`);
  const existing = commands.find((command) => command.type === 4 || command.name === 'launch');
  const payload = {
    name: 'launch',
    description: 'Launch Discord Stream Hub',
    type: 4,
    handler: 2,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  };

  const command = existing
    ? await discordApi<DiscordCommand>(`/applications/${DISCORD_APP_ID}/commands/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
    : await discordApi<DiscordCommand>(`/applications/${DISCORD_APP_ID}/commands`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

  console.log(`Registered Activity entry point command: /${command.name} (${command.id})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
