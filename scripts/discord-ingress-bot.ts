import 'dotenv/config';
import {
  ActivityType,
  Client,
  GatewayIntentBits,
  Message,
  Partials,
  PermissionFlagsBits,
} from 'discord.js';
import { getDiscordIngressTimeoutMs } from '../src/lib/discord-ingress-timeout';
import { mtFixItPublicReply } from '../src/lib/mtfixit-contract';
import { resumePendingMtFixItDeliveries } from '../src/lib/mtfixit-delivery';
import { sendDiscordMtFixItMessage } from '../src/lib/mtfixit-discord-delivery';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DSH_INGRESS_URL = (
  process.env.DSH_DISCORD_INGRESS_URL
  || process.env.NEXT_PUBLIC_BASE_URL
  || 'http://127.0.0.1:3000'
).replace(/\/$/, '');
const PRESENCE_TEXT = process.env.DSH_DISCORD_PRESENCE || 'Powered by Space Mountain';

const VOICE_OWNED_COMMAND = /^!(?:dj|ignore|unignore|ignored|skip|voteskip|wr|watch|add|accept)(?:\s|$)/i;
const MTFIXIT_DECISION = /^mtfixit_(approve|deny):([a-zA-Z0-9_-]{8,100})$/;

function shouldForward(message: Message) {
  if (!message.guild) return false;
  if (message.author.bot) return false;
  if (VOICE_OWNED_COMMAND.test(message.content.trim())) return false;
  return true;
}

function buildPayload(message: Message) {
  const memberPermissions = message.member?.permissions;
  const isOwner = message.guild?.ownerId === message.author.id;
  const isAdmin = Boolean(memberPermissions?.has(PermissionFlagsBits.Administrator));
  const isMod = Boolean(
    isAdmin
    || memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    || memberPermissions?.has(PermissionFlagsBits.ManageMessages)
  );
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
    isAdmin,
    isMod,
    isOwner,
    memberPermissions: memberPermissions?.bitfield.toString() || '0',
    dispatch: true,
    source: 'dsh-discord-gateway',
    traceId: message.id,
    author: { id: message.author.id, username: message.author.username, bot: message.author.bot },
    mentions: [...message.mentions.users.values()].map((user) => ({ id: user.id, username: user.username, displayName: user.globalName || user.username })),
    attachments: [...message.attachments.values()].map((attachment) => ({
      id: attachment.id, name: attachment.name, url: attachment.url, proxyUrl: attachment.proxyURL, contentType: attachment.contentType, size: attachment.size,
    })),
    embeds: message.embeds.map((embed) => embed.toJSON()),
    stickers: [...message.stickers.values()].map((sticker) => ({ id: sticker.id, name: sticker.name, format: sticker.format })),
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
      headers: { 'content-type': 'application/json', 'x-chat-origin': 'dsh-discord-gateway', 'x-discord-trace-id': message.id, 'x-discord-bot-token': DISCORD_BOT_TOKEN },
      body: JSON.stringify(buildPayload(message)),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`DSH ingress ${response.status}: ${JSON.stringify(result)}`);
    console.log(`[DiscordIngress] ${message.id} ${message.author.username} -> ${message.channelId} timeoutMs=${timeoutMs}`);
  } finally { clearTimeout(timeout); }
}

async function handleMtFixItDecision(interaction: any) {
  if (!interaction?.isButton?.()) return false;
  const match = String(interaction.customId || '').match(MTFIXIT_DECISION);
  if (!match) return false;
  if (!DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN is required');
  const action = match[1] as 'approve' | 'deny';
  const jobId = match[2];
  await interaction.deferUpdate();
  const response = await fetch(`${DSH_INGRESS_URL}/api/internal/mtfixit/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-discord-bot-token': DISCORD_BOT_TOKEN },
    body: JSON.stringify({ userId: interaction.user.id, jobId, action }),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    await interaction.followUp({ content: `MtFixIt ${action} failed: ${String(result?.error || `HTTP ${response.status}`).slice(0, 500)}`, ephemeral: true }).catch(() => undefined);
    return true;
  }
  const state = String(result?.state?.status || (action === 'approve' ? 'deploying' : 'denied'));
  const suffix = action === 'approve'
    ? `\n\n✅ mtman approved this repair. Athena is ${state === 'deployed' ? 'finished deploying it.' : 'merging/deploying it now.'}`
    : '\n\n⛔ mtman denied automatic deployment. Athena is holding this repair for further instructions.';
  const existing = String(interaction.message?.content || '').replace(/\n\n(?:✅|⛔)[\s\S]*$/, '');
  await interaction.editReply({ content: `${existing}${suffix}`.slice(0, 1900), components: [] });
  console.log(`[DiscordIngress] MtFixIt decision action=${action} job=${jobId} user=${interaction.user.id} state=${state}`);
  return true;
}

async function main() {
  if (!DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN is required');
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel, Partials.Message],
  });
  client.once('clientReady', (readyClient) => {
    readyClient.user.setPresence({ status: 'online', activities: [{ name: PRESENCE_TEXT, type: ActivityType.Watching }] });
    console.log(`[DiscordIngress] READY as ${readyClient.user.tag}`);
    console.log(`[DiscordIngress] Presence: ${PRESENCE_TEXT}`);
    console.log(`[DiscordIngress] DSH endpoint: ${DSH_INGRESS_URL}/api/discord/gateway-ingress`);
    void resumePendingMtFixItDeliveries('discord', async (record, outcome) => {
      await sendDiscordMtFixItMessage(record.channelId, mtFixItPublicReply(outcome));
    }).then((count) => {
      if (count) console.log(`[DiscordIngress] Resumed ${count} pending Discord MtFixIt delivery record(s).`);
    }).catch((error) => console.error('[DiscordIngress] Failed to resume MtFixIt deliveries:', error));
  });
  client.on('messageCreate', (message) => { forwardMessage(message).catch((error) => console.error(`[DiscordIngress] Failed ${message.id}:`, error)); });
  client.on('interactionCreate', (interaction) => {
    handleMtFixItDecision(interaction).catch(async (error) => {
      console.error('[DiscordIngress] MtFixIt interaction failed:', error);
      if (interaction.isRepliable?.()) await interaction.followUp?.({ content: 'MtFixIt could not process that decision. The repair has not been approved.', ephemeral: true }).catch(() => undefined);
    });
  });
  client.on('error', (error) => console.error('[DiscordIngress] Client error:', error));
  client.on('warn', (warning) => console.warn('[DiscordIngress] Client warning:', warning));
  client.on('shardDisconnect', (event, shardId) => console.warn(`[DiscordIngress] Shard ${shardId} disconnected (${event.code})`));
  client.on('shardResume', (shardId, replayedEvents) => console.log(`[DiscordIngress] Shard ${shardId} resumed; replayed ${replayedEvents} events`));
  await client.login(DISCORD_BOT_TOKEN);
}

main().catch((error) => {
  console.error('[DiscordIngress] Fatal:', error);
  process.exit(1);
});
