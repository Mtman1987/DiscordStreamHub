import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMtFixItJobRequest, type MtFixItSubmissionInput } from './mtfixit-contract';

const DEFAULT_ROTATOR_URL = 'https://mtman-machine-rotator.fly.dev';
const REPORTER_COOLDOWN_MS = 60_000;
const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS = 45 * 60_000;
const MAX_DM_MESSAGE = 1900;
const MAX_FILE_BYTES = 500_000;

const reporterCooldowns = new Map<string, number>();
const activeMonitors = new Set<string>();

type RotatorJob = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt?: string;
  updatedAt?: string;
  source?: string;
  reporter?: string;
  reporterId?: string;
  tenantId?: string;
  appName?: string;
  repoId?: string;
  description?: string;
  summary?: string;
  changedFiles?: string[];
  checks?: Array<{ command: string; ok: boolean; output?: string }>;
  error?: string;
  pullRequest?: { number: number; url: string; branch: string; commit: string };
};

export type MtFixItSubmissionResult = {
  ok: true;
  jobId: string;
  dashboardUrl: string;
};

function sharedKey(): string {
  return String(process.env.SPMT_API_KEY || process.env.SPMT_PLATFORM_API_KEY || '').trim();
}

function rotatorBaseUrl(): string {
  return String(process.env.ROTATOR_BASE_URL || process.env.CODEX_WORKER_URL || DEFAULT_ROTATOR_URL)
    .trim()
    .replace(/\/$/, '');
}

function readRuntimeConfig(): any {
  const candidates = [
    process.env.RUNTIME_CONFIG_FILE,
    '/data/runtime-config.json',
    join(process.cwd(), 'data', 'runtime-config.json'),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8'));
    } catch (error) {
      console.warn(`[MtFixIt] Could not read runtime config ${candidate}:`, error);
    }
  }
  return {};
}

function ownerDiscordId(): string {
  const config = readRuntimeConfig();
  return String(
    process.env.HARDCODED_ADMIN_DISCORD_ID
      || process.env.NEXT_PUBLIC_HARDCODED_ADMIN_DISCORD_ID
      || config?.publicIds?.hardcodedAdminDiscordId
      || '',
  ).trim();
}

function discordBotToken(): string {
  return String(process.env.DISCORD_BOT_TOKEN || '').trim();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendOwnerDm(input: { message: string; fileName?: string; fileContent?: string }) {
  const recipientId = ownerDiscordId();
  const botToken = discordBotToken();
  if (!recipientId) throw new Error('Owner Discord ID is not configured.');
  if (!botToken) throw new Error('Discord bot token is not configured.');

  const openDm = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: recipientId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!openDm.ok) throw new Error(`Could not open owner DM: ${openDm.status} ${await openDm.text()}`);
  const dm = await openDm.json() as { id?: string };
  if (!dm.id) throw new Error('Discord did not return an owner DM channel.');

  const message = input.message.trim().slice(0, MAX_DM_MESSAGE);
  const fileContent = String(input.fileContent || '');
  let sent: Response;
  if (fileContent) {
    if (Buffer.byteLength(fileContent, 'utf8') > MAX_FILE_BYTES) {
      throw new Error('Owner DM attachment is too large.');
    }
    const form = new FormData();
    form.append('files[0]', new Blob([fileContent], { type: 'text/plain' }), input.fileName || 'athena-mtfixit.txt');
    if (message) form.append('payload_json', JSON.stringify({ content: message, allowed_mentions: { parse: [] } }));
    sent = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}` },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
  } else {
    sent = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(15_000),
    });
  }
  if (!sent.ok) throw new Error(`Discord rejected owner DM: ${sent.status} ${await sent.text()}`);
}

function jobReport(job: RotatorJob, input: MtFixItSubmissionInput): string {
  const checks = (job.checks || [])
    .map((check) => `${check.ok ? 'PASS' : 'FAIL'} ${check.command}${check.output ? `\n${check.output.slice(-2000)}` : ''}`)
    .join('\n\n');
  return [
    `Athena Coder job: ${job.id}`,
    `Status: ${job.status}`,
    `Source: ${input.source}`,
    `Reporter: ${input.reporter} (${input.reporterId})`,
    `Channel: ${input.channelName || input.channelId || 'unknown'}`,
    `Repository: ${job.repoId || job.appName || 'inferred by rotator'}`,
    '',
    'Problem:',
    input.description,
    '',
    'Athena response:',
    job.summary || job.error || 'No response was recorded.',
    '',
    'Changed files:',
    (job.changedFiles || []).length ? (job.changedFiles || []).join('\n') : 'None',
    '',
    'Checks:',
    checks || 'No checks were recorded.',
    '',
    job.pullRequest ? `Draft PR: ${job.pullRequest.url}` : 'Draft PR: not published; owner review remains required.',
  ].join('\n');
}

async function readJob(jobId: string): Promise<RotatorJob> {
  const key = sharedKey();
  const response = await fetch(`${rotatorBaseUrl()}/api/dsh/mtfixit/jobs/${encodeURIComponent(jobId)}`, {
    headers: { accept: 'application/json', 'x-dsh-mtfixit-key': key },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.id) {
    throw new Error(`Rotator job read failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload as RotatorJob;
}

