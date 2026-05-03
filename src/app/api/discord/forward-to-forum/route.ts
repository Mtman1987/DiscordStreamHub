import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DISCORD_API = 'https://discord.com/api/v10';

async function discordRequest(endpoint: string, options: RequestInit = {}) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN not configured');
  const res = await fetch(`${DISCORD_API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Discord API ${res.status}: ${err}`);
  }
  return res.status === 204 ? null : res.json();
}

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

/**
 * Look up the forum thread ID for a given guild.
 * Stored in: servers/{homeServerId}/config/forwardingForums
 *   { mappings: { [guildId]: threadId } }
 *
 * If no mapping exists, returns null.
 */
async function getForumThreadId(guildId: string): Promise<string | null> {
  const homeServerId = process.env.HARDCODED_GUILD_ID || process.env.GUILD_ID;
  if (!homeServerId) return null;
  try {
    const doc = await db
      .collection('servers')
      .doc(homeServerId)
      .collection('config')
      .doc('forwardingForums')
      .get();
    if (!doc.exists) return null;
    const mappings = doc.data()?.mappings || {};
    return mappings[guildId] || null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      const raw = await request.text();
      body = JSON.parse(raw.replace(/[\x00-\x1F\x7F]/g, ''));
    }

    const data = body.root || body;
    const userId = data.userId;
    const guildId = data.guildId || data.serverId;
    const userName = data.userName || data.displayName || data.username || 'Unknown';
    const userAvatar = data.userAvatar || data.avatarUrl || '';
    const message = data.message || data.content || '';
    const channelId = data.channelId || '';
    const messageId = data.messageId || '';

    if (!guildId || !message) {
      return NextResponse.json({ error: 'guildId and message required' }, { status: 400 });
    }

    // Resolve where to post
    const threadId = await getForumThreadId(guildId);
    if (!threadId) {
      console.log(`[ForwardForum] No forum thread mapped for guild ${guildId}`);
      return NextResponse.json({ error: 'No forum thread configured for this guild' }, { status: 404 });
    }

    const [guildName, channelName] = await Promise.all([
      getGuildName(guildId),
      channelId ? getChannelName(channelId) : Promise.resolve('unknown'),
    ]);

    // Build the forwarded message embed + action buttons
    const embed = {
      description: message,
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

    // Encode origin info into button custom_ids so interactions can route back
    // Format: fwd_{action}_{originGuildId}_{originChannelId}_{originMessageId}
    const originKey = `${guildId}_${channelId}_${messageId}`;

    const components = [
      {
        type: 1, // ActionRow
        components: [
          {
            type: 2, // Button
            style: 1, // Primary
            label: 'Reply',
            custom_id: `fwd_reply_${originKey}`,
            emoji: { name: '💬' },
          },
          {
            type: 2,
            style: 2, // Secondary
            label: 'React',
            custom_id: `fwd_react_${originKey}`,
            emoji: { name: '😀' },
          },
          {
            type: 2,
            style: 4, // Danger
            label: 'Remove',
            custom_id: `fwd_remove_${originKey}`,
            emoji: { name: '🗑️' },
          },
        ],
      },
    ];

    // Post to the forum thread
    const posted = await discordRequest(`/channels/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ embeds: [embed], components }),
    });

    // Store a mapping so we can find the forwarded message later (for Remove)
    if (posted?.id) {
      const homeServerId = process.env.HARDCODED_GUILD_ID || process.env.GUILD_ID || '';
      await db
        .collection('servers')
        .doc(homeServerId)
        .collection('forwardedMessages')
        .doc(posted.id)
        .set({
          forwardedMessageId: posted.id,
          forwardedThreadId: threadId,
          originGuildId: guildId,
          originChannelId: channelId,
          originMessageId: messageId,
          originUserName: userName,
          originUserAvatar: userAvatar,
          createdAt: new Date().toISOString(),
        });
    }

    console.log(`[ForwardForum] Forwarded message from ${userName} (${guildName}/#${channelName}) → thread ${threadId}`);
    return NextResponse.json({ success: true, forwardedMessageId: posted?.id });
  } catch (error) {
    console.error('[ForwardForum] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
