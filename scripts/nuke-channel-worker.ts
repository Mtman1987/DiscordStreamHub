import 'dotenv/config';
import { cleanupJobs, runCleanupBatch } from '../src/lib/discord-channel-cleanup';
async function main() {
  console.log('[ChannelCleanup] Durable cleanup worker started');
  while (true) {
    try {
      for (const job of cleanupJobs().filter(job => ['queued', 'running'].includes(job.status))) {
        const result = await runCleanupBatch(job.id);
        console.log('[ChannelCleanup]', job.id, result?.status, result?.deleted, result?.error || '');
      }
    } catch (error) { console.error('[ChannelCleanup] Worker error:', error); }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
void main().catch(error => { console.error('[ChannelCleanup] Fatal:', error); process.exit(1); });
