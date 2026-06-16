import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedAdminDiscordId } from '@/lib/runtime-config';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

async function fetchDiscord(endpoint: string) {
  if (!BOT_TOKEN) return null;

  const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
    headers: { Authorization: `Bot ${BOT_TOKEN}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(`[admin/access] Discord fetch failed ${endpoint}: ${res.status} ${text}`);
    return null;
  }

  return res.json();
}

function roleMatches(adminRoles: string[] = [], userRoles: string[] = [], guildRoles: any[] = []) {
  const normalizedAdminRoles = adminRoles.map(role => String(role).toLowerCase());
  const roleNames = userRoles
    .map(roleId => guildRoles.find(role => role.id === roleId)?.name)
    .filter(Boolean)
    .map(name => String(name).toLowerCase());

  return userRoles.some(roleId => normalizedAdminRoles.includes(String(roleId).toLowerCase())) ||
    roleNames.some(name => normalizedAdminRoles.includes(name));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const serverId = String(body.serverId || body.guildId || '').trim();
    const userId = String(body.userId || body.discordUserId || '').trim();

    if (!serverId || !userId) {
      return NextResponse.json({ error: 'Missing serverId or userId' }, { status: 400 });
    }

    const existingServer = db.get('servers', serverId) || {};
    const adminRoles: string[] = Array.isArray(existingServer.adminRoles) ? existingServer.adminRoles : [];
    const ownerId = String(existingServer.ownerId || '').trim();

    const [member, guildRoles] = await Promise.all([
      fetchDiscord(`/guilds/${serverId}/members/${userId}`),
      fetchDiscord(`/guilds/${serverId}/roles`),
    ]);

    const memberRoles: string[] = Array.isArray(member?.roles) ? member.roles : [];
    const isOwner = Boolean(userId && (userId === getHardcodedAdminDiscordId() || userId === ownerId));
    const matchedByRole = roleMatches(adminRoles, memberRoles, Array.isArray(guildRoles) ? guildRoles : []);
    const isAdmin = Boolean(isOwner || matchedByRole);
    const isMod = Boolean(matchedByRole);

    return NextResponse.json({
      success: true,
      serverId,
      userId,
      isAdmin,
      isMod,
      isOwner,
      matchedBy: isOwner ? 'owner' : matchedByRole ? 'role' : null,
    });
  } catch (error) {
    console.error('[admin/access] Failed to resolve admin access:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
