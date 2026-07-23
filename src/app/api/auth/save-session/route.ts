import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedAdminDiscordId } from '@/lib/runtime-config';
import { grandfatherDiscordIdentity } from '@/lib/spmt-client';
import { DSH_SPMT_COOKIE } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

async function fetchDiscord(endpoint: string) {
  if (!BOT_TOKEN) return null;

  const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
    headers: { Authorization: `Bot ${BOT_TOKEN}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(`[auth/save-session] Discord fetch failed ${endpoint}: ${res.status} ${text}`);
    return null;
  }

  return res.json();
}

function avatarUrl(user: any) {
  if (!user?.avatar || !user?.id) return '';
  const ext = String(user.avatar).startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}`;
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

function determineGroup(roleMappings: Record<string, string> = {}, userRoles: string[] = []) {
  const priority = ['Crew', 'Partners', 'Honored Guests', 'Raid Pile', 'Everyone Else'];
  for (const group of priority) {
    if (userRoles.some(roleId => roleMappings[roleId] === group)) return group;
  }
  return 'Community';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const discordServerId = body.discordServerId || body.serverId || body.guildId;
    const discordUserId = body.discordUserId || body.userId || body.ownerId || '';
    const twitchUsername = body.twitchUsername || body.username || '';

    if (!discordServerId) {
      return NextResponse.json({ error: 'Missing serverId' }, { status: 400 });
    }

    const existingServer = db.get('servers', discordServerId) || {};
    const [guild, member, guildRoles] = await Promise.all([
      fetchDiscord(`/guilds/${discordServerId}`),
      discordUserId ? fetchDiscord(`/guilds/${discordServerId}/members/${discordUserId}`) : Promise.resolve(null),
      fetchDiscord(`/guilds/${discordServerId}/roles`),
    ]);

    const discordUser = member?.user || {};
    const memberRoles: string[] = Array.isArray(member?.roles) ? member.roles : [];
    const adminRoles: string[] = Array.isArray(existingServer.adminRoles) ? existingServer.adminRoles : [];
    const isAdmin = Boolean(
      discordUserId && (
        discordUserId === getHardcodedAdminDiscordId() ||
        discordUserId === existingServer.ownerId ||
        roleMatches(adminRoles, memberRoles, Array.isArray(guildRoles) ? guildRoles : [])
      )
    );
    const displayName = member?.nick || discordUser.global_name || discordUser.username || body.discordUsername || body.username || discordUserId;
    const username = discordUser.username || body.discordUsername || body.username || discordUserId;
    const resolvedAvatar = avatarUrl(discordUser) || body.discordAvatar || body.avatar || '';
    const resolvedServerName = guild?.name || body.serverName || body.name || existingServer.serverName || '';
    const resolvedIconUrl = guild?.icon
      ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
      : (body.iconUrl || body.icon || existingServer.iconUrl || '');

    db.set('servers', discordServerId, {
      ...existingServer,
      ownerId: existingServer.ownerId || body.ownerId || '',
      twitchUsername: twitchUsername || '',
      discordUserId,
      discordUsername: username,
      discordAvatar: resolvedAvatar,
      serverName: resolvedServerName,
      iconUrl: resolvedIconUrl,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    if (discordUserId) {
      db.set(`servers/${discordServerId}/users`, discordUserId, {
        discordUserId,
        username,
        displayName,
        avatarUrl: resolvedAvatar,
        roles: memberRoles,
        roleNames: memberRoles.map(roleId => (Array.isArray(guildRoles) ? guildRoles : []).find(role => role.id === roleId)?.name).filter(Boolean),
        group: determineGroup(existingServer.roleMappings || {}, memberRoles),
        isAdmin,
        twitchLogin: twitchUsername || '',
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }

    db.set('userSessions', discordServerId, {
      serverId: discordServerId,
      discordUserId,
      twitchUsername: twitchUsername || '',
      discordUsername: username,
      discordDisplayName: displayName,
      discordAvatar: resolvedAvatar,
      serverName: resolvedServerName,
      iconUrl: resolvedIconUrl,
      isAdmin,
      updatedAt: new Date().toISOString(),
    });

    const grandfathered = member?.user && discordUserId
      ? await grandfatherDiscordIdentity({
          discordId: discordUserId,
          discordUsername: discordUser.username || username,
          displayName,
          avatarUrl: resolvedAvatar,
          issueSession: true,
        })
      : null;

    const response = NextResponse.json({
      success: true,
      serverId: discordServerId,
      userId: discordUserId,
      twitchUsername,
      discordUsername: username,
      discordDisplayName: displayName,
      discordAvatar: resolvedAvatar,
      serverName: resolvedServerName,
      iconUrl: resolvedIconUrl,
      isAdmin,
      memberResolved: Boolean(member?.user),
      spmtUserId: grandfathered?.user.id || null,
    });
    if (grandfathered?.accessToken) {
      response.cookies.set(DSH_SPMT_COOKIE, grandfathered.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60,
      });
    }
    return response;
  } catch (error) {
    console.error('Save session failed:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
