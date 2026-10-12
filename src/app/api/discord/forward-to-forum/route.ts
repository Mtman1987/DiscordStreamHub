import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sqliteService } from '@/lib/sqlite-service';
import { ensureMirrorThread, loadForumRule, mirrorChannelAllowed, forumDiscordRequest, publicMirrorChannel, removeRestrictedMirror } from '@/lib/discord-forum-mirror';

const DISCORD_API = 'https://discord.com/api/v10';

const discordRequest = forumDiscordRequest;

/** Resolve a guild ID to a display name (cached in DB, falls back to Discord API). */
async function getGuildName(guildId: string): Promise<string> {
  try {
    const cached = await db.collection('servers').doc(guildId).get();
    if (cached.exists) {
      const name = cached.data()?.name || cached.data()?.guildName;
      if (name) return name;
    }
    const guild = await discordRequest(`/guilds/${guildId}`);
    const name = guild.name || guildId;
    // Cache for next time
    await db.collection('servers').doc(guildId).set({ guildName: name }, { merge: true });
    return name;
  } catch {
    return guildId;
  }
}

/** Resolve a channel ID to a channel name via Discord API. */
async function getChannelName(channelId: string): Promise<string> {
  try {
    const ch = await discordRequest(`/channels/${channelId}`);
    return ch.name || channelId;
  } catch {
    return channelId;
  }
}

async function getChannelDetails(channelId: string): Promise<any> {
  return discordRequest(`/channels/${channelId}`);
}

type ForwardedAttachment = {
  url?: string;
  proxy_url?: string;
  content_type?: string;
  filename?: string;
};

type ForwardedMention = {
  id: string;
  username: string;
  global_name?: string;
  displayName?: string;
};

type ForwardedEmbed = Record<string, any>;
type ForwardedSticker = Record<string, any>;
type ForwardedEmote = {
  id: string;
  name: string;
  animated: boolean;
  url: string;
};

type MediaExtraction = {
  description?: string;
  imageUrl?: string;
  attachmentUrls: string[];
};

const THREAD_CHANNEL_TYPES = new Set([10, 11, 12]);
const URL_PATTERN = /https?:\/\/[^\s<>()]+/gi;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

function cleanUrlMatch(url: string) {
  return url.replace(/[.,!?;:]+$/g, '');
}

function getUrlPathname(url: string) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function hasImageExtension(url: string) {
  const pathname = getUrlPathname(url);
  return Array.from(IMAGE_EXTENSIONS).some(ext => pathname.endsWith(ext));
}

function isImageAttachment(attachment: ForwardedAttachment) {
  if (attachment.content_type?.toLowerCase().startsWith('image/')) return true;
  return Boolean(attachment.url && hasImageExtension(attachment.url));
}

function normalizeAttachments(value: unknown): ForwardedAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((attachment: any) => ({
      url: typeof attachment?.url === 'string' ? attachment.url : undefined,
      proxy_url: typeof attachment?.proxy_url === 'string' ? attachment.proxy_url : undefined,
      content_type: typeof attachment?.content_type === 'string' ? attachment.content_type : undefined,
      filename: typeof attachment?.filename === 'string' ? attachment.filename : undefined,
    }))
    .filter(attachment => Boolean(attachment.url || attachment.proxy_url));
}

function normalizeMentions(value: unknown): ForwardedMention[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((mention: any) => ({
      id: String(mention?.id || mention?.userId || '').trim(),
      username: String(mention?.username || mention?.global_name || mention?.displayName || mention?.name || '').trim(),
      global_name: typeof mention?.global_name === 'string' ? mention.global_name : undefined,
      displayName: typeof mention?.displayName === 'string' ? mention.displayName : undefined,
    }))
    .filter(mention => mention.id && mention.username);
}

function normalizeEmbeds(value: unknown): ForwardedEmbed[] {
  if (!Array.isArray(value)) return [];
  return value.filter((embed): embed is ForwardedEmbed => Boolean(embed && typeof embed === 'object')).slice(0, 5);
}

