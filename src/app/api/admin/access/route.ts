import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedAdminDiscordId } from '@/lib/runtime-config';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';
import { DSH_SPMT_COOKIE, resolveSpmtSession } from '@/lib/spmt-session';

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

// Signed-in dashboard users resolve their own access from the browser, where a
// service secret can never be sent, so a matching SPMT session is accepted for
// self lookups only.
async function resolveSelfLookup(request: NextRequest, userId: string): Promise<{ matched: boolean; refreshedToken?: string }> {
  const token = request.cookies.get(DSH_SPMT_COOKIE)?.value || '';
  if (!token || !userId) return { matched: false };

  try {
    const resolved = await resolveSpmtSession(token);
    return {
      matched: String(resolved.session.discordUserId || '').trim() === userId,
      refreshedToken: resolved.token !== token ? resolved.token : undefined,
    };
  } catch (error) {
    console.warn('[admin/access] Session validation failed:', error instanceof Error ? error.message : String(error));
    return { matched: false };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const serverId = String(body.serverId || body.guildId || '').trim();
    const userId = String(body.userId || body.discordUserId || '').trim();

    let refreshedToken: string | undefined;
    let authorized = hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets());
    if (!authorized) {
      const selfLookup = await resolveSelfLookup(request, userId);
      authorized = selfLookup.matched;
      refreshedToken = selfLookup.refreshedToken;
    }
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // SPMT can rotate the session token during validation, so hand the fresh
    // one back instead of leaving the browser with a token it already retired.
    const respond = (payload: Record<string, unknown>, init?: ResponseInit) => {
      const response = NextResponse.json(payload, init);
      if (refreshedToken) {
        response.cookies.set(DSH_SPMT_COOKIE, refreshedToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 24 * 30,
        });
      }
      return response;
    };

    if (!serverId || !userId) {
      return respond({ error: 'Missing serverId or userId' }, { status: 400 });
    }

    if (!DISCORD_SNOWFLAKE_RE.test(serverId) || !DISCORD_SNOWFLAKE_RE.test(userId)) {
      return respond({
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

    return respond({
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
