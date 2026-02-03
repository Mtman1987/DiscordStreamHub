'use server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/server-init';

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
    
    // Fall back to Firestore
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
