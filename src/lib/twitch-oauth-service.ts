'use server';

import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { getTwitchClientId } from '@/lib/runtime-config';

const botRefreshInflight = new Map<string, Promise<{ accessToken: string; refreshToken: string; expiresAt: number } | null>>();
const INVALID_REFRESH_RETRY_MS = 12 * 60 * 60 * 1000;
const INVALID_CLIENT_RETRY_MS = 12 * 60 * 60 * 1000;

function twitchCredentialFingerprint(clientId: string, clientSecret: string): string {
  return createHash('sha256').update(`${clientId}:\0${clientSecret}`).digest('hex');
}

export async function getUserAccessToken(serverId: string): Promise<string | null> {
  try {
    const oauthDoc = await db.collection('servers').doc(serverId).collection('config').doc('twitchOAuth').get();
    
    if (!oauthDoc.exists) {
      return null;
    }

    const data = oauthDoc.data()!;
    
    // Check if token is expired
    if (Date.now() >= data.expiresAt) {
      // Refresh token
      const refreshResponse = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: getTwitchClientId(),
          client_secret: process.env.TWITCH_CLIENT_SECRET!,
          grant_type: 'refresh_token',
          refresh_token: data.refreshToken,
        }),
      });

      if (!refreshResponse.ok) {
        console.error('Failed to refresh token');
        return null;
      }

      const refreshData = await refreshResponse.json();

      // Update stored tokens
      await db.collection('servers').doc(serverId).collection('config').doc('twitchOAuth').update({
        accessToken: refreshData.access_token,
        refreshToken: refreshData.refresh_token,
        expiresAt: Date.now() + (refreshData.expires_in * 1000),
        updatedAt: new Date().toISOString(),
      });

      return refreshData.access_token;
    }

    return data.accessToken;
  } catch (error) {
    console.error('Error getting user access token:', error);
    return null;
  }
}

async function refreshTwitchOAuthToken(docPath: string, data: any): Promise<{ accessToken: string; refreshToken: string; expiresAt: number } | null> {
  const refreshToken = data.refreshToken || data.refresh_token;
  if (!refreshToken) return null;

  const clientId = getTwitchClientId();
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('[TwitchOAuth] Twitch client credentials are not configured');
    return null;
  }

  const credentialFingerprint = twitchCredentialFingerprint(clientId, clientSecret);
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: String(refreshToken),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const isInvalidRefreshToken = /invalid refresh token/i.test(errorText);
    const isInvalidClientCredentials = [400, 401, 403].includes(response.status)
      && /invalid client secret|invalid client/i.test(errorText);
    const updatePayload: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
      lastRefreshError: errorText,
    };

    if (isInvalidRefreshToken) {
      updatePayload.refreshErrorCode = 'invalid_refresh_token';
      updatePayload.refreshErrorAt = Date.now();
      updatePayload.accessToken = '';
      updatePayload.expiresAt = 0;
      console.warn('[TwitchOAuth] Refresh token is invalid; suppressing repeated retry spam until reauthorization.');
    } else if (isInvalidClientCredentials) {
      updatePayload.refreshErrorCode = 'invalid_client_credentials';
      updatePayload.refreshErrorAt = Date.now();
      updatePayload.clientCredentialFingerprint = credentialFingerprint;
      updatePayload.accessToken = '';
      updatePayload.expiresAt = 0;
      console.warn('[TwitchOAuth] Twitch client credentials were rejected; retrying only after credentials change or the backoff expires.');
    } else {
      console.error('[TwitchOAuth] Refresh failed:', errorText);
    }

    await db.collection('servers').doc(docPath).collection('config').doc('twitchBotOAuth').set(updatePayload, { merge: true }).catch(() => {});
    return null;
  }

  const refreshData = await response.json();
  const updated = {
    accessToken: refreshData.access_token,
    refreshToken: refreshData.refresh_token || refreshToken,
    expiresAt: Date.now() + (refreshData.expires_in * 1000),
  };

  await db.collection('servers').doc(docPath).collection('config').doc('twitchBotOAuth').update({
    accessToken: updated.accessToken,
    refreshToken: updated.refreshToken,
    expiresAt: updated.expiresAt,
    updatedAt: new Date().toISOString(),
    refreshErrorCode: null,
    refreshErrorAt: null,
    lastRefreshError: null,
    clientCredentialFingerprint: credentialFingerprint,
  });

  return updated;
}

export async function getValidBotAccessToken(serverId: string): Promise<string | null> {
  try {
    const botDoc = await db.collection('servers').doc(serverId).collection('config').doc('twitchBotOAuth').get();
    if (!botDoc.exists) return null;

    const data = botDoc.data() || {};
    const accessToken = data.accessToken;
    const expiresAt = Number(data.expiresAt || 0);
    const refreshErrorCode = String(data.refreshErrorCode || '').trim();
    const refreshErrorAt = Number(data.refreshErrorAt || 0);
    const fiveMinutes = 5 * 60 * 1000;
    const clientId = getTwitchClientId();
    const clientSecret = process.env.TWITCH_CLIENT_SECRET || '';
    const credentialFingerprint = clientId && clientSecret
      ? twitchCredentialFingerprint(clientId, clientSecret)
      : '';

    if (accessToken && Date.now() < expiresAt - fiveMinutes) {
      return accessToken;
    }

    if (
      refreshErrorCode === 'invalid_refresh_token' &&
      refreshErrorAt > 0 &&
      Date.now() - refreshErrorAt < INVALID_REFRESH_RETRY_MS
    ) {
      return null;
    }

    if (
      refreshErrorCode === 'invalid_client_credentials' &&
      credentialFingerprint &&
      data.clientCredentialFingerprint === credentialFingerprint &&
      refreshErrorAt > 0 &&
      Date.now() - refreshErrorAt < INVALID_CLIENT_RETRY_MS
    ) {
      return null;
    }

    const existingRefresh = botRefreshInflight.get(serverId);
    if (existingRefresh) {
      const refreshed = await existingRefresh;
      return refreshed?.accessToken || null;
    }

    const refreshPromise = refreshTwitchOAuthToken(serverId, data);
    botRefreshInflight.set(serverId, refreshPromise);
    const refreshed = await refreshPromise.finally(() => {
      botRefreshInflight.delete(serverId);
    });
    return refreshed?.accessToken || null;
  } catch (error) {
    console.error('[TwitchOAuth] Error getting bot access token:', error);
    return null;
  }
}

export async function hasValidOAuthToken(serverId: string): Promise<boolean> {
  const token = await getUserAccessToken(serverId);
  return token !== null;
}
