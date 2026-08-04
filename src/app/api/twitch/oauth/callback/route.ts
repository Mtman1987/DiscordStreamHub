import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db, ensureDb } from '@/lib/db';
import { getAppUrl, getChatTagApiBase, getHardcodedGuildId, getHearMeOutUrl, getTwitchClientId } from '@/lib/runtime-config';
import { onboardVerifiedSpmtIdentity } from '@/lib/spmt-client';
import { consumeSpmtOnboardingState } from '@/lib/spmt-onboarding-service';

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

function spmtOnboardingErrorResponse(message: string) {
  const safeMessage = message.replace(/[<>&"']/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#039;',
  })[character] || character);
  return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SPMT onboarding</title></head><body style="font-family:system-ui;background:#050816;color:#fff;padding:40px"><h1>SPMT onboarding did not finish.</h1><p>${safeMessage}</p><p>Return to Discord and select <strong>Join or Recover SPMT with Twitch</strong> to try again.</p></body></html>`, {
    status: 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function chatTagCallbackResponse(payload: Record<string, string>) {
  const chatTagUrl = getChatTagApiBase();
  const issuedAt = String(Date.now());
  const signedPayload: Record<string, string> = { ...payload, issued_at: issuedAt };
  const bridgeSecret = process.env.CHAT_TAG_BOT_SECRET || process.env.BOT_SECRET_KEY;
  if (payload.success === 'true') {
    if (!bridgeSecret) throw new Error('CHAT_TAG_BOT_SECRET is required for the ChatTag identity bridge.');
    const canonical = [
      payload.user_id || '',
      payload.username || '',
      payload.display_name || '',
      payload.photo_url || '',
      issuedAt,
    ].join('|');
    signedPayload.signature = crypto.createHmac('sha256', bridgeSecret).update(canonical).digest('hex');
  }
  const params = new URLSearchParams(signedPayload);
  return NextResponse.redirect(`${chatTagUrl}/api/auth/twitch/callback?${params}`);
}

export async function GET(request: NextRequest) {
  await ensureDb();
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');
  const oauthErrorDescription = searchParams.get('error_description');
  const isSpmtOnboarding = Boolean(state?.startsWith('spmt-onboard|'));
  const onboardingStateToken = isSpmtOnboarding ? String(state).slice('spmt-onboard|'.length) : '';

  const publicUrl =
    getAppUrl() ||
    request.nextUrl.origin;

  if (oauthError) {
    if (isSpmtOnboarding) {
      return spmtOnboardingErrorResponse(oauthErrorDescription || 'Twitch authorization was not completed.');
    }
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
    if (isSpmtOnboarding) {
      return spmtOnboardingErrorResponse('Twitch did not return an authorization code.');
    }
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
  let onboardingState: Awaited<ReturnType<typeof consumeSpmtOnboardingState>> = null;

  try {
    if (isSpmtOnboarding) {
      onboardingState = await consumeSpmtOnboardingState(onboardingStateToken);
      if (!onboardingState) {
        throw new TwitchOAuthExchangeError('Invalid SPMT onboarding state', 'This SPMT onboarding link expired or was already used. Return to Discord and start again.');
      }
    }
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

    if (onboardingState) {
      if (!twitchUser?.id || !twitchUser?.login) {
        throw new TwitchOAuthExchangeError('Twitch profile unavailable', 'Twitch authorization completed, but the account profile could not be verified.');
      }

      const duplicateMatches = await db.collection('servers').doc(onboardingState.serverId).collection('users')
        .where('twitchId', '==', String(twitchUser.id)).get();
      const conflictingMatch = duplicateMatches.docs.find((doc: any) => String(doc.id) !== onboardingState!.discordUserId);
      if (conflictingMatch) {
        throw new TwitchOAuthExchangeError('Twitch identity conflict', 'That Twitch account is already linked to another Discord member. Crew review is required.');
      }

      const spmt = await onboardVerifiedSpmtIdentity({
        discord: {
          providerUserId: onboardingState.discordUserId,
          username: onboardingState.discordUsername,
          displayName: onboardingState.discordDisplayName,
          avatarUrl: onboardingState.discordAvatarUrl,
        },
        twitch: {
          providerUserId: String(twitchUser.id),
          username: String(twitchUser.login),
          displayName: String(twitchUser.display_name || twitchUser.login),
          avatarUrl: String(twitchUser.profile_image_url || ''),
        },
      });

      const serverDoc = await db.collection('servers').doc(onboardingState.serverId).get();
      const roleMappings = serverDoc.data()?.roleMappings || {};
      let group = 'Community';
      for (const [roleId, groupName] of Object.entries(roleMappings)) {
        if (onboardingState.roles.includes(roleId)) {
          group = String(groupName);
          break;
        }
      }

      await db.collection('servers').doc(onboardingState.serverId).collection('users').doc(onboardingState.discordUserId).set({
        discordUserId: onboardingState.discordUserId,
        username: onboardingState.discordUsername,
        displayName: onboardingState.discordDisplayName,
        avatarUrl: onboardingState.discordAvatarUrl,
        roles: onboardingState.roles,
        group,
        twitchLogin: String(twitchUser.login).toLowerCase(),
        twitchDisplayName: String(twitchUser.display_name || twitchUser.login),
        twitchId: String(twitchUser.id),
        twitchProfileImageUrl: String(twitchUser.profile_image_url || ''),
        twitchLinkSource: 'verified-twitch-oauth',
        linkedAt: new Date().toISOString(),
        spmtUserId: String(spmt.user.id),
        spmtUsername: String(spmt.user.username),
        spmtCredentialState: spmt.user.credentialState || (spmt.purpose === 'claim' ? 'provider-owned' : 'password-set'),
        spmtOnboardedAt: new Date().toISOString(),
        isOnline: false,
      }, { merge: true });
      await db.collection('servers').doc(onboardingState.serverId).collection('recentActivity').add({
        type: spmt.purpose === 'claim' ? 'spmt_identity_claim_started' : 'spmt_identity_recovery_started',
        discordUserId: onboardingState.discordUserId,
        spmtUserId: String(spmt.user.id),
        twitchLogin: String(twitchUser.login).toLowerCase(),
        twitchId: String(twitchUser.id),
        timestamp: new Date().toISOString(),
      });
      return NextResponse.redirect(spmt.continueUrl);
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
      const exp = String(Math.floor(Date.now() / 1000) + 5 * 60);
      const redirectSecret = process.env.DSH_REDIRECT_SECRET || '';
      if (!redirectSecret) throw new Error('DSH_REDIRECT_SECRET is required for the HearMeOut identity bridge.');
      const sig = crypto.createHmac('sha256', redirectSecret).update(`twitch|${userId}|${exp}`).digest('hex');
      const params = new URLSearchParams({
        success: 'true', user_id: userId, username, display_name: displayName, photo_url: photoUrl,
        exp, sig,
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
    if (isSpmtOnboarding) {
      return spmtOnboardingErrorResponse(message);
    }
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
      credentialsStored: true,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
    });

  } catch (error) {
    console.error('Twitch OAuth exchange error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
