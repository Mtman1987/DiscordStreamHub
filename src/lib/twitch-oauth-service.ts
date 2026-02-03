'use server';

import { db } from '@/firebase/server-init';

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
          client_id: process.env.TWITCH_CLIENT_ID!,
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

export async function hasValidOAuthToken(serverId: string): Promise<boolean> {
  const token = await getUserAccessToken(serverId);
  return token !== null;
}
