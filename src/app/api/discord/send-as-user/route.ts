import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/server-init';

export async function POST(request: NextRequest) {
  try {
    const { channelId, content, username, avatarUrl } = await request.json();
    
    console.log('[send-as-user] Request:', { channelId, content, username, avatarUrl });

    if (!channelId || !content) {
      console.log('[send-as-user] Missing required fields');
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const displayUsername = username || 'Discord User';
    const displayAvatar = avatarUrl || undefined;
    
    console.log('[send-as-user] Using:', { displayUsername, displayAvatar });

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      console.error('[send-as-user] Bot token not configured');
      return NextResponse.json({ error: 'Bot token not configured' }, { status: 500 });
    }

    // Check Firestore for saved webhook
    console.log('[send-as-user] Checking Firestore for webhook');
    const webhookDoc = await db.collection('webhooks').doc(channelId).get();
    let webhook = webhookDoc.exists ? webhookDoc.data() : null;

    if (!webhook) {
      console.log('[send-as-user] No webhook in Firestore, fetching from Discord');
      // Try to get existing webhooks from Discord first
      const webhooksResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, {
        headers: { 'Authorization': `Bot ${botToken}` }
      });

      if (webhooksResponse.ok) {
        const webhooks = await webhooksResponse.json();
        webhook = webhooks.find((w: any) => w.name === 'Stream Hub') || webhooks[0];
        console.log('[send-as-user] Found existing webhook:', webhook?.id);
      }

      // If still no webhook, create one
      if (!webhook) {
        console.log('[send-as-user] Creating new webhook');
        const createResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, {
          method: 'POST',
          headers: {
            'Authorization': `Bot ${botToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name: 'Stream Hub' })
        });

        if (!createResponse.ok) {
          const error = await createResponse.text();
          console.error('[send-as-user] Failed to create webhook:', createResponse.status, error);
          return NextResponse.json({ error: 'Failed to create webhook' }, { status: createResponse.status });
        }

        webhook = await createResponse.json();
        console.log('[send-as-user] Created webhook:', webhook.id);
      }
      
      // Save to Firestore
      await db.collection('webhooks').doc(channelId).set({
        id: webhook.id,
        token: webhook.token,
        channelId: channelId
      });
      console.log('[send-as-user] Saved webhook to Firestore');
    } else {
      console.log('[send-as-user] Using webhook from Firestore:', webhook.id);
    }

    // Send message via webhook with custom username and avatar
    const messageResponse = await fetch(`https://discord.com/api/v10/webhooks/${webhook.id}/${webhook.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        username: displayUsername,
        avatar_url: displayAvatar
      })
    });

    if (!messageResponse.ok) {
      const error = await messageResponse.text();
      console.error('[send-as-user] Discord webhook error:', error);
      return NextResponse.json({ error: `Failed to send message: ${error}` }, { status: messageResponse.status });
    }

    console.log('[send-as-user] Message sent successfully');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Send as user error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
