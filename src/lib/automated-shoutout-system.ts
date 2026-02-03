
'use server';

import { generateAllShoutouts } from "./community-shoutout-service";
import { postAllShoutoutsToDiscord } from "./discord-bot-service";

/**
 * A drastically simplified shoutout cycle for diagnostics.
 * This function is now self-contained and has no external dependencies besides the two services it calls.
 * It does not interact with Firestore.
 */
export async function runAutomatedShoutoutCycle(serverId: string): Promise<void> {
  const cycleId = Date.now();
  console.log(`[ShoutoutCycle/${cycleId}] DIAGNOSTIC MODE: Received request for server ${serverId}.`);
  
  try {
    // 1. Generate a single piece of mock shoutout data.
    console.log(`[ShoutoutCycle/${cycleId}] Step 1: Generating hardcoded mock shoutout data...`);
    const mockUsersToPost = await generateAllShoutouts(serverId);
    
    // 2. Post the mock data to Discord.
    console.log(`[ShoutoutCycle/${cycleId}] Step 2: Posting mock shoutout to Discord...`);
    await postAllShoutoutsToDiscord(serverId, mockUsersToPost);
    
    console.log(`[ShoutoutCycle/${cycleId}] Diagnostic cycle completed successfully.`);

  } catch (error) {
    console.error(`[ShoutoutCycle/${cycleId}] An error occurred during the diagnostic run:`, error);
    // Intentionally not writing to DB to keep this isolated.
  }
}