function normalizeStickers(value: unknown): ForwardedSticker[] {
  if (!Array.isArray(value)) return [];
  return value.filter((sticker): sticker is ForwardedSticker => Boolean(sticker && typeof sticker === 'object')).slice(0, 10);
}

function displayNameForMention(mention: ForwardedMention) {
  return mention.displayName || mention.global_name || mention.username || mention.id;
}

function normalizeDiscordContent(message: string, mentions: ForwardedMention[]) {
  let normalized = String(message || '');
  for (const mention of mentions) {
    const label = `@${displayNameForMention(mention)}`;
    normalized = normalized.replace(new RegExp(`<@!?${mention.id}>`, 'g'), label);
  }
  normalized = normalized.replace(/<#(\d+)>/g, '#channel-$1');
  normalized = normalized.replace(/<@&(\d+)>/g, '@role-$1');
  normalized = normalized.replace(/<a?:([a-zA-Z0-9_]+):\d+>/g, ':$1:');
  return normalized.trim();
}

function extractCustomEmotes(message: string): ForwardedEmote[] {
  const emotes: ForwardedEmote[] = [];
  const seen = new Set<string>();
  for (const match of String(message || '').matchAll(/<(a?):([a-zA-Z0-9_]+):(\d+)>/g)) {
    const animated = match[1] === 'a';
    const name = match[2];
    const id = match[3];
    if (seen.has(id)) continue;
    seen.add(id);
    emotes.push({
      id,
      name,
      animated,
      url: `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'webp'}`,
    });
  }
  return emotes;
}

function extractEmbedImageUrls(embeds: ForwardedEmbed[]) {
  return embeds
    .flatMap(embed => [
      typeof embed?.image?.url === 'string' ? embed.image.url : '',
      typeof embed?.thumbnail?.url === 'string' ? embed.thumbnail.url : '',
      typeof embed?.video?.url === 'string' ? embed.video.url : '',
    ])
    .filter(Boolean);
}

function extractForwardedMedia(message: string, attachments: ForwardedAttachment[], embeds: ForwardedEmbed[]): MediaExtraction {
  const attachmentImage = attachments.find(isImageAttachment);
  const attachmentUrls = attachments
    .map(attachment => attachment.url || attachment.proxy_url)
    .filter((url): url is string => Boolean(url));

  const embedImageUrls = extractEmbedImageUrls(embeds);
  const urls = Array.from(message.matchAll(URL_PATTERN), match => cleanUrlMatch(match[0]));
  const imageUrl = attachmentImage?.url || attachmentImage?.proxy_url || urls.find(hasImageExtension) || embedImageUrls[0];
  const mediaUrlsToRemove = new Set<string>(imageUrl ? [imageUrl] : []);

  let description = message;
  for (const url of mediaUrlsToRemove) {
    description = description.replace(url, '').trim();
  }

  description = description.replace(/\s{2,}/g, ' ').trim();

  return {
    description: description || undefined,
    imageUrl,
    attachmentUrls: [...attachmentUrls, ...embedImageUrls].filter(url => url !== imageUrl),
  };
}

async function mirrorForwardToSpaceMountain(input: {
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
  messageChannelId?: string;
  messageId: string;
  userName: string;
  userAvatar?: string;
  message: string;
  attachments: ForwardedAttachment[];
  embeds: ForwardedEmbed[];
  mentions: ForwardedMention[];
  stickers: ForwardedSticker[];
  emotes: ForwardedEmote[];
}) {
  const endpoint = (process.env.SPACEMOUNTAIN_FORUM_FORWARD_URL || 'https://spacemountain.live/api/integrations/dsh/forum-forward').trim();
  if (!endpoint) return;

  const attachmentUrls = input.attachments
    .map(attachment => attachment.url || attachment.proxy_url)
    .filter((url): url is string => Boolean(url));
  const content = [
    input.message,
    ...attachmentUrls.map(url => `Attachment: ${url}`),
    ...extractEmbedImageUrls(input.embeds).map(url => `Embed media: ${url}`),
    ...input.emotes.map(emote => `Emote :${emote.name}: ${emote.url}`),
    ...input.stickers.map(sticker => `Sticker: ${String(sticker.name || sticker.id || 'sticker')}`),
  ].filter(Boolean).join('\n');

  if (!content.trim()) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.SPACEMOUNTAIN_FORUM_FORWARD_TOKEN) {
      headers.Authorization = `Bearer ${process.env.SPACEMOUNTAIN_FORUM_FORWARD_TOKEN}`;
    }

    const sourceMessageChannelId = input.messageChannelId || input.channelId;
    const sourceMessageUrl = sourceMessageChannelId && input.messageId
      ? `https://discord.com/channels/${input.guildId}/${sourceMessageChannelId}/${input.messageId}`
      : null;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        id: input.messageId ? `${input.guildId}_${input.messageId}` : undefined,
        sourceApp: 'discord-stream-hub',
        sourceServerId: input.guildId,
        sourceChannelId: input.channelId,
        sourceChannelName: input.channelName,
        sourceMessageId: input.messageId || undefined,
        sourceMessageUrl,
        authorName: input.userName,
        title: `${input.guildName} / #${input.channelName}`,
        content,
        attachments: input.attachments,
        embeds: input.embeds,
        mentions: input.mentions.map(mention => ({ id: mention.id, username: displayNameForMention(mention) })),
        mentionedUsers: input.mentions.reduce((acc: Record<string, string>, mention) => {
          acc[mention.id] = displayNameForMention(mention);
          return acc;
        }, {}),
        stickers: input.stickers,
        emotes: input.emotes,
        category: 'Discord Forward',
        postedAt: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`[ForwardForum] SpaceMountain forum mirror returned ${response.status}: ${text.slice(0, 200)}`);
    }
  } catch (error) {
    console.warn('[ForwardForum] SpaceMountain forum mirror failed:', error);
  } finally {
    clearTimeout(timer);
  }
}

