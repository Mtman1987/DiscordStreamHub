import { NextRequest, NextResponse } from 'next/server';
import { generateShoutoutTemplateEmbed } from '@/lib/member-processing-service';
import { sendDiscordMessage } from '@/lib/discord-bot-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId, channelId, group } = await request.json();

    if (!serverId || !channelId || !group) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Generate the template embed
    const embedData = await generateShoutoutTemplateEmbed(group);
    
    console.log('[API /discord/post-template] Generated embed:', JSON.stringify(embedData, null, 2));

    // Post to Discord
    await sendDiscordMessage(channelId, embedData);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[API /discord/post-template]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
