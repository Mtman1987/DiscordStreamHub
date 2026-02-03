'use server';

/**
 * @fileOverview This file defines a Genkit flow to generate tailored shoutout messages
 * in the form of Discord Embed JSON.
 *
 * - generateTailoredShoutout - a function that generates a tailored shoutout message.
 * - GenerateTailoredShoutoutInput - The input type for the generateTailoredShoutout function.
 * - GenerateTailoredShoutoutOutput - The return type for the generateTailoredShoutout function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const GenerateTailoredShoutoutInputSchema = z.object({
  groupType: z
    .enum(['VIP', 'Community', 'Train', 'Pile'])
    .describe('The type of streamer group.'),
  streamerName: z.string().describe('The name of the streamer.'),
  platform: z.string().describe('The platform the streamer is streaming on.'),
  topic: z.string().describe('The topic of the stream.'),
  avatarUrl: z.string().url().describe("The streamer's avatar URL."),
});
export type GenerateTailoredShoutoutInput = z.infer<
  typeof GenerateTailoredShoutoutInputSchema
>;

const GenerateTailoredShoutoutOutputSchema = z.object({
  shoutoutEmbed: z
    .any()
    .describe('The generated shoutout message as a Discord Embed JSON object.'),
});
export type GenerateTailoredShoutoutOutput = z.infer<
  typeof GenerateTailoredShoutoutOutputSchema
>;

export async function generateTailoredShoutout(
  input: GenerateTailoredShoutoutInput
): Promise<GenerateTailoredShoutoutOutput> {
  return generateTailoredShoutoutFlow(input);
}


const vipShoutoutPrompt = ai.definePrompt({
    name: "vipShoutoutPrompt",
    input: { schema: GenerateTailoredShoutoutInputSchema },
    output: { schema: GenerateTailoredShoutoutOutputSchema },
    prompt: `
      You are Space Mountain Command Center AI announcing a VIP PRIORITY ALERT.
      
      Create a valid Discord message JSON object with this exact structure:
      {
        "content": "🚀 **PRIORITY TRANSMISSION FROM SPACE MOUNTAIN COMMAND** @everyone",
        "embeds": [{
          "author": {
            "name": "Commander {{streamerName}}",
            "url": "https://twitch.tv/{{streamerName}}",
            "icon_url": "{{avatarUrl}}"
          },
          "title": "🌌 Elite Mission: {{topic}}",
          "url": "https://twitch.tv/{{streamerName}}",
          "description": "2-3 sentences emphasizing elite status, flagship vessel, priority mission using terms like Elite Commander, flagship, priority expedition, legendary pilot",
          "color": 9521663,
          "thumbnail": {
            "url": "{{avatarUrl}}"
          },
          "footer": {
            "text": "Space Mountain VIP Command | Powered by Cosmic AI"
          },
          "timestamp": "{{timestamp}}"
        }],
        "components": [{
          "type": 1,
          "components": [{
            "type": 2,
            "label": "🚀 Join Mission on Twitch",
            "style": 5,
            "url": "https://twitch.tv/{{streamerName}}"
          }]
        }]
      }
      
      Replace {{streamerName}}, {{topic}}, {{avatarUrl}}, and {{timestamp}} with actual values.
    `,
  });

const communityShoutoutPrompt = ai.definePrompt({
    name: "communityShoutoutPrompt",
    input: { schema: GenerateTailoredShoutoutInputSchema },
    output: { schema: GenerateTailoredShoutoutOutputSchema },
    prompt: `
      You are Space Mountain Command Center AI announcing community member missions.
      
      Create a valid Discord embed JSON object with this exact structure:
      {
        "embeds": [{
          "author": {
            "name": "Captain {{streamerName}}",
            "url": "https://twitch.tv/{{streamerName}}",
            "icon_url": "{{avatarUrl}}"
          },
          "title": "{{topic}}",
          "url": "https://twitch.tv/{{streamerName}}",
          "description": "2-3 sentences about their exploration mission using terms like Captain, exploration vessel, charting new territories, brave explorer, standard mission protocols",
          "color": 9521663,
          "thumbnail": {
            "url": "{{avatarUrl}}"
          },
          "footer": {
            "text": "Space Mountain Command | Powered by Cosmic AI"
          },
          "timestamp": "{{timestamp}}"
        }]
      }
      
      Replace {{streamerName}}, {{topic}}, {{avatarUrl}}, and {{timestamp}} with actual values.
    `,
  });

const trainPrompt = ai.definePrompt({
    name: "trainPrompt",
    input: { schema: GenerateTailoredShoutoutInputSchema },
    output: { schema: GenerateTailoredShoutoutOutputSchema },
    prompt: `
      You are Space Mountain Command announcing a RAID TRAIN convoy mission.
      
      Raid Train Theme: Convoy formation, coordinated fleet movement, express routes, all aboard energy
      
      Create a Discord embed:
      - "title": Raid train announcement with convoy/express themes
      - "description": 2-3 sentences about the convoy departing, next destination, coordinated fleet movement. Use terms like "Cosmic Express", "convoy formation", "fleet coordination", "express route", "all aboard", "destination locked"
      - "color": 0xff4500 (orange)
      - "footer": "Space Mountain Raid Train Command"
    `,
  });

const pilePrompt = ai.definePrompt({
    name: "pilePrompt",
    input: { schema: GenerateTailoredShoutoutInputSchema },
    output: { schema: GenerateTailoredShoutoutOutputSchema },
    prompt: `
      You are Space Mountain Command announcing a RAID PILE fleet convergence.
      
      Raid Pile Theme: Massive fleet convergence, overwhelming support, coordinated assault, pile-on energy
      
      Create a Discord embed:
      - "title": Fleet convergence announcement
      - "description": 2-3 sentences about massive fleet maneuver, overwhelming support, coordinated convergence. Use terms like "fleet convergence", "massive maneuver", "overwhelming support", "coordinated assault", "full fleet deployment", "convergence point"
      - "color": 0x5865f2 (blue)
      - "footer": "Space Mountain Fleet Command"
    `,
  });


const generateTailoredShoutoutFlow = ai.defineFlow(
  {
    name: 'generateTailoredShoutoutFlow',
    inputSchema: GenerateTailoredShoutoutInputSchema,
    outputSchema: GenerateTailoredShoutoutOutputSchema,
  },
  async (input) => {

    // Use AI generation for all group types
    let prompt;
    switch (input.groupType) {
      case 'VIP':
        prompt = vipShoutoutPrompt;
        break;
      case 'Community':
        prompt = communityShoutoutPrompt;
        break;
      case 'Train':
        prompt = trainPrompt;
        break;
      case 'Pile':
        prompt = pilePrompt;
        break;
      default:
        prompt = communityShoutoutPrompt;
    }
    
    const { output } = await prompt({
      ...input,
      timestamp: new Date().toISOString()
    });
    if (output?.shoutoutEmbed) {
      return { shoutoutEmbed: output.shoutoutEmbed };
    }


    // Fallback for other groups with Space Mountain theme
    const embeds = {
      VIP: {
        content: '🚀 **PRIORITY TRANSMISSION FROM SPACE MOUNTAIN COMMAND** @everyone',
        embeds: [
          {
            author: {
              name: `Captain ${input.streamerName}`,
              url: `https://twitch.tv/${input.streamerName}`,
              icon_url: input.avatarUrl,
            },
            title: `🌌 Mission: ${input.topic}`,
            url: `https://twitch.tv/${input.streamerName}`,
            description: `**📡 ALERT: Elite Commander ${input.streamerName} has launched from Space Mountain Base!**\n\nMission Control confirms all systems are operational. This is a high-priority expedition requiring immediate crew support. All available personnel report to stations!`,
            color: 9521663,
            fields: [
              {
                name: '🎮 Sector',
                value: 'Live Mission Data',
                inline: true,
              },
              {
                name: '👥 Crew Status',
                value: 'Assembling',
                inline: true,
              },
              {
                name: '📶 Signal',
                value: 'Live Now! 🚀',
                inline: true,
              },
            ],
            thumbnail: {
              url: input.avatarUrl,
            },
            footer: {
              text: 'Space Mountain VIP Command | Powered by Cosmic AI',
            },
            timestamp: new Date().toISOString(),
          },
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                label: '🚀 Join Mission on Twitch',
                style: 5,
                url: `https://twitch.tv/${input.streamerName}`,
              },
            ],
          },
        ],
      },
      'Raid Train': {
        color: 0xff4500,
        title: `🚂 🚀 SPACE MOUNTAIN RAID TRAIN DEPARTING!`,
        description: `**ALL ABOARD THE COSMIC EXPRESS!** Next destination: Captain ${input.streamerName}'s vessel in the **${input.topic}** sector! Prepare for warp speed and maximum hype deployment! 🌌`,
        thumbnail: { url: input.avatarUrl },
        footer: { text: 'Space Mountain Raid Train Command' },
      },
      'Raid Pile': {
        color: 0x5865f2,
        title: `🛸 SPACE MOUNTAIN FLEET CONVERGENCE!`,
        description: `**MASSIVE FLEET MANEUVER INITIATED!** All Space Mountain vessels converge on Captain ${input.streamerName}'s coordinates! They're exploring **${input.topic}** - let's show them the power of our cosmic community! 🌌🚀`,
        thumbnail: { url: input.avatarUrl },
        footer: { text: 'Space Mountain Fleet Command' },
      },
      Community: {}
    };

    // This part is now a fallback for non-community groups
    const shoutoutEmbed = embeds[input.groupType];
    return { shoutoutEmbed };
  }
);
