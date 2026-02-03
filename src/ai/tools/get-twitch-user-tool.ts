/**
 * @fileOverview A Genkit tool for fetching user information from Twitch.
 */

import { ai } from '@/ai/genkit';
import { getTwitchUser } from '@/services/twitch';
import { z } from 'zod';

export const getTwitchUserTool = ai.defineTool(
  {
    name: 'getTwitchUserInfo',
    description: 'Retrieves a Twitch user\'s bio, display name, and last streamed game category.',
    inputSchema: z.object({
      username: z.string().describe('The Twitch username to look up.'),
    }),
    outputSchema: z.object({
      displayName: z.string(),
      bio: z.string(),
      lastGame: z.string(),
    }),
  },
  async (input) => {
    const user = await getTwitchUser(input.username);
    if (!user) {
      throw new Error(`User ${input.username} not found on Twitch.`);
    }
    return {
      displayName: user.displayName,
      bio: user.bio,
      lastGame: user.lastGame,
    };
  }
);