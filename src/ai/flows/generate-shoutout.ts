'use server';

/**
 * @fileOverview An AI agent that generates a personalized shoutout for a Twitch user.
 *
 * - generateShoutout - A function that handles generating the shoutout.
 * - GenerateShoutoutInput - The input type for the generateShoutout function.
 * - GenerateShoutoutOutput - The return type for the generateShoutout function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { getTwitchUserTool } from '../tools/get-twitch-user-tool';

const GenerateShoutoutInputSchema = z.object({
  username: z.string().describe('The Twitch username to generate a shoutout for.'),
});
export type GenerateShoutoutInput = z.infer<typeof GenerateShoutoutInputSchema>;

const GenerateShoutoutOutputSchema = z.object({
  shoutout: z.string().describe('The generated shoutout message.'),
});
export type GenerateShoutoutOutput = z.infer<typeof GenerateShoutoutOutputSchema>;

export async function generateShoutout(input: GenerateShoutoutInput): Promise<GenerateShoutoutOutput> {
  return await generateShoutoutFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateShoutoutPrompt',
  input: { schema: GenerateShoutoutInputSchema },
  output: { schema: GenerateShoutoutOutputSchema },
  tools: [getTwitchUserTool],
  prompt: `You are Athena, a 912-year-old starship AI co-hosting a Twitch stream with your Commander.
Your job is to generate an exciting and personalized shoutout for another streamer (a 'Captain').
Use creative, space-themed jargon.

Use the getTwitchUserInfo tool to look up the user by their username.

Based on their last played game and bio, create a fun and engaging shoutout.
Make sure to mention their username and the game they last played.
The shoutout should be one or two sentences long.

Example:
"Commander, diverting power to welcome a new Captain to the bridge! It's {{username}}! They were last seen charting a course through {lastGame}. All hands, prepare to engage their channel at twitch.tv/{{username}}!"

Username: {{{username}}}
`,
});


const generateShoutoutFlow = ai.defineFlow(
  {
    name: 'generateShoutoutFlow',
    inputSchema: GenerateShoutoutInputSchema,
    outputSchema: GenerateShoutoutOutputSchema,
  },
  async (input) => {
    const llmResponse = await prompt(input);
    const shoutout = llmResponse.output?.shoutout;

    if (!shoutout) {
        throw new Error("The AI failed to generate a shoutout.");
    }
    
    // The tool might be called by the LLM, so we need to handle the tool's output.
    // However, for a simple case like this, we can often rely on the LLM to synthesize the information.
    // If the LLM just returns the tool output, we could format it here. But the prompt asks it to create a sentence.
    
    return {
        shoutout: shoutout,
    };
  }
);