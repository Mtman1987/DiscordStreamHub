import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/data/server-init';
import { getAppUrl, getTwitchClientId } from '@/lib/runtime-config';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code || !state) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }

  try {
    const [userId, serverId, threadId] = state.split('_');

    // Exchange code for token
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: getTwitchClientId(),
        client_secret: process.env.TWITCH_CLIENT_SECRET!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${getAppUrl() || request.nextUrl.origin}/api/twitch/schedule-callback`,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const tokenData = await tokenResponse.json();

    // Get Twitch user info
    const userResponse = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Client-Id': getTwitchClientId()
      }
    });

    const userData = await userResponse.json();
    const twitchUser = userData.data[0];

    // Store tokens in user document
    await db.collection('servers').doc(serverId).collection('users').doc(userId).update({
      twitchAccessToken: tokenData.access_token,
      twitchRefreshToken: tokenData.refresh_token,
      twitchId: twitchUser.id,
      twitchLogin: twitchUser.login,
      twitchTokenExpiresAt: Date.now() + (tokenData.expires_in * 1000),
      scheduleScope: true,
      updatedAt: new Date()
    });

    // Post the schedule calendar
    const { generateScheduleEmbed, savePartnerScheduleThread } = await import('@/lib/partner-schedule-service');
    const { postDiscordMessage } = await import('@/lib/discord-sync-service');

    const embed = await generateScheduleEmbed(userId, serverId);
    if (embed) {
      await postDiscordMessage(serverId, threadId, embed);
      await savePartnerScheduleThread(userId, serverId, threadId, threadId);
    }

    return new NextResponse(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>✅ Schedule Connected!</h1>
          <p>Your Twitch schedule calendar has been posted to Discord.</p>
          <p>You can close this window now.</p>
        </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });

  } catch (error) {
    console.error('Schedule OAuth callback error:', error);
    return new NextResponse(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>❌ Error</h1>
          <p>Failed to connect schedule. Please try again.</p>
        </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' },
      status: 500
    });
  }
}
