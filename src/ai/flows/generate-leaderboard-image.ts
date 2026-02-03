'use server';

/**
 * @fileOverview This file defines a Genkit flow for generating a leaderboard image.
 * This is a simple wrapper around a Puppeteer call for screenshotting a headless page.
 *
 * - generateLeaderboardImage - A function that returns a base64 encoded PNG of the leaderboard.
 */
export async function generateLeaderboardImage(
  guildId: string
): Promise<string | null> {
  try {
    console.log('[generateLeaderboardImage] DIAGNOSTIC MODE: Bypassing vercel/og and Firestore. Fetching placeholder.');
    const response = await fetch('https://picsum.photos/seed/leaderboard-diagnostic/600/800');
    if (!response.ok) {
        throw new Error('Failed to fetch placeholder image.');
    }
    const imageBuffer = await response.arrayBuffer();
    return `data:image/jpeg;base64,${Buffer.from(imageBuffer).toString('base64')}`;
  } catch (error) {
    console.error(`[generateLeaderboardImage] DIAGNOSTIC MODE FAILED:`, error);
    return null;
  }
}
