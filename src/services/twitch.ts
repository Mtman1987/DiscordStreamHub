import * as tmi from 'tmi.js';
import axios from 'axios';

// In-memory cache for the app access token
let appAccessToken: { token: string; expires: number } | null = null;
let badgeCache: { badges: any, expires: number } | null = null;

/**
 * Gets a Twitch App Access Token using Client Credentials Grant Flow.
 * Caches the token to avoid re-fetching on every request.
 * @returns A valid app access token.
 */
async function getTwitchAppAccessToken(): Promise<string> {
  if (appAccessToken && appAccessToken.expires > Date.now()) {
    return appAccessToken.token;
  }

  let clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  let clientSecret = process.env.NEXT_PUBLIC_TWITCH_CLIENT_SECRET;

  // Client credentials should be in environment variables
  if (!clientId) {
    clientId = process.env.TWITCH_CLIENT_ID;
  }
  if (!clientSecret) {
    clientSecret = process.env.TWITCH_CLIENT_SECRET;
  }

  if (!clientId || !clientSecret) {
    throw new Error('Twitch client ID or secret is not configured in environment variables.');
  }

  try {
    const response = await axios.post(
      `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`
    );

    const { access_token, expires_in } = response.data;
    const now = Date.now();
    // Set expiry to 1 minute before it actually expires, as a buffer
    const expires = now + (expires_in - 60) * 1000;

    appAccessToken = { token: access_token, expires };

    console.log('Successfully fetched new Twitch app access token.');
    return access_token;
  } catch (error: any) {
    console.error('Error fetching Twitch app access token:', error.response?.data || error.message);
    throw new Error('Could not fetch Twitch app access token.');
  }
}

type TwitchUser = {
    id: string;
    login: string;
    display_name: string;
    description: string;
    profile_image_url: string;
};

// Get User Information from Twitch API
export async function getTwitchUser(usernameOrId: string, by: "login" | "id" = "login"): Promise<{ id: string; bio: string; lastGame: string; displayName: string; profileImageUrl: string; } | null> {
    const appToken = await getTwitchAppAccessToken();
    const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;

    if (!clientId) {
        throw new Error("Twitch client ID is missing from environment variables.");
    }

    try {
        const userQuery = by === 'login' ? `login=${usernameOrId}` : `id=${usernameOrId}`;
        // Step 1: Get user ID from username
        const userResponse = await fetch(`https://api.twitch.tv/helix/users?${userQuery}`, {
            headers: {
                'Authorization': `Bearer ${appToken}`,
                'Client-ID': clientId,
            },
        });

        if (!userResponse.ok) {
            const errorBody = await userResponse.text();
            console.error('Failed to fetch Twitch user:', userResponse.status, userResponse.statusText, errorBody);
            throw new Error(`Failed to fetch Twitch user: ${userResponse.statusText}`);
        }

        const userData = await userResponse.json();
        const user: TwitchUser = userData.data[0];

        if (!user) {
            return null;
        }

        const { id, description, display_name, profile_image_url } = user;

        // Step 2: Get channel information (for last game played)
        const channelResponse = await fetch(`https://api.twitch.tv/helix/channels?broadcaster_id=${id}`, {
            headers: {
                'Authorization': `Bearer ${appToken}`,
                'Client-ID': clientId,
            },
        });

        let gameName = "No recent game played.";
        if (channelResponse.ok) {
            const channelData = await channelResponse.json();
            const channel = channelData.data[0];
            if (channel?.game_name) {
                gameName = channel.game_name;
            }
        } else {
             console.warn('Failed to fetch Twitch channel info for user:', usernameOrId);
        }
        
        return {
            id: id,
            bio: description || "This user has no bio.",
            lastGame: gameName,
            displayName: display_name,
            profileImageUrl: profile_image_url,
        };

    } catch (error) {
        console.error('Error fetching Twitch user data:', error);
        throw error;
    }
}