async function resolveForwardingSourceChannel(channelId: string): Promise<{
  sourceChannelId: string;
  sourceChannelName: string;
  messageChannelId: string;
  skipForum?: boolean;
  privateThread?: boolean;
}> {
  if (!channelId) {
    return {
      sourceChannelId: '',
      sourceChannelName: 'unknown',
      messageChannelId: '',
    };
  }

  const details = await getChannelDetails(channelId);
  const channelType = Number(details?.type);
  const parentId = typeof details?.parent_id === 'string' ? details.parent_id : '';

  if (THREAD_CHANNEL_TYPES.has(channelType) && parentId) {
    const parent = await getChannelDetails(parentId);
    return {
      sourceChannelId: parentId,
      sourceChannelName: parent?.name || parentId,
      messageChannelId: channelId,
      skipForum: [15, 16].includes(Number(parent?.type)),
      privateThread: channelType === 12,
    };
  }

  return {
    sourceChannelId: channelId,
    sourceChannelName: details?.name || await getChannelName(channelId),
    messageChannelId: channelId,
    skipForum: [15, 16].includes(channelType),
  };
}

export async function POST(request: NextRequest) {
  let messageLease = '';
  const messageOwner = crypto.randomUUID();
  try {
    if (!process.env.DISCORD_BOT_TOKEN || request.headers.get('x-discord-bot-token') !== process.env.DISCORD_BOT_TOKEN) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const raw = await request.text();
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      try {
        body = JSON.parse(raw.replace(/[\x00-\x1F\x7F]/g, ''));
      } catch {
        console.log('[ForwardForum] Rejected malformed JSON payload.');
        return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
      }
    }

    const data = body.root || body;
    const userId = data.userId;
    const guildId = data.guildId || data.serverId;
    const userName = data.userName || data.displayName || data.username || 'Unknown';
    const userAvatar = data.userAvatar || data.avatarUrl || '';
    const message = data.message || data.content || '';
    const messageChannelId = data.channelId || '';
    const messageId = data.messageId || '';
    const attachments = normalizeAttachments(data.attachments);
    const mentions = normalizeMentions(data.mentions);
    const embeds = normalizeEmbeds(data.embeds);
    const stickers = normalizeStickers(data.sticker_items || data.stickers);
    const emotes = extractCustomEmotes(message);
    const normalizedMessage = normalizeDiscordContent(message, mentions);

    if (!guildId) {
      return NextResponse.json({ error: 'guildId required' }, { status: 400 });
    }

    if (!message && attachments.length === 0 && embeds.length === 0 && stickers.length === 0) {
      return NextResponse.json({ success: true, skipped: 'empty-message' });
    }

    const [guildName, sourceChannel] = await Promise.all([
      getGuildName(guildId),
      resolveForwardingSourceChannel(messageChannelId),
    ]);
    if (sourceChannel.skipForum) return NextResponse.json({ success: true, skipped: 'source-forum-channel' });
    if (sourceChannel.privateThread) return NextResponse.json({ success: true, skipped: 'private-source-thread' });
    const channelId = sourceChannel.sourceChannelId || messageChannelId;
    const channelName = sourceChannel.sourceChannelName;

    const media = extractForwardedMedia(normalizedMessage, attachments, embeds);

    // Build the forwarded message embed. Controls are intentionally omitted so the
    // forum post stays clean; native replies/reactions can be mirrored by a watcher.
    const embed: Record<string, any> = {
      color: 0x5865f2,
      author: {
        name: `${userName}`,
        icon_url: userAvatar || undefined,
      },
      footer: {
        text: `${guildName} · #${channelName}`,
      },
      timestamp: new Date().toISOString(),
    };

    if (media.description) {
      embed.description = media.description.slice(0, 4096);
    }
    if (media.imageUrl) {
      embed.image = { url: media.imageUrl };
    }
    const fields: any[] = [];
    if (media.attachmentUrls.length > 0) {
      fields.push({
        name: 'Attachments',
        value: media.attachmentUrls.map(url => `[Open attachment](${url})`).join('\n').slice(0, 1024),
      });
    }
    for (const sourceEmbed of embeds.slice(0, 3)) {
      const title = typeof sourceEmbed.title === 'string' ? sourceEmbed.title : '';
      const description = typeof sourceEmbed.description === 'string' ? sourceEmbed.description : '';
      if (title || description) {
        fields.push({
          name: title ? `Embed: ${title}`.slice(0, 256) : 'Embed',
          value: (description || sourceEmbed.url || 'Embedded Discord content').slice(0, 1024),
        });
      }
    }
    if (stickers.length > 0) {
      fields.push({
        name: 'Stickers',
        value: stickers.map(sticker => String(sticker.name || sticker.id || 'sticker')).join(', ').slice(0, 1024),
      });
    }
    if (fields.length > 0) {
      embed.fields = fields.slice(0, 10);
    }

    const components: any[] = [];

    const forumRule = loadForumRule(guildId);
    if (forumRule?.paused) return NextResponse.json({ success: true, skipped: 'forwarding-paused' });
    if (!forumRule) {
      return NextResponse.json({ error: 'No forwarding rule configured for this source server' }, { status: 404 });
    }

    if (!mirrorChannelAllowed(forumRule, channelId)) return NextResponse.json({ success: true, skipped: 'source-channel-not-whitelisted' });
    if (!channelId) return NextResponse.json({ error: 'source channel required' }, { status: 400 });
    if (forumRule.sourceServerId === forumRule.destinationServerId && channelId === forumRule.forumChannelId) {
      return NextResponse.json({ success: true, skipped: 'destination-forum' });
    }
    if (!await publicMirrorChannel(guildId, channelId)) {
      await removeRestrictedMirror(forumRule, channelId);
      return NextResponse.json({ success: true, skipped: 'restricted-source-channel' });
    }
    if (messageId) {
      messageLease = 'forum-message:' + guildId + ':' + messageId;
      for (let attempt = 0; !sqliteService.claimLease(messageLease, messageOwner); attempt++) {
        if (attempt >= 100) throw new Error('This message is already being forwarded. Retry shortly.');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    const prior = messageId ? db.get('forwardedMessageIndex', 'origin_' + messageId) : null;
    if (prior?.forwardedMessageId) return NextResponse.json({ success: true, forwardedMessageId: prior.forwardedMessageId, skipped: 'already-forwarded' });
    const { threadId } = await ensureMirrorThread(forumRule, { id: channelId, name: channelName });
    if (!await publicMirrorChannel(guildId, channelId)) {
      await removeRestrictedMirror(forumRule, channelId);
      return NextResponse.json({ success: true, skipped: 'restricted-source-channel' });
    }
    const posted = await discordRequest(`/channels/${threadId}/messages`, {
      method: 'POST', body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] }, ...(messageId ? { nonce: messageId, enforce_nonce: true } : {}) }),
    });
    const forwardedMessageId = posted?.id;
    const forwardingMode = forumRule.forwardingMode || 'per-source-thread';

    // Store mappings so delete events can reconcile forwarded/original message state.
    if (forwardedMessageId) {
      const mapping = {
        forwardedMessageId,
        forwardedThreadId: threadId,
        originGuildId: guildId,
        originChannelId: messageChannelId,
        originSourceChannelId: channelId,
        originMessageId: messageId,
        originUserName: userName,
        originUserAvatar: userAvatar,
        sourceServerId: guildId,
        destinationServerId: forumRule.destinationServerId,
        forwardingMode,
        createdAt: new Date().toISOString(),
      };

      await db
        .collection('servers')
        .doc(guildId)
        .collection('forwardedMessages')
        .doc(forwardedMessageId)
        .set(mapping);

      await db.collection('forwardedMessageIndex').doc(`forwarded_${forwardedMessageId}`).set({
        ...mapping,
        indexType: 'forwarded',
        indexedMessageId: forwardedMessageId,
      });

      if (messageId) {
        await db.collection('forwardedMessageIndex').doc(`origin_${messageId}`).set({
          ...mapping,
          indexType: 'origin',
          indexedMessageId: messageId,
        });
      }
    }

    console.log(`[ForwardForum] Forwarded message from ${userName} (${guildName}/#${channelName}) → thread ${threadId}`);

    if (!await publicMirrorChannel(guildId, channelId)) {
      await removeRestrictedMirror(forumRule, channelId);
      return NextResponse.json({ success: true, skipped: 'restricted-source-channel' });
    }
    // Also forward directly into the SpaceMountain website forum feed.
    await mirrorForwardToSpaceMountain({
      guildId,
      guildName,
      channelId: channelId || guildId,
      channelName,
      messageChannelId,
      messageId,
      userName,
      userAvatar,
      message: normalizedMessage || message,
      embeds,
      mentions,
      stickers,
      attachments,
      emotes,
    });

    if (!await publicMirrorChannel(guildId, channelId)) {
      await removeRestrictedMirror(forumRule, channelId);
      return NextResponse.json({ success: true, skipped: 'restricted-source-channel' });
    }
    // Keep the older spmt.live mirror for compatibility with the account/forum app.
    try {
      await fetch('https://spmt.live/api/forum/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-spmt-key': process.env.SPMT_SYSTEM_KEY || '' },
        signal: AbortSignal.timeout(1500),
        body: JSON.stringify({
          channelId: channelId || guildId,
          messageChannelId,
          channelName,
          guildName,
          userName,
          userAvatar,
          message: normalizedMessage || message,
          embeds,
          mentions: mentions.map(mention => ({ id: mention.id, username: displayNameForMention(mention) })),
          stickers,
          emotes,
          attachments: normalizeAttachments(data.attachments),
        }),
      });
    } catch (e) {
      console.warn('[ForwardForum] spmt.live forward failed:', e);
    }

    return NextResponse.json({ success: true, forwardedMessageId });
  } catch (error) {
    console.error('[ForwardForum] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  } finally {
    if (messageLease) sqliteService.releaseLease(messageLease, messageOwner);
  }
}
