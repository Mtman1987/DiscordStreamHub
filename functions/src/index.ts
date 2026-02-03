import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import fetch from 'node-fetch';

initializeApp();

const appUrl = process.env.APP_URL || process.env.FUNCTIONS_APP_URL || 'https://your-app.web.app';
const serverId = process.env.SERVER_ID || process.env.HARDCODED_GUILD_ID;

async function triggerManualPoll(): Promise<void> {
  if (!serverId) {
    throw new Error('SERVER_ID/HARDCODED_GUILD_ID env var is not set');
  }

  const response = await fetch(`${appUrl}/api/polling`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'manual', serverId })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${response.statusText} - ${text}`);
  }

  const result = await response.json();
  console.log('Manual poll completed:', result);
}

export const twitchPolling = onSchedule('*/10 * * * *', async () => {
  try {
    await triggerManualPoll();
  } catch (error) {
    console.error('Scheduled polling failed:', error);
  }
});

export const triggerPoll = onRequest(async (_req, res) => {
  try {
    await triggerManualPoll();
    res.json({ success: true });
  } catch (error) {
    console.error('Manual poll failed:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
