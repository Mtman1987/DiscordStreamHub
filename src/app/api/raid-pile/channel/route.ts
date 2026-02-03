import { NextRequest, NextResponse } from 'next/server';
import { RaidPileService } from '@/lib/raid-pile-service';
import { generateRaidPileShoutout } from '@/ai/flows/generate-raid-pile-shoutout';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.BOT_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { channelId } = await request.json();
    
    if (!channelId) {
      return NextResponse.json({ error: 'Channel ID is required' }, { status: 400 });
    }

    const raidPileService = RaidPileService.getInstance();
    const piles = await raidPileService.getAllPiles();
    
    // Generate shoutouts for all members
    const shoutouts: string[] = [];
    
    for (const pile of piles) {
      for (const member of pile.members) {
        const isHolder = pile.holderId === member.userId;
        const shoutoutResult = await generateRaidPileShoutout({
          username: member.username,
          isHolder
        });
        shoutouts.push(shoutoutResult.shoutout);
      }
    }
    
    const embed = raidPileService.generateDiscordEmbed(piles);
    
    // Combine shoutouts and pile display
    const content = {
      content: shoutouts.length > 0 ? 
        `**🏔️ Current Raid Pile Shoutouts:**\n${shoutouts.slice(0, 5).join('\n\n')}\n\n**📋 Pile Status:**` :
        '**🏔️ Raid Pile is empty! Be the first to join!**',
      ...embed
    };

    // Post to Discord
    const discordResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(content),
    });

    if (!discordResponse.ok) {
      const error = await discordResponse.text();
      return NextResponse.json({ error: `Discord API error: ${error}` }, { status: 500 });
    }

    const result = await discordResponse.json();
    return NextResponse.json({ 
      success: true, 
      messageId: result.id,
      totalMembers: piles.reduce((sum, pile) => sum + pile.members.length, 0),
      totalPiles: piles.length
    });

  } catch (error) {
    console.error('Error posting raid pile channel:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}