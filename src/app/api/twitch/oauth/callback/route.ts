import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { getAppUrl, getChatTagApiBase, getHardcodedGuildId, getHearMeOutUrl, getTwitchClientId } from '@/lib/runtime-config';

function getTwitchOAuthConfig() {
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  return { clientId: getTwitchClientId(), clientSecret };
}

class TwitchOAuthExchangeError extends Error {
  public readonly publicMessage: string;

  constructor(message: string, publicMessage = message) {
    super(message);
    this.name = 'TwitchOAuthExchangeError';
    this.publicMessage = publicMessage;
  }
}

function parseOAuthState(state: string | null) {
  const fallbackServerId = getHardcodedGuildId();
  if (!state) {
    return {
      serverId: fallbackServerId,
      isHearMeOut: false,
      isChatTag: false,
      isBotOAuth: false,
      discordUserId: null as string | null,
      twitchLogin: null as string | null,
    };
  }

  const parts = state.split('|');
  if (parts[0] === 'bot') {
    return {
      serverId: parts[1] || fallbackServerId,
      isHearMeOut: false,
      isChatTag: false,
      isBotOAuth: true,
      discordUserId: null as string | null,
      twitchLogin: null as string | null,
    };
  }

  if (parts[0] === 'botlink') {
    return {
      serverId: parts[1] || fallbackServerId,
      isHearMeOut: false,
      isChatTag: false,
      isBotOAuth: true,
      discordUserId: parts[2] || null,
      twitchLogin: parts[3] || null,
    };
  }

  if (parts[0] === 'hearmeout') {
    return {
      serverId: parts[1] || fallbackServerId,
      isHearMeOut: true,
      isChatTag: false,
      isBotOAuth: false,
      discordUserId: null as string | null,
      twitchLogin: null as string | null,
    };
  }

  if (parts[0] === 'chat-tag') {
    return {
      serverId: parts[1] || fallbackServerId,
      isHearMeOut: false,
      isChatTag: true,
      isBotOAuth: false,
      discordUserId: null as string | null,
      twitchLogin: null as string | null,
    };
  }

  return {
    serverId: state,
    isHearMeOut: state.includes('hearmeout'),
    isChatTag: state.includes('chat-tag'),
    isBotOAuth: false,
    discordUserId: null as string | null,
    twitchLogin: null as string | null,
  };
}

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

function chatTagCallbackResponse(payload: Record<string, string>) {
  const chatTagUrl = getChatTagApiBase();
  const params = new URLSearchParams(payload);
  return NextResponse.redirect(`${chatTagUrl}/api/auth/twitch/callback?${params}`);
}

