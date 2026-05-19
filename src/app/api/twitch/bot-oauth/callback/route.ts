import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function getTwitchOAuthConfig() {
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.NEXT_PUBLIC_TWITCH_CLIENT_SECRET || process.env.TWITCH_CLIENT_SECRET;
  return { clientId, clientSecret };
}

function getPublicUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const publicUrl = getPublicUrl(request);

  if (!code || !state) {
    return NextResponse.redirect(`${publicUrl}/settings?error=missing_params`);
  }

  try {
    // State can be: serverId|discordUserId|twitchLogin (bot linking) or just serverId (OAuth card)
    const stateParts = state.split('|');
    const serverId = stateParts[0];
    const discordUserId = stateParts[1] || null;
    const twitchLogin = stateParts[2] || null;
    const redirectUri = `${publicUrl}/api/twitch/bot-oauth/callback`;
    const { clientId, clientSecret } = getTwitchOAuthConfig();

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(`${publicUrl}/settings?error=twitch_oauth_not_configured`);
    }

    console.log(`[BotOAuth] Exchanging code for user ${discordUserId}`);

    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[BotOAuth] Token exchange failed:', tokenResponse.status, errorText);
      return NextResponse.redirect(`${publicUrl}/settings?error=token_exchange_failed`);
    }

    const tokenData = await tokenResponse.json();

    const userResponse = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Client-Id': clientId,
      },
    });

    const userData = await userResponse.json();
    const botUser = userData.data[0];

    // Store token
    if (discordUserId) {
      // Per-user bot token (bot linking card flow)
      const { storeUserBotToken } = await import('@/lib/token-service');
      await storeUserBotToken(
        serverId,
        discordUserId,
        tokenData.access_token,
        tokenData.refresh_token,
        tokenData.expires_in,
        botUser.login,
        botUser.id,
        twitchLogin || botUser.login
      );
    } else {
      // Server-wide bot token (OAuth card flow)
      await db.collection('servers').doc(serverId).collection('config').doc('twitchBotOAuth').set({
        botUsername: botUser.login,
        botUserId: botUser.id,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + (tokenData.expires_in * 1000),
        updatedAt: new Date().toISOString(),
      });
      // Also save to users collection for status check
      const uid = `twitch_${serverId}`;
      await db.setAsync('users', uid, {
        id: botUser.id,
        username: botUser.login,
        displayName: botUser.display_name,
        photoURL: botUser.profile_image_url,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + (tokenData.expires_in * 1000),
        source: 'twitch',
        serverId,
        updatedAt: new Date().toISOString(),
      });
    }

    console.log(`[BotOAuth] Success! Token stored for ${discordUserId || 'server'} (${botUser.login})`);
    return NextResponse.redirect(`${publicUrl}/settings?oauth=success&provider=twitch`);
  } catch (error) {
    console.error('[BotOAuth] Error:', error);
    return NextResponse.redirect(`${publicUrl}/settings?error=bot_oauth_failed`);
  }
}
