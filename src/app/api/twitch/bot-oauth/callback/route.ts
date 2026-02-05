import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/server-init';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code || !state) {
    return NextResponse.redirect(new URL('/settings?error=missing_params', request.url));
  }

  try {
    const serverId = state;

    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID!,
        client_secret: process.env.TWITCH_CLIENT_SECRET!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/twitch/bot-oauth/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const tokenData = await tokenResponse.json();

    const userResponse = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Client-Id': process.env.TWITCH_CLIENT_ID!,
      },
    });

    const userData = await userResponse.json();
    const botUser = userData.data[0];

    await db.collection('servers').doc(serverId).collection('config').doc('twitchBotOAuth').set({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      scope: tokenData.scope,
      botUsername: botUser.login,
      botUserId: botUser.id,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.redirect(new URL('/settings?bot_oauth=success', request.url));
  } catch (error) {
    console.error('Bot OAuth callback error:', error);
    return NextResponse.redirect(new URL('/settings?error=bot_oauth_failed', request.url));
  }
}