export async function GET(request: NextRequest) {
  await ensureDb();
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');
  const oauthErrorDescription = searchParams.get('error_description');

  const publicUrl =
    getAppUrl() ||
    request.nextUrl.origin;

  if (oauthError) {
    const { isChatTag } = parseOAuthState(state);
    if (isChatTag) {
      return chatTagCallbackResponse({
        error: `twitch_${oauthError}`,
        error_description: oauthErrorDescription || 'Twitch authorization was not completed.',
      });
    }

    return popupCallbackResponse(publicUrl, {
      error: `twitch_${oauthError}`,
      error_description: oauthErrorDescription || 'Twitch authorization was not completed.',
    });
  }

  if (!code) {
    const { isChatTag } = parseOAuthState(state);
    if (isChatTag) {
      return chatTagCallbackResponse({
        error: 'missing_oauth_code',
        error_description: 'Twitch did not return an authorization code.',
      });
    }

    return popupCallbackResponse(publicUrl, {
      error: 'missing_oauth_code',
      error_description: 'Twitch did not return an authorization code.',
    });
  }

  const { serverId, isHearMeOut, isChatTag, isBotOAuth, discordUserId, twitchLogin } = parseOAuthState(state);

  try {
    const redirectUri = `${publicUrl}/api/twitch/oauth/callback`;
    const { clientId, clientSecret } = getTwitchOAuthConfig();

    if (!clientId || !clientSecret) {
      throw new Error('Twitch OAuth is not configured.');
    }

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
      const isInvalidCode = tokenResponse.status === 400 && /invalid authorization code/i.test(errorText);
      if (isInvalidCode) {
        console.warn('[TwitchOAuth] Authorization code was rejected by Twitch. It may have expired or already been used.');
        throw new TwitchOAuthExchangeError(
          'Twitch authorization code was rejected',
          'Twitch authorization expired or was already used. Start the Twitch connect flow again.'
        );
      }

      console.error('[TwitchOAuth] Token exchange was not accepted:', tokenResponse.status, errorText);
      throw new TwitchOAuthExchangeError(
        'Twitch token exchange was not accepted',
        'Twitch authorization could not be completed. Start the Twitch connect flow again.'
      );
    }

    const tokenData = await tokenResponse.json();
    let twitchUser: any = null;

    const userResponse = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Client-Id': clientId,
      },
    });
    if (userResponse.ok) {
      const userData = await userResponse.json();
      twitchUser = userData.data?.[0] || null;
    } else {
      console.error('[TwitchOAuth] Failed to fetch Twitch user:', userResponse.status, await userResponse.text());
    }

    if (isBotOAuth) {
      const expiresAt = Date.now() + (tokenData.expires_in * 1000);
      if (discordUserId) {
        await db.collection('servers').doc(serverId).collection('users').doc(discordUserId).set({
          linkedBotTwitchLogin: twitchLogin || twitchUser?.login || '',
          botUsername: twitchUser?.login || '',
          botUserId: twitchUser?.id || '',
          botAccessToken: tokenData.access_token,
          botRefreshToken: tokenData.refresh_token,
          botTokenExpiresAt: expiresAt,
          botLinkedAt: new Date().toISOString(),
        }, { merge: true });
        await db.setAsync('tokens', `discord_user_${discordUserId}_twitch_bot`, {
          serverId,
          discordUserId,
          twitchLogin: twitchLogin || twitchUser?.login || '',
          botUsername: twitchUser?.login || '',
          botUserId: twitchUser?.id || '',
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt,
          updatedAt: new Date().toISOString(),
          source: 'discord-user-bot-oauth',
        });
      } else {
        await db.collection('servers').doc(serverId).collection('config').doc('twitchBotOAuth').set({
          botUsername: twitchUser?.login || '',
          botUserId: twitchUser?.id || '',
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt,
          updatedAt: new Date().toISOString(),
          refreshErrorCode: null,
          refreshErrorAt: null,
          lastRefreshError: null,
        });
        const uid = `twitch_${serverId}`;
        await db.setAsync('users', uid, {
          id: twitchUser?.id || uid,
          username: twitchUser?.login || twitchUser?.display_name || 'Twitch Bot',
          displayName: twitchUser?.display_name || twitchUser?.login || 'Twitch Bot',
          photoURL: twitchUser?.profile_image_url || '',
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt,
          scope: tokenData.scope,
          updatedAt: new Date().toISOString(),
          source: 'twitch',
          serverId,
        });
      }

      return popupCallbackResponse(publicUrl, {
        oauth: 'success',
        provider: 'twitch',
      });
    }

    const uid = `twitch_${serverId}`;
    await db.setAsync('users', uid, {
      id: twitchUser?.id || uid,
      username: twitchUser?.login || twitchUser?.display_name || 'Twitch Bot',
      displayName: twitchUser?.display_name || twitchUser?.login || 'Twitch Bot',
      photoURL: twitchUser?.profile_image_url || '',
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      scope: tokenData.scope,
      updatedAt: new Date().toISOString(),
      source: 'twitch',
      serverId,
    });

    // Also save to the path where twitch-oauth-service reads tokens
    await db.collection('servers').doc(serverId).collection('config').doc('twitchOAuth').set({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      userId: twitchUser?.id || '',
      username: twitchUser?.login || '',
      updatedAt: new Date().toISOString(),
    });

    if (isHearMeOut) {
      let userId = 'unknown';
      let username = 'unknown';
      let displayName = '';
      let photoUrl = '';
      if (twitchUser) {
          userId = twitchUser.id;
          username = twitchUser.login;
          displayName = twitchUser.display_name;
          photoUrl = twitchUser.profile_image_url || '';
          // Save to DSH tokens collection for cross-app access
          await db.setAsync('tokens', `user_${twitchUser.id}_twitch`, {
            user_id: twitchUser.id, username: twitchUser.login, display_name: twitchUser.display_name,
            profile_image_url: twitchUser.profile_image_url,
            access_token: tokenData.access_token, refresh_token: tokenData.refresh_token,
            expires_at: Date.now() + (tokenData.expires_in * 1000),
            updated_at: Date.now(), source: 'hearmeout'
          });
      }
      const hmoUrl = getHearMeOutUrl();
      const params = new URLSearchParams({
        success: 'true', user_id: userId, username, display_name: displayName, photo_url: photoUrl,
      });
      return NextResponse.redirect(`${hmoUrl}/api/auth/twitch/callback?${params}`);
    }

    if (isChatTag) {
      return chatTagCallbackResponse({
        success: 'true',
        user_id: twitchUser?.id || 'unknown',
        username: twitchUser?.login || twitchUser?.display_name || 'unknown',
        display_name: twitchUser?.display_name || twitchUser?.login || '',
        photo_url: twitchUser?.profile_image_url || '',
      });
    }

    return popupCallbackResponse(publicUrl, {
      oauth: 'success',
      provider: 'twitch',
    });
  } catch (error) {
    const message = error instanceof TwitchOAuthExchangeError
      ? error.publicMessage
      : error instanceof Error
        ? error.message.replace(/\bfailed\b/gi, 'unable')
        : 'Twitch OAuth did not complete.';
    console.warn('OAuth callback did not complete:', message);
    if (isChatTag) {
      return chatTagCallbackResponse({
        error: 'oauth_failed',
        error_description: message,
      });
    }

    return popupCallbackResponse(publicUrl, {
      error: 'oauth_failed',
      error_description: message,
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { code, source } = await request.json();
    
    if (!code) {
      return NextResponse.json({ error: 'Authorization code required' }, { status: 400 });
    }

    const { clientId, clientSecret } = getTwitchOAuthConfig();

    if (!clientId || !clientSecret) {
      return NextResponse.json({ error: 'Twitch OAuth not configured' }, { status: 500 });
    }

    const publicUrl = getAppUrl() || request.nextUrl.origin;

    // Determine redirect URI based on source
    const redirectUri = `${publicUrl}/api/twitch/oauth/callback`;

    // Exchange code for access token
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      const isInvalidCode = tokenResponse.status === 400 && /invalid authorization code/i.test(error);
      if (isInvalidCode) {
        console.warn('[TwitchOAuth] POST authorization code was rejected by Twitch. It may have expired or already been used.');
      } else {
        console.error('Twitch token exchange was not accepted:', tokenResponse.status, error);
      }
      return NextResponse.json(
        { error: 'Twitch authorization expired or was already used. Start the Twitch connect flow again.' },
        { status: 400 }
      );
    }

    const tokenData = await tokenResponse.json();

    // Get user information
    const userResponse = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Client-Id': clientId,
      },
    });

    if (!userResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch user data' }, { status: 400 });
    }

    const userData = await userResponse.json();
    const user = userData.data[0];

    // Store tokens consistently for all sources
    const uid = `twitch_${user.id}`;
    await db.setAsync('users', uid, {
      id: user.id,
      username: user.login,
      displayName: user.display_name,
      photoURL: user.profile_image_url,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      source: source || 'twitch',
      updatedAt: new Date().toISOString(),
    });

    // Also store in centralized user-specific tokens collection for cross-app access
    await db.setAsync('tokens', `user_${user.id}_twitch`, {
      user_id: user.id,
      username: user.login,
      display_name: user.display_name,
      profile_image_url: user.profile_image_url,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + (tokenData.expires_in * 1000),
      updated_at: Date.now(),
      source: source || 'dsh'
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
        expiresAt: Date.now() + (tokenData.expires_in * 1000),
      }
    });

  } catch (error) {
    console.error('Twitch OAuth exchange error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
