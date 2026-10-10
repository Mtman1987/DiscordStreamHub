import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { createHmac, timingSafeEqual } from 'crypto';
import { serverAccount } from '@/lib/discord-server-connections';
import { getAppUrl, getDiscordClientId, getHearMeOutUrl } from '@/lib/runtime-config';

const DSH_REDIRECT_SECRET = process.env.DSH_REDIRECT_SECRET || '';

function getDiscordOAuthConfig() {
  const clientId = getDiscordClientId();
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  return { clientId, clientSecret };
}

function getPublicUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return getAppUrl() || request.nextUrl.origin;
}

function signHearMeOutRedirect(userId: string, exp: string): string | null {
  if (!DSH_REDIRECT_SECRET) return null;
  return createHmac('sha256', DSH_REDIRECT_SECRET)
    .update(`discord|${userId}|${exp}`)
    .digest('hex');
}

function hearMeOutRedirect(payload: Record<string, string>) {
  const url = new URL('/api/auth/discord/callback', getHearMeOutUrl());
  for (const [key, value] of Object.entries(payload)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url.toString());
}

function popupResponse(publicUrl: string, payload: Record<string, string>) {
  const targetOrigin = JSON.stringify(publicUrl);
  const message = JSON.stringify({ source: 'discord-oauth', ...payload });
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

function timeoutSignal(milliseconds: number) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
}

