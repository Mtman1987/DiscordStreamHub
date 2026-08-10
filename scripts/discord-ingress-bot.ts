import 'dotenv/config';
import {
  ActivityType,
  Client,
  GatewayIntentBits,
  Message,
  Partials,
} from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DSH_INGRESS_URL = (
  process.env.DSH_DISCORD_INGRESS_URL
  || process.env.NEXT_PUBLIC_BASE_URL
  || 'http://127.0.0.1:3000'
).replace(/\/$/, '');
const PRESENCE_TEXT = process.env.DSH_DISCORD_PRESENCE || 'Powered by Space Mountain';

const VOICE_OWNED_COMMAND = /^!(?:dj|ignore|unignore|ignored|skip|voteskip|wr|watch|add|accept)(?:\s|$)/i;

function shouldForward(message: Message) {
  if (!message.guild) return false;
  if (message.author.bot) return false;
  if (VOICE_OWNED_COMMAND.test(message.content.trim())) return false;
  return true;
}

function buildPayload(message: Message) {
  return {
    userId: message.author.id,
    userName: message.member?.displayName || message.author.globalName || message.author.username,
    displayName: message.member?.displayName || message.author.globalName || message.author.username,
    userAvatar: message.author.displayAvatarURL({ size: 256 }),
    guildId: message.guildId,
    serverId: message.guildId,
    channelId: message.channelId,
    channelName: 'name' in message.channel ? message.channel.name : '',
    messageId: message.id,
    message: message.content,
    content: message.content,
    isDM: false,
    isDirectMessage: false,
    dispatch: true,
    source: 'dsh-discord-gateway',
    traceId: message.id,
    author: {
      id: message.author.id,
      username: message.author.username,
      bot: message.author.bot,
    },
    mentions: [...message.mentions.users.values()].map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.globalName || user.username,
    })),
    attachments: [...message.attachments.values()].map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      proxyUrl: attachment.proxyURL,
      contentType: attachment.contentType,
      size: attachment.size,
    })),
    embeds: message.embeds.map((embed) => embed.toJSON()),
    stickers: [...message.stickers.values()].map((sticker) => ({
      id: sticker.id,
      name: sticker.name,
      format: sticker.format,
    })),
  };
}

async function forwardMessage(message: Message) {
  if (!shouldForward(message)) return;
  if (!DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN is required');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  timeout.unref?.();

  try {
    const response = await fetch(`${DSH_INGRESS_URL}/api/discord/gateway-ingress`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-chat-origin': 'dsh-discord-gateway',
        'x-discord-trace-id': message.id,
        'x-discord-bot-token': DISCORD_BOT_TOKEN,
      },
      body: JSON.stringify(buildPayload(message)),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`DSH ingress ${response.status}: ${JSON.stringify(result)}`);
    }
    console.log(`[DiscordIngress] ${message.id} ${message.author.username} -> ${message.channelId}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  if (!DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN is required');

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once('clientReady', (readyClient) => {
    readyClient.user.setPresence({
      status: 'online',
      activities: [{ name: PRESENCE_TEXT, type: ActivityType.Watching }],
    });
    console.log(`[DiscordIngress] READY as ${readyClient.user.tag}`);
    console.log(`[DiscordIngress] Presence: ${PRESENCE_TEXT}`);
    console.log(`[DiscordIngress] DSH endpoint: ${DSH_INGRESS_URL}/api/discord/gateway-ingress`);
  });

  client.on('messageCreate', (message) => {
    forwardMessage(message).catch((error) => {
      console.error(`[DiscordIngress] Failed ${message.id}:`, error);
    });
  });

  client.on('error', (error) => console.error('[DiscordIngress] Client error:', error));
  client.on('warn', (warning) => console.warn('[DiscordIngress] Client warning:', warning));
  client.on('shardDisconnect', (event, shardId) => {
    console.warn(`[DiscordIngress] Shard ${shardId} disconnected (${event.code})`);
  });
  client.on('shardResume', (shardId, replayedEvents) => {
    console.log(`[DiscordIngress] Shard ${shardId} resumed; replayed ${replayedEvents} events`);
  });

  await client.login(DISCORD_BOT_TOKEN);
}

main().catch((error) => {
  console.error('[DiscordIngress] Fatal:', error);
  process.exit(1);
});
