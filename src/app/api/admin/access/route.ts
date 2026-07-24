import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedAdminDiscordId } from '@/lib/runtime-config';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_SNOWFLAKE_RE = /^\d{17,20}$/;

async function fetchDiscord(endpoint: string) {
  if (!BOT_TOKEN) return null;

  let res: Response;
  try {
    res = await fetch(`https://discord.com/api/v10${endpoint}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(3500),
    });
  } catch (error) {
    console.warn(`[admin/access] Discord fetch failed ${endpoint}:`, error instanceof Error ? error.message : String(error));
    return null;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(`[admin/access] Discord fetch failed ${endpoint}: ${res.status} ${text}`);
    return null;
  }

  return res.json();
}

function roleMatches(adminRoles: string[] = [], userRoles: string[] = [], guildRoles: any[] = [], storedRoleNames: string[] = []) {
  const normalizedAdminRoles = adminRoles.map(role => String(role).toLowerCase());
  const roleNames = [
    ...storedRoleNames,
    ...userRoles.map(roleId => guildRoles.find(role => role.id === roleId)?.name),
  ].filter(Boolean).map(name => String(name).toLowerCase());

  return userRoles.some(roleId => normalizedAdminRoles.includes(String(roleId).toLowerCase())) ||
    roleNames.some(name => normalizedAdminRoles.includes(name));
}

export async function POST(request: NextRequest) {
  try {
    if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const serverId = String(body.serverId || body.guildId || '').trim();
    const userId = String(body.userId || body.discordUserId || '').trim();

    if (!serverId || !userId) {
      return NextResponse.json({ error: 'Missing serverId or userId' }, { status: 400 });
    }

    if (!DISCORD_SNOWFLAKE_RE.test(serverId) || !DISCORD_SNOWFLAKE_RE.test(userId)) {
      return NextResponse.json({
        success: true,
        serverId,
        userId,
        isAdmin: false,
        isMod: false,
        isOwner: false,
        matchedBy: null,
        skipped: 'invalid-discord-id',
      });
    }

    const existingServer = db.get('servers', serverId) || {};
    const adminRoles: string[] = Array.isArray(existingServer.adminRoles) ? existingServer.adminRoles : [];
    const ownerId = String(existingServer.ownerId || '').trim();
    const isOwner = Boolean(userId && (userId === getHardcodedAdminDiscordId() || userId === ownerId));

    const storedMember = db.get(`servers/${serverId}/users`, userId);
    const storedRoles = db.get(`servers/${serverId}/config`, 'roles') || {};
    const hasStoredMember = Boolean(storedMember && Array.isArray(storedMember.roles));
    const hasStoredGuildRoles = Array.isArray(storedRoles.detailed);

    const [member, guildRoles] = hasStoredMember && hasStoredGuildRoles
      ? [storedMember, storedRoles.detailed]
      : await Promise.all([
          fetchDiscord(`/guilds/${serverId}/members/${userId}`),
          fetchDiscord(`/guilds/${serverId}/roles`),
        ]);

    const memberRoles: string[] = Array.isArray(member?.roles) ? member.roles : [];
    const storedRoleNames: string[] = Array.isArray(member?.roleNames) ? member.roleNames : [];
    const matchedByRole = roleMatches(adminRoles, memberRoles, Array.isArray(guildRoles) ? guildRoles : [], storedRoleNames);
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