export async function GET(request: NextRequest) {
  await ensureDb();

  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');
  const oauthErrorDescription = searchParams.get('error_description');
  const publicUrl = getPublicUrl(request);
  const isHearMeOut = state === 'hearmeout';

  if (state?.startsWith('dsh-servers:')) {
    const expected = request.cookies.get('dsh_discord_server_state')?.value || '';
    const finish = (error?: string) => {
      const url = new URL('/discord-servers', publicUrl);
      if (error) url.searchParams.set('error', error);
      const response = NextResponse.redirect(url);
      response.cookies.set('dsh_discord_server_state', '', { httpOnly: true, path: '/', maxAge: 0 });
      return response;
    };
    const receivedBytes = Buffer.from(state);
    const expectedBytes = Buffer.from(expected);
    if (!expected || receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes)) {
      return finish('Discord authorization expired. Start again.');
    }
    if (oauthError || !code) return finish('Discord authorization was not completed.');
    try {
      const session = await serverAccount(request);
      const { clientId, clientSecret } = getDiscordOAuthConfig();
      if (!clientId || !clientSecret) return finish('Discord authorization is not configured.');
      const response = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code,
          grant_type: 'authorization_code', redirect_uri: publicUrl + '/api/discord/oauth/callback' }),
        signal: AbortSignal.timeout(12_000),
      });
      const tokens = await response.json();
      if (!response.ok || !tokens.access_token) return finish('Discord authorization failed. Start again.');
      const profile = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: 'Bearer ' + tokens.access_token }, signal: AbortSignal.timeout(10_000),
      });
      const discord = await profile.json();
      if (!profile.ok || !discord.id) return finish('Unable to verify your Discord account.');
      if (session.discordUserId && session.discordUserId !== discord.id) {
        return finish('Connect the Discord account linked to your SPMT account.');
      }
      db.set('discordServerOAuth', session.spmtUserId!, {
        discordUserId: discord.id, access_token: tokens.access_token, refresh_token: tokens.refresh_token,
        scope: tokens.scope, expires_at: Date.now() + tokens.expires_in * 1000,
      });
      return finish();
    } catch { return finish('Unable to connect Discord. Try again.'); }
  }


  if (oauthError) {
    if (isHearMeOut) {
      return hearMeOutRedirect({
        error: `discord_${oauthError}`,
        error_description: oauthErrorDescription || 'Discord authorization was not completed.',
      });
    }
    return popupResponse(publicUrl, {
      error: `discord_${oauthError}`,
      error_description: oauthErrorDescription || 'Discord authorization was not completed.',
    });
  }

  if (!code) {
    if (isHearMeOut) {
      return hearMeOutRedirect({
        error: 'missing_oauth_code',
        error_description: 'Discord did not return an authorization code.',
      });
    }
    return popupResponse(publicUrl, {
      error: 'missing_oauth_code',
      error_description: 'Discord did not return an authorization code.',
    });
  }

  if (state && state !== 'hearmeout' && state !== 'dsh-settings') {
    if (isHearMeOut) {
      return hearMeOutRedirect({
        error: 'invalid_state',
        error_description: 'Discord OAuth state validation failed.',
      });
    }
    return popupResponse(publicUrl, {
      error: 'invalid_state',
      error_description: 'Discord OAuth state validation failed.',
    });
  }

  const { clientId, clientSecret } = getDiscordOAuthConfig();
  if (!clientId || !clientSecret) {
    if (isHearMeOut) {
      return hearMeOutRedirect({
        error: 'discord_oauth_not_configured',
        error_description: 'Discord OAuth is not configured on the server.',
      });
    }
    return popupResponse(publicUrl, {
      error: 'discord_oauth_not_configured',
      error_description: 'Discord OAuth is not configured on the server.',
    });
  }

  try {
    const redirectUri = `${publicUrl}/api/discord/oauth/callback`;

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
      signal: timeoutSignal(12_000),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[DiscordOAuth] Token exchange failed:', tokenResponse.status, errorText);
      if (isHearMeOut) {
        return hearMeOutRedirect({
          error: 'token_exchange_failed',
          error_description: 'Discord authorization could not be completed. Start the connect flow again.',
        });
      }
      return popupResponse(publicUrl, {
        error: 'token_exchange_failed',
        error_description: 'Discord authorization could not be completed. Start the connect flow again.',
      });
    }

    const tokenData = await tokenResponse.json();
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
      signal: timeoutSignal(12_000),
    });

    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.error('[DiscordOAuth] Failed to fetch user profile:', userResponse.status, errorText);
      if (isHearMeOut) {
        return hearMeOutRedirect({
          error: 'profile_fetch_failed',
          error_description: 'Discord authorization completed, but the user profile could not be loaded.',
        });
      }
      return popupResponse(publicUrl, {
        error: 'profile_fetch_failed',
        error_description: 'Discord authorization completed, but the user profile could not be loaded.',
      });
    }

    const user = await userResponse.json();
    const uid = `discord_${user.id}`;

    await db.setAsync('tokens', `user_${user.id}_discord`, {
      user_id: user.id,
      username: user.username,
      display_name: user.global_name || user.username,
      avatar: user.avatar || '',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + (tokenData.expires_in * 1000),
      scope: tokenData.scope,
      updated_at: Date.now(),
      source: 'hearmeout',
    });

    await db.setAsync('users', uid, {
      id: uid,
      discordId: user.id,
      username: user.username,
      displayName: user.global_name || user.username,
      avatar: user.avatar || '',
      source: 'dsh',
      updatedAt: new Date().toISOString(),
    });

    console.log('[DiscordOAuth] Success:', user.id, user.username);
    if (isHearMeOut) {
      const exp = String(Math.floor(Date.now() / 1000) + 300);
      const sig = signHearMeOutRedirect(user.id, exp);
      const payload: Record<string, string> = {
        success: 'true',
        user_id: user.id,
        username: user.username,
        display_name: user.global_name || user.username,
        avatar: user.avatar || '',
        exp,
      };
      if (sig) payload.sig = sig;
      return hearMeOutRedirect(payload);
    }
    return popupResponse(publicUrl, {
      success: 'true',
      user_id: user.id,
      username: user.username,
      display_name: user.global_name || user.username,
      avatar: user.avatar || '',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Discord OAuth did not complete.';
    console.error('[DiscordOAuth] Error:', message);
    if (isHearMeOut) {
      return hearMeOutRedirect({
        error: 'oauth_failed',
        error_description: message,
      });
    }
    return popupResponse(publicUrl, {
      error: 'oauth_failed',
      error_description: message,
    });
  }
}