async function monitorJob(jobId: string, input: MtFixItSubmissionInput) {
  if (activeMonitors.has(jobId)) return;
  activeMonitors.add(jobId);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      await delay(POLL_INTERVAL_MS);
      const job = await readJob(jobId);
      if (job.status !== 'completed' && job.status !== 'failed') continue;
      const report = jobReport(job, input);
      await sendOwnerDm({
        message: `Athena Coder finished ${job.id} with status **${job.status}**. Review the attached report before publishing anything.`,
        fileName: `${job.id}.txt`,
        fileContent: report,
      });
      console.log(`[MtFixIt] completion job=${job.id} status=${job.status} ownerDm=sent`);
      return;
    }
    await sendOwnerDm({
      message: `Athena Coder job ${jobId} is still not complete after 45 minutes. It remains available in the rotator dashboard for owner review.`,
    });
    console.warn(`[MtFixIt] monitor timeout job=${jobId}`);
  } catch (error) {
    console.error(`[MtFixIt] monitor failed job=${jobId}:`, error);
    await sendOwnerDm({
      message: `Athena Coder job ${jobId} was accepted, but DSH could not monitor it to completion. Check the rotator dashboard and DSH logs.`,
    }).catch(() => undefined);
  } finally {
    activeMonitors.delete(jobId);
  }
}

export async function submitMtFixIt(input: MtFixItSubmissionInput): Promise<MtFixItSubmissionResult> {
  const description = String(input.description || '').trim();
  if (!description) throw new Error('A problem description is required.');

  const cooldownKey = `${input.source}:${input.reporterId}`;
  const lastSubmittedAt = reporterCooldowns.get(cooldownKey) || 0;
  if (Date.now() - lastSubmittedAt < REPORTER_COOLDOWN_MS) {
    throw new Error('Please wait a minute before submitting another repair report.');
  }

  const key = sharedKey();
  if (!key) throw new Error('SPMT_API_KEY is not configured for the DSH-to-rotator bridge.');
  reporterCooldowns.set(cooldownKey, Date.now());

  const response = await fetch(`${rotatorBaseUrl()}/api/dsh/mtfixit/jobs`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-dsh-mtfixit-key': key,
    },
    body: JSON.stringify(buildMtFixItJobRequest({ ...input, description })),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null);
  const job = payload?.job as RotatorJob | undefined;
  if (!response.ok || !job?.id) {
    reporterCooldowns.delete(cooldownKey);
    throw new Error(`Rotator rejected the report: ${response.status} ${JSON.stringify(payload)}`);
  }

  const dashboardUrl = String(payload?.dashboardUrl || `${rotatorBaseUrl()}/athena`);
  const initialReport = [
    `New Athena Coder report: ${job.id}`,
    `Source: ${input.source}`,
    `Reporter: ${input.reporter} (${input.reporterId})`,
    `Channel: ${input.channelName || input.channelId || 'unknown'}`,
    `Dashboard: ${dashboardUrl}`,
    '',
    description,
  ].join('\n');
  await sendOwnerDm({
    message: `A new repair report was submitted to Athena Coder. Job: **${job.id}**. Only the owner can review and publish the resulting fix.`,
    fileName: `${job.id}-submitted.txt`,
    fileContent: initialReport,
  }).catch((error) => console.error(`[MtFixIt] initial owner DM failed job=${job.id}:`, error));

  void monitorJob(job.id, { ...input, description });
  console.log(`[MtFixIt] accepted job=${job.id} source=${input.source} reporter=${input.reporterId}`);
  return { ok: true, jobId: job.id, dashboardUrl };
}
