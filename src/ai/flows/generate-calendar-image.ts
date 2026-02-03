'use server';

/**
 * @fileOverview This file defines a Genkit flow for generating a calendar image.
 * This is a simple wrapper around a Puppeteer call for screenshotting a headless page.
 *
 * - generateCalendarImage - A function that returns a base64 encoded PNG of the calendar.
 */
export async function generateCalendarImage(
  guildId: string
): Promise<string | null> {
  try {
    console.log('[generateCalendarImage] DIAGNOSTIC MODE: Bypassing vercel/og and Firestore. Fetching placeholder.');
    const response = await fetch('https://picsum.photos/seed/calendar-diagnostic/600/600');
    if (!response.ok) {
        throw new Error('Failed to fetch placeholder image.');
    }
    const imageBuffer = await response.arrayBuffer();
    return `data:image/jpeg;base64,${Buffer.from(imageBuffer).toString('base64')}`;
  } catch (error) {
    console.error(`[generateCalendarImage] DIAGNOSTIC MODE FAILED:`, error);
    return null;
  }
}
