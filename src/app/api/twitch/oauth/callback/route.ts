import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';

function popupCallbackResponse(publicUrl: string, payload: Record<string, string>) {
  const targetOrigin = JSON.stringify(publicUrl);
  const message = JSON.stringify({ source: 'twitch-oauth', ...payload });
  const fallbackUrl = new URL('/settings', publicUrl);
  for (const [key, value] of Object.entries(payload)) {
    fallbackUrl.searchParams.set(key, value);
  }

  const html = `<!doctype html>
<html>
  <body>
    <script>
      (function () {
        var payload = ${message};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, ${targetOrigin});
          }
        } catch (e) {}
        window.location.replace(${JSON.stringify(fallbackUrl.toString())});
        setTimeout(function () { window.close(); }, 150);
      })();
    </script>
  </body>
</html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(request: NextRequest) {
  await ensureDb();
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');
  const oauthErrorDescription = searchParams.get('error_description');

  const publicUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    request.nextUrl.origin ||
    'https://discord-stream-hub-new.fly.dev';

  if (oauthError) {
    return popupCallbackResponse(publicUrl, {
      error: `twitch_${oauthError}`,
      error_description: oauthErrorDescription || 'Twitch authorization was not completed.',
    });
  }

  if (!code) {
    return popupCallbackResponse(publicUrl, {
      error: 'missing_oauth_code',
      error_description: 'Twitch did not return an authorization code.',
    });
  }

  const serverId = state || process.env.HARDCODED_GUILD_ID || '1240832965865635881';

  try {
    const isHearMeOut = state?.includes('hearmeout');
    const redirectUri = `${publicUrl}/api/twitch/oauth/callback`;

    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID!,
        client_secret: process.env.TWITCH_CLIENT_SECRET!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const tokenData = await tokenResponse.json();

    const uid = `twitch_${serverId}`;
    await db.setAsync('users', uid, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      scope: tokenData.scope,
      updatedAt: new Date().toISOString(),
      source: 'twitch',
      serverId,
    });

    if (isHearMeOut) {
      const userResponse = await fetch('https://api.twitch.tv/helix/users', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Client-Id': process.env.TWITCH_CLIENT_ID!,
        },
      });
      let userId = 'unknown';
      let username = 'unknown';
      let displayName = '';
      let photoUrl = '';
      if (userResponse.ok) {
        const userData = await userResponse.json();
        const user = userData.data?.[0];
        if (user) {
          userId = user.id;
          username = user.login;
          displayName = user.display_name;
          photoUrl = user.profile_image_url || '';
          await db.setAsync('tokens', `user_${user.id}_twitch`, {
            user_id: user.id,
            username: user.login,
            display_name: user.display_name,
            profile_image_url: user.profile_image_url,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_at: Date.now() + tokenData.expires_in * 1000,
            updated_at: Date.now(),
            source: 'hearmeout',
          });
        }
      }
      const hmoUrl = 'https://hearmeout-main.fly.dev';
      const params = new URLSearchParams({
        success: 'true',
        user_id: userId,
        username,
        display_name: displayName,
        photo_url: photoUrl,
      });
      return NextResponse.redirect(`${hmoUrl}/api/auth/twitch/callback?${params}`);
    }

    return popupCallbackResponse(publicUrl, {
      oauth: 'success',
      provider: 'twitch',
    });
  } catch (error) {
    console.error('OAuth callback error:', error);
    return popupCallbackResponse(publicUrl, {
      error: 'oauth_failed',
      error_description: error instanceof Error ? error.message : 'Twitch OAuth failed.',
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { code, source } = await request.json();

    if (!code) {
      return NextResponse.json({ error: 'Authorization code required' }, { status: 400 });
    }

    if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
      return NextResponse.json({ error: 'Twitch OAuth not configured' }, { status: 500 });
    }

    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'https://discord-stream-hub-new.fly.dev'}/api/twitch/oauth/callback`;

    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const tokenError = await tokenResponse.text();
      console.error('Twitch token exchange failed:', tokenError);
      return NextResponse.json({ error: 'Failed to exchange code for token' }, { status: 400 });
    }

    const tokenData = await tokenResponse.json();

    const userResponse = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Client-Id': process.env.TWITCH_CLIENT_ID,
      },
    });

    if (!userResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch user data' }, { status: 400 });
    }

    const userData = await userResponse.json();
    const user = userData.data[0];

    const uid = `twitch_${user.id}`;
    await db.setAsync('users', uid, {
      id: user.id,
      username: user.login,
      displayName: user.display_name,
      photoURL: user.profile_image_url,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      source: source || 'twitch',
      updatedAt: new Date().toISOString(),
    });

    await db.setAsync('tokens', `user_${user.id}_twitch`, {
      user_id: user.id,
      username: user.login,
      display_name: user.display_name,
      profile_image_url: user.profile_image_url,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + tokenData.expires_in * 1000,
      updated_at: Date.now(),
      source: source || 'dsh',
    });

    console.log('Twitch user authenticated:', { userId: user.id, username: user.login, source });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.login,
        displayName: user.display_name,
        profileImage: user.profile_image_url,
      },
      tokens: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + tokenData.expires_in * 1000,
      },
    });
  } catch (error) {
    console.error('Twitch OAuth exchange error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
