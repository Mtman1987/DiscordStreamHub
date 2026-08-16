import 'dotenv/config';
import {
  ActivityType,
  Client,
  GatewayIntentBits,
  Message,
  Partials,
} from 'discord.js';
import { getDiscordIngressTimeoutMs } from '../src/lib/discord-ingress-timeout';
import { humanizeDiscordText } from '../src/lib/discord-human-text';

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

function displayNameForUser(message: Message, userId: string) {
  const member = message.mentions.members?.get(userId);
  const user = message.mentions.users.get(userId);
  return member?.displayName || user?.globalName || user?.username || '';
}

function buildPayload(message: Message) {
  const users = Object.fromEntries(
    [...message.mentions.users.values()].map((user) => [user.id, displayNameForUser(message, user.id)]),
  );
  const channels = Object.fromEntries(
    [...message.mentions.channels.values()].map((channel: any) => [channel.id, String(channel?.name || '')]),
  );
  const roles = Object.fromEntries(
    [...message.mentions.roles.values()].map((role) => [role.id, role.name]),
  );
  const rawContent = String(message.content || '');
  const humanContent = humanizeDiscordText(rawContent, { users, channels, roles });
  const channelName = 'name' in message.channel ? String(message.channel.name || '') : '';
  const displayName = message.member?.displayName || message.author.globalName || message.author.username;

  return {
    userId: message.author.id,
    userName: displayName,
    displayName,
    userAvatar: message.author.displayAvatarURL({ size: 256 }),
    guildId: message.guildId,
    guildName: message.guild?.name || '',
    serverId: message.guildId,
    channelId: message.channelId,
    channelName,
    messageId: message.id,
    message: humanContent,
    content: humanContent,
    cleanContent: humanContent,
    rawMessage: rawContent,
    rawContent,
    isDM: false,
    isDirectMessage: false,
    dispatch: true,
    source: 'dsh-discord-gateway',
    traceId: message.id,
    author: {
      id: message.author.id,
      username: message.author.username,
      global_name: message.author.globalName || undefined,
      bot: message.author.bot,
    },
    member: {
      displayName,
      nick: message.member?.nickname || undefined,
      user: {
        id: message.author.id,
        username: message.author.username,
        global_name: message.author.globalName || undefined,
      },
    },
    guild: {
      id: message.guildId,
      name: message.guild?.name || '',
    },
    channel: {
      id: message.channelId,
      name: channelName,
      type: message.channel.type,
    },
    mentions: [...message.mentions.users.values()].map((user) => ({
      id: user.id,
      username: user.username,
      global_name: user.globalName || undefined,
      displayName: displayNameForUser(message, user.id),
    })),
    mentionMetadata: {
      users,
      channels,
      roles,
    },
    attachments: [...message.attachments.values()].map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      filename: attachment.name,
      url: attachment.url,
      proxyUrl: attachment.proxyURL,
      proxy_url: attachment.proxyURL,
      contentType: attachment.contentType,
      content_type: attachment.contentType,
      size: attachment.size,
      width: attachment.width,
      height: attachment.height,
      description: attachment.description,
    })),
    embeds: message.embeds.map((embed) => embed.toJSON()),
    stickers: [...message.stickers.values()].map((sticker) => ({
      id: sticker.id,
      name: sticker.name,
      format: sticker.format,
      format_type: sticker.format,
    })),
    sticker_items: [...message.stickers.values()].map((sticker) => ({
      id: sticker.id,
      name: sticker.name,
      format_type: sticker.format,
    })),
  };
}

async function forwardMessage(message: Message) {
  if (!shouldForward(message)) return;
  if (!DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN is required');

  const controller = new AbortController();
  const mentionsBot = Boolean(message.client.user?.id && message.mentions.users.has(message.client.user.id));
  const timeoutMs = getDiscordIngressTimeoutMs(message.content, mentionsBot);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    console.log(`[DiscordIngress] ${message.id} ${message.author.username} -> ${message.channelId} timeoutMs=${timeoutMs}`);
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
