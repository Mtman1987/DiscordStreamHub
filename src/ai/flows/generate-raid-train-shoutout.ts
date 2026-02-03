'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { getTwitchUserTool } from '../tools/get-twitch-user-tool';
import { RaidTrainService } from '@/lib/raid-train-service';

const GenerateRaidTrainShoutoutInputSchema = z.object({
  forceUsername: z.string().optional().describe('Force a specific username instead of current slot'),
});
export type GenerateRaidTrainShoutoutInput = z.infer<typeof GenerateRaidTrainShoutoutInputSchema>;

const GenerateRaidTrainShoutoutOutputSchema = z.object({
  shoutout: z.string().describe('The generated raid train shoutout message.'),
  username: z.string().optional().describe('The username being shouted out.'),
  hasScheduledUser: z.boolean().describe('Whether someone is scheduled for this slot.'),
});
export type GenerateRaidTrainShoutoutOutput = z.infer<typeof GenerateRaidTrainShoutoutOutputSchema>;

export async function generateRaidTrainShoutout(input: GenerateRaidTrainShoutoutInput = {}): Promise<GenerateRaidTrainShoutoutOutput> {
  const raidTrainService = RaidTrainService.getInstance();
  const currentSlot = await raidTrainService.getCurrentSlot();
  
  const targetUsername = input.forceUsername || currentSlot?.username;
  
  if (!targetUsername) {
    return {
      shoutout: "🚂 All aboard the Space Mountain Express! The current time slot is open - any brave Captain ready to join the raid train? Sign up for your adventure through the cosmos!",
      hasScheduledUser: false
    };
  }

  const result = await generateRaidTrainShoutoutFlow({ username: targetUsername });
  return {
    ...result,
    username: targetUsername,
    hasScheduledUser: true
  };
}

const prompt = ai.definePrompt({
  name: 'generateRaidTrainShoutoutPrompt',
  input: { schema: z.object({ username: z.string() }) },
  output: { schema: z.object({ shoutout: z.string() }) },
  tools: [getTwitchUserTool],
  prompt: `You are Athena, a 912-year-old starship AI co-hosting a Twitch stream with your Commander.
Your job is to generate an exciting RAID TRAIN shoutout for the Captain scheduled for this time slot.
Use creative, space-themed jargon with train/railroad metaphors.

Use the getTwitchUserInfo tool to look up the user by their username.

Based on their last played game and bio, create a fun and engaging raid train shoutout.
Make sure to mention their username and the game they last played.
The shoutout should be one or two sentences long and emphasize they're the next stop on the raid train.

Example:
"🚂 Next stop on the Space Mountain Express: Captain {{username}}'s stellar station! They were last seen navigating the cosmic rails through {lastGame}. All passengers, prepare for departure to twitch.tv/{{username}}!"

Username: {{{username}}}`,
});

const generateRaidTrainShoutoutFlow = ai.defineFlow(
  {
    name: 'generateRaidTrainShoutoutFlow',
    inputSchema: z.object({ username: z.string() }),
    outputSchema: z.object({ shoutout: z.string() }),
  },
  async (input) => {
    const llmResponse = await prompt(input);
    const shoutout = llmResponse.output?.shoutout;

    if (!shoutout) {
      throw new Error("The AI failed to generate a raid train shoutout.");
    }
    
    return { shoutout };
  }
);