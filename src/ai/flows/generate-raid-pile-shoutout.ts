'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { getTwitchUserTool } from '../tools/get-twitch-user-tool';

const GenerateRaidPileShoutoutInputSchema = z.object({
  username: z.string().describe('The username to generate a raid pile shoutout for'),
  isHolder: z.boolean().optional().describe('Whether this person is a raid pile holder'),
});
export type GenerateRaidPileShoutoutInput = z.infer<typeof GenerateRaidPileShoutoutInputSchema>;

const GenerateRaidPileShoutoutOutputSchema = z.object({
  shoutout: z.string().describe('The generated raid pile shoutout message'),
});
export type GenerateRaidPileShoutoutOutput = z.infer<typeof GenerateRaidPileShoutoutOutputSchema>;

export async function generateRaidPileShoutout(input: GenerateRaidPileShoutoutInput): Promise<GenerateRaidPileShoutoutOutput> {
  return await generateRaidPileShoutoutFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateRaidPileShoutoutPrompt',
  input: { schema: GenerateRaidPileShoutoutInputSchema },
  output: { schema: GenerateRaidPileShoutoutOutputSchema },
  tools: [getTwitchUserTool],
  prompt: `You are Athena, a 912-year-old starship AI co-hosting a Twitch stream with your Commander.
Your job is to generate an exciting RAID PILE shoutout for a Captain in the pile.

Use the getTwitchUserInfo tool to look up the user by their username.

{{#if isHolder}}
This Captain is a RAID PILE HOLDER - they get special treatment! Create an epic shoutout that:
- Emphasizes they're leading a pile of raiders
- Mentions their last played game
- Encourages everyone to "PILE ON" to their channel
- Uses mountain/avalanche metaphors with space themes
- Should be 2-3 sentences long

Example for holder:
"🏔️ AVALANCHE ALERT! Pile Holder Captain {{username}} is commanding the Space Mountain summit! They were last seen conquering {lastGame}. All raiders, prepare for the PILE ON at twitch.tv/{{username}} - let's create a cosmic avalanche!"
{{else}}
This Captain is a regular pile member. Create a fun shoutout that:
- Shows they're part of the raid pile community
- Mentions their last played game
- Encourages raiding to their channel
- Uses pile/mountain metaphors
- Should be 1-2 sentences long

Example for member:
"🏔️ Captain {{username}} is ready for action in the Space Mountain Pile! They were last seen exploring {lastGame}. Pile on over to twitch.tv/{{username}} and join the adventure!"
{{/if}}

Username: {{{username}}}
Is Holder: {{isHolder}}`,
});

const generateRaidPileShoutoutFlow = ai.defineFlow(
  {
    name: 'generateRaidPileShoutoutFlow',
    inputSchema: GenerateRaidPileShoutoutInputSchema,
    outputSchema: GenerateRaidPileShoutoutOutputSchema,
  },
  async (input) => {
    const llmResponse = await prompt(input);
    const shoutout = llmResponse.output?.shoutout;

    if (!shoutout) {
      throw new Error("The AI failed to generate a raid pile shoutout.");
    }
    
    return { shoutout };
  }
);