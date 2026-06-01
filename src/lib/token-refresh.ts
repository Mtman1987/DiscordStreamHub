'use server';

import { db } from '@/lib/db';
import { getDiscordClientId } from '@/lib/runtime-config';

const DISCORD_API = 'https://discord.com/api/v10';

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  username: string;
  discriminator: string;
  avatar?: string;
}

async function refreshTokenRecord(tokenId: string, raw: any): Promise<TokenData | null> {
  try {
    const userId = raw.user_id || raw.userId || tokenId.replace(/^user_/, '').replace(/_discord$/, '');
    const tokenData: TokenData = {
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token,
      expiresAt: raw.expires_at,
      userId,
      username: raw.username,
      discriminator: raw.discriminator || '',
      avatar: raw.avatar,
    };

    const fiveMinutes = 5 * 60 * 1000;
    if (Date.now() < tokenData.expiresAt - fiveMinutes) {
      return tokenData;
    }

    if (!tokenData.refreshToken) return null;

    const response = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: getDiscordClientId(),
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: tokenData.refreshToken,
      }),
    });

    if (!response.ok) {
      console.error('[TokenRefresh] Refresh failed:', await response.text());
      return null;
    }

    const newTokens = await response.json();
    const updated: TokenData = {
      ...tokenData,
      accessToken: newTokens.access_token,
      refreshToken: newTokens.refresh_token || tokenData.refreshToken,
      expiresAt: Date.now() + (newTokens.expires_in * 1000),
    };

    await db.collection('tokens').doc(tokenId).update({
      access_token: updated.accessToken,
      refresh_token: updated.refreshToken,
      expires_at: updated.expiresAt,
      updated_at: Date.now(),
      user_id: updated.userId,
      username: updated.username,
      avatar: updated.avatar,
    });

    return updated;
  } catch (error) {
    console.error('[TokenRefresh] Error refreshing token record:', error);
    return null;
  }
}

function getCandidateTokenIds(appIdOrUserId?: string): string[] {
  const ids: string[] = [];

  if (appIdOrUserId) {
    ids.push(
      `user_${appIdOrUserId}_discord`,
      `discord_${appIdOrUserId}`,
      `app_${appIdOrUserId}_discord`,
      appIdOrUserId,
    );
  }

  return ids;
}

async function findAnyDiscordTokenDoc(): Promise<{ id: string; data: any } | null> {
  try {
    const snapshot = await db.collection('tokens').get();
    const docs = snapshot?.docs || [];
    for (const doc of docs) {
      const data = typeof doc.data === 'function' ? doc.data() : doc.data;
      if (!data) continue;
      if ((doc.id || '').includes('_discord')) {
        return { id: doc.id, data };
      }
      if (data.source === 'dsh' || data.source === 'hearmeout') {
        return { id: doc.id, data };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function refreshDiscordToken(userId: string): Promise<TokenData | null> {
  try {
    // Look up token in SQLite tokens collection
    const tokenDoc = await db.collection('tokens').doc(`user_${userId}_discord`).get();
    if (!tokenDoc.exists) return null;

    const raw = tokenDoc.data();
    const tokenData: TokenData = {
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token,
      expiresAt: raw.expires_at,
      userId: raw.user_id,
      username: raw.username,
      discriminator: '',
      avatar: raw.avatar,
    };

    // Check if token needs refresh (5 minutes before expiry)
    const fiveMinutes = 5 * 60 * 1000;
    if (Date.now() < tokenData.expiresAt - fiveMinutes) {
      return tokenData;
    }

    console.log(`[TokenRefresh] Refreshing Discord token for user ${userId}...`);

    const response = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: getDiscordClientId(),
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: tokenData.refreshToken,
      }),
    });

    if (!response.ok) {
      console.error('[TokenRefresh] Refresh failed:', await response.text());
      return null;
    }

    const newTokens = await response.json();

    const updated: TokenData = {
      ...tokenData,
      accessToken: newTokens.access_token,
      refreshToken: newTokens.refresh_token || tokenData.refreshToken,
      expiresAt: Date.now() + (newTokens.expires_in * 1000),
    };

    // Save updated tokens back to SQLite
    await db.collection('tokens').doc(`user_${userId}_discord`).update({
      access_token: updated.accessToken,
      refresh_token: updated.refreshToken,
      expires_at: updated.expiresAt,
      updated_at: Date.now(),
    });

    console.log(`[TokenRefresh] Discord token refreshed for user ${userId}`);
    return updated;
  } catch (error) {
    console.error('[TokenRefresh] Error:', error);
    return null;
  }
}

export async function getValidDiscordToken(appIdOrUserId?: string): Promise<TokenData | null> {
  if (appIdOrUserId) {
    for (const tokenId of getCandidateTokenIds(appIdOrUserId)) {
      try {
        const tokenDoc = await db.collection('tokens').doc(tokenId).get();
        if (!tokenDoc.exists) continue;

        const raw = tokenDoc.data();
        if (!raw) continue;
        return await refreshTokenRecord(tokenId, raw);
      } catch {
        continue;
      }
    }
  }

  const fallback = await findAnyDiscordTokenDoc();
  if (fallback) {
    return refreshTokenRecord(fallback.id, fallback.data);
  }

  return null;
}
