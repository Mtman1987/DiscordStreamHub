import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedAdminDiscordId } from '@/lib/runtime-config';

const OWNER_ROLE_ID = '1283213615939194955';

function isAdminOrOwner(serverId: string, userId: string) {
  if (!serverId || !userId) return false;
  if (userId === getHardcodedAdminDiscordId()) return true;

  const server = db.get('servers', serverId) || {};
  const adminRoles: string[] = Array.isArray(server.adminRoles) ? server.adminRoles.map((role: unknown) => String(role).toLowerCase()) : [];
  if (String(server.ownerId || '').trim() === userId) return true;

  const user = db.get(`servers/${serverId}/users`, userId) || {};
  const roles = Array.isArray(user.roles) ? user.roles.map(String) : [];
  const roleNames = Array.isArray(user.roleNames) ? user.roleNames.map((role: unknown) => String(role).toLowerCase()) : [];

  return roles.includes(OWNER_ROLE_ID) ||
    roles.some((role: string) => adminRoles.includes(role.toLowerCase())) ||
    roleNames.some((role: string) => adminRoles.includes(role));
}

function parseColor(color: unknown) {
  const raw = String(color || '').trim().replace(/^#/, '');
  if (!raw) return 0x5865F2;
  const parsed = Number.parseInt(raw, 16);
  return Number.isFinite(parsed) ? parsed : 0x5865F2;
}

async function addReaction(channelId: string, messageId: string, emoji: string, botToken: string) {
  const encoded = encodeURIComponent(emoji);
  await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${botToken}` },
  });
}

export async function POST(req: NextRequest) {
  try {
    const {
      serverId,
      channelId,
      authorId,
      audience,
      title,
      description,
      approveLabel,
      denyLabel,
      approveEmoji,
      denyEmoji,
      color,
      referenceUrl,
    } = await req.json();

    if (!serverId || !channelId || !authorId || !title || !description) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!isAdminOrOwner(String(serverId), String(authorId))) {
      return NextResponse.json({ error: 'Only admins can post proposals' }, { status: 403 });
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ error: 'Bot token not configured' }, { status: 500 });
    }

    const cleanApproveEmoji = String(approveEmoji || '✅').trim() || '✅';
    const cleanDenyEmoji = String(denyEmoji || '❌').trim() || '❌';
    const cleanAudience = String(audience || 'community').trim();

    const embed: any = {
      title: String(title).slice(0, 256),
      description: String(description).slice(0, 4096),
      color: parseColor(color),
      fields: [
        {
          name: 'Voting',
          value: `${cleanApproveEmoji} ${approveLabel || 'Approve'}\n${cleanDenyEmoji} ${denyLabel || 'Deny'}`,
          inline: false,
        },
        {
          name: 'Audience',
          value: cleanAudience === 'admin' ? 'Admin-only review' : cleanAudience === 'targeted' ? 'Targeted community review' : 'Full community review',
          inline: true,
        },
      ],
      footer: { text: 'React below to vote. Final decision remains owner/admin controlled.' },
      timestamp: new Date().toISOString(),
    };

    if (referenceUrl) {
      embed.fields.push({
        name: 'Reference',
        value: `[Open related notes or attachment](${String(referenceUrl).slice(0, 500)})`,
        inline: false,
      });
    }

    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Discord proposal post failed:', error);
      return NextResponse.json({ error: 'Failed to post proposal to Discord' }, { status: response.status });
    }

    const message = await response.json();
    await Promise.all([
      addReaction(channelId, message.id, cleanApproveEmoji, botToken),
      addReaction(channelId, message.id, cleanDenyEmoji, botToken),
    ]);

    const proposalRef = await db.collection('servers').doc(serverId).collection('proposals').add({
      title: String(title),
      description: String(description),
      audience: cleanAudience,
      channelId,
      messageId: message.id,
      approveLabel: approveLabel || 'Approve',
      denyLabel: denyLabel || 'Deny',
      approveEmoji: cleanApproveEmoji,
      denyEmoji: cleanDenyEmoji,
      referenceUrl: referenceUrl || '',
      createdBy: authorId,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, proposalId: proposalRef.id, messageId: message.id });
  } catch (error) {
    console.error('Error posting proposal:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
