'use server';

import { convertClipToGif } from './gif-conversion-service';

interface ShoutoutCardData {
  streamerName: string;
  streamTitle: string;
  gameName: string;
  viewerCount: number;
  avatarUrl: string;
  streamThumbnail: string;
  isLive: boolean;
  isMature?: boolean;
}

/**
 * Generates a GIF for a shoutout card.
 * This service is now hardwired to use the gif-conversion-service,
 * which directly uses the FreeConvert API.
 */
export async function generateShoutoutCardGif(
  cardData: ShoutoutCardData,
  serverId: string
): Promise<{ gifUrl: string; mp4Url: string } | null> {
  const { streamerName, streamTitle, gameName } = cardData;

  try {
    console.log(`[ShoutoutCardService] Requesting GIF for ${streamerName} via hardwired FreeConvert service.`);
    
    // The clipUrl and clipId are now symbolic, as the conversion service will fetch the latest clip.
    const gifUrl = await convertClipToGif(
      'https://twitch.tv', // Placeholder URL
      'latest',            // Placeholder ID
      streamerName,
      10,
      'stream',
      { serverId }
    );

    if (gifUrl) {
      // We don't have a direct MP4 url from this simplified flow, so we'll construct a placeholder.
      // This part might need adjustment depending on how the mp4 is used.
      const mp4Url = gifUrl.replace('.gif', '.mp4').replace('gifs/', 'videos/');
      return { gifUrl, mp4Url };
    }

    console.error(`[ShoutoutCardService] All generation methods failed for ${streamerName}`);
    return null;

  } catch (error) {
    console.error(`[ShoutoutCardService] Error generating shoutout card for ${streamerName}:`, error);
    return null;
  }
}
