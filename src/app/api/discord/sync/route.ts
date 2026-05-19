'use server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/data/server-init';

async function fetchFromDiscord(endpoint: string, botToken: string) {
    const response = await fetch(`https://discord.com/api/v10${endpoint}`, {
        headers: { 'Authorization': `Bot ${botToken}` }
    });
    if (!response.ok) {
        throw new Error(`Discord API error for ${endpoint}: ${await response.text()}`);
    }
    return response.json();
}

async function getBotToken(): Promise<string> {
    // Try environment variable first
    if (process.env.DISCORD_BOT_TOKEN) {
        return process.env.DISCORD_BOT_TOKEN;
    }
    
    // Fall back to local secrets
    try {
        const secretDoc = await db.collection('secrets').doc('DISCORD_BOT_TOKEN').get();
        if (!secretDoc.exists) {
            throw new Error('DISCORD_BOT_TOKEN not found in secrets collection or environment');
        }
        const token = secretDoc.data()?.value;
        if (!token) {
            throw new Error('DISCORD_BOT_TOKEN value is empty');
        }
        return token;
    } catch (error) {
        console.error('Error fetching bot token:', error);
        throw new Error('Failed to retrieve Discord Bot Token');
    }
}

function avatarUrl(user: any) {
    if (!user?.avatar || !user?.id) return '';
    const ext = String(user.avatar).startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}`;
}

function determineGroup(roleMappings: Record<string, string> = {}, roles: string[] = []) {
    const priority = ['Crew', 'Partners', 'Honored Guests', 'Raid Pile', 'Everyone Else'];
    for (const group of priority) {
        if (roles.some(roleId => roleMappings[roleId] === group)) return group;
    }
    return 'Community';
}

export async function POST(request: NextRequest) {
    let botToken: string;
    try {
        botToken = await getBotToken();
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to get bot token' }, { status: 500 });
    }

    try {
        const { guildId } = await request.json();
        if (!guildId) {
            return NextResponse.json({ error: 'Guild ID is required.' }, { status: 400 });
        }

        // Fetch all data concurrently
        const [serverData, rolesData, channelsData] = await Promise.all([
            fetchFromDiscord(`/guilds/${guildId}`, botToken),
            fetchFromDiscord(`/guilds/${guildId}/roles`, botToken),
            fetchFromDiscord(`/guilds/${guildId}/channels`, botToken)
        ]);

        // Paginate to get all members
        let allMembers: any[] = [];
        let after = '0';
        while (true) {
            const membersChunk = await fetchFromDiscord(`/guilds/${guildId}/members?limit=1000&after=${after}`, botToken);
            if (membersChunk.length === 0) break;
            allMembers.push(...membersChunk);
            after = membersChunk[membersChunk.length - 1].user.id;
        }

        const serverRef = db.collection('servers').doc(guildId);
        const existingServerDoc = await serverRef.get();
        const existingServer = existingServerDoc.exists ? existingServerDoc.data() : {};
        const roleMappings = existingServer?.roleMappings || {};

        await serverRef.set({
            ...(existingServer || {}),
            serverId: serverData.id,
            serverName: serverData.name,
            iconUrl: serverData.icon ? `https://cdn.discordapp.com/icons/${serverData.id}/${serverData.icon}.png` : (existingServer?.iconUrl || ''),
            updatedAt: new Date().toISOString(),
        }, { merge: true });

        await db.collection('servers').doc(guildId).collection('config').doc('roles').set({
            list: rolesData.map((role: any) => role.name),
            detailed: rolesData.map((role: any) => ({ id: role.id, name: role.name })),
            updatedAt: new Date().toISOString(),
        }, { merge: true });

        await db.collection('servers').doc(guildId).collection('config').doc('channels').set({
            list: channelsData.map((channel: any) => ({ id: channel.id, name: channel.name, type: channel.type })),
            updatedAt: new Date().toISOString(),
        }, { merge: true });

        const batch = db.batch();
        for (const member of allMembers) {
            if (!member?.user?.id || member.user.bot) continue;
            const userRoles: string[] = Array.isArray(member.roles) ? member.roles : [];
            const roleNames = userRoles
                .map(roleId => rolesData.find((role: any) => role.id === roleId)?.name)
                .filter(Boolean);

            batch.set(
                db.collection('servers').doc(guildId).collection('users').doc(member.user.id),
                {
                    discordUserId: member.user.id,
                    username: member.user.username,
                    displayName: member.nick || member.user.global_name || member.user.username,
                    avatarUrl: avatarUrl(member.user),
                    roles: userRoles,
                    roleNames,
                    group: determineGroup(roleMappings, userRoles),
                    isOnline: false,
                    updatedAt: new Date().toISOString(),
                },
                { merge: true }
            );
        }
        await batch.commit();
        
        return NextResponse.json({
            server: {
                serverId: serverData.id,
                serverName: serverData.name,
            },
            roles: rolesData,
            channels: channelsData,
            members: allMembers,
        });

    } catch (error) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        console.error('[API /discord/sync]', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
