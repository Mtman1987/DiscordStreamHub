import { NextRequest, NextResponse } from 'next/server';
import { processDiscordMembers, generateUnmatchedUsersEmbed, generateShoutoutTemplateEmbed } from '@/lib/member-processing-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId, action, group } = await request.json();

    if (!serverId) {
      return NextResponse.json({ error: 'Server ID is required' }, { status: 400 });
    }

    switch (action) {
      case 'process':
        const data = await processDiscordMembers(serverId);
        return NextResponse.json({ data });

      case 'unmatched-embed':
        const unmatchedEmbed = await generateUnmatchedUsersEmbed(serverId);
        return NextResponse.json({ embed: unmatchedEmbed });

      case 'template-embed':
        if (!group) {
          return NextResponse.json({ error: 'Group is required for template embed' }, { status: 400 });
        }
        const templateEmbed = await generateShoutoutTemplateEmbed(group);
        return NextResponse.json({ embed: templateEmbed });

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[API /discord/process-members]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
