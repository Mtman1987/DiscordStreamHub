import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildMtFixItJobRequest, type MtFixItPublicOutcome, type MtFixItSubmissionInput } from './mtfixit-contract';
import { captureCommlinkDiagnosticSnapshot, type CommlinkDiagnosticSnapshot } from './mtfixit-commlink';
import { sendOwnerDiscordDm } from './owner-dm-service';

const DEFAULT_ROTATOR_URL = 'https://mtman-machine-rotator.fly.dev';
const REPORTER_COOLDOWN_MS = 60_000;
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 60 * 60_000;
const MAX_SNAPSHOT_TEXT = 120_000;
const reporterCooldowns = new Map<string, number>();
const activeMonitors = new Set<string>();

type RotatorJob = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
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

export type MtFixItResolutionState = {
  schemaVersion?: string;
  jobId: string;
  status: 'awaiting_analysis' | 'awaiting_approval' | 'deploying' | 'deployed' | 'failed' | 'denied' | 'no_change';
  updatedAt?: string;
  knownFix?: boolean;
  message?: string;
  pullRequest?: { number: number; url: string; branch: string; commit: string };
  mergeCommit?: string;
  workflow?: { id: number; name: string; status: string; conclusion?: string | null; url?: string };
};

type DiagnosticEvidence = {
  schemaVersion: 'dsh.mtfixit.snapshot/v2';
  capturedAt: string;
  scope: {
    evidence: 'ecosystem-global';
    tenantIdHint: string | null;
    source: MtFixItSubmissionInput['source'];
    reporterId: string;
    channelId: string | null;
    messageId: string | null;
  };
  incidentWindow: { beforeMinutes: number; afterMinutes: number };
  sourceMessage: { reporter: string; description: string };
  ecosystemSnapshot:
    | { status: 'captured'; endpoint: string; snapshotJson: string; truncated: boolean }
    | { status: 'unavailable'; endpoint: string; error: string };
  commlinkSnapshot: CommlinkDiagnosticSnapshot;
  adapters: Record<string, { status: 'captured' | 'unavailable' | 'pending-adapter'; note: string }>;
};

export type MtFixItLifecycleEvent = {
  jobId: string;
  outcome: MtFixItPublicOutcome;
  stage: 'waiting-review' | 'fixed' | 'failed' | 'no-change';
  message?: string;
};

export type MtFixItSubmitOptions = {
  onLifecycle?: (event: MtFixItLifecycleEvent) => void | Promise<void>;
};

export type MtFixItSubmissionResult = {
  ok: true;
  jobId: string;
  dashboardUrl: string;
  disposition: 'submitted' | 'escalated';
  persisted?: boolean;
};

function sharedKey(): string {
  return String(process.env.SPMT_API_KEY || process.env.SPMT_PLATFORM_API_KEY || '').trim();
}

function rotatorBaseUrl(): string {
  return String(process.env.ROTATOR_BASE_URL || process.env.CODEX_WORKER_URL || DEFAULT_ROTATOR_URL).trim().replace(/\/$/, '');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeErrorText(error: unknown): string {
  return String(error instanceof Error ? error.message : error || 'unknown error')
    .replace(/Athena\s+Coder/gi, 'Athena')
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-|github_pat_)[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/([?&](?:token|secret|key|api_key)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, 900);
}

function redactSnapshotText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-|github_pat_)[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/(["']?(?:access_token|refresh_token|id_token|client_secret|password|authorization|api[_-]?key|token|secret)["']?\s*[:=]\s*["'])([^"']+)(["'])/gi, '$1[REDACTED]$3');
}

async function captureDiagnosticEvidence(input: MtFixItSubmissionInput): Promise<DiagnosticEvidence> {
  const capturedAt = new Date().toISOString();
  const endpoint = `${rotatorBaseUrl()}/ecosystem/v1/public.json`;
  let ecosystemSnapshot: DiagnosticEvidence['ecosystemSnapshot'];
  try {
    const response = await fetch(endpoint, { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    const raw = redactSnapshotText(await response.text());
    if (!response.ok) throw new Error(`ecosystem snapshot HTTP ${response.status}`);
    ecosystemSnapshot = { status: 'captured', endpoint, snapshotJson: raw.slice(0, MAX_SNAPSHOT_TEXT), truncated: raw.length > MAX_SNAPSHOT_TEXT };
  } catch (error) {
    ecosystemSnapshot = { status: 'unavailable', endpoint, error: safeErrorText(error) };
  }

  const commlinkSnapshot = await captureCommlinkDiagnosticSnapshot({ serviceKey: sharedKey(), capturedAt, source: input.source });
  return {
    schemaVersion: 'dsh.mtfixit.snapshot/v2',
    capturedAt,
    scope: {
      evidence: 'ecosystem-global',
      tenantIdHint: input.tenantId || null,
      source: input.source,
      reporterId: input.reporterId,
      channelId: input.channelId || null,
      messageId: input.messageId || null,
    },
    incidentWindow: { beforeMinutes: 10, afterMinutes: 0 },
    sourceMessage: { reporter: input.reporter, description: input.description },
    ecosystemSnapshot,
    commlinkSnapshot,
    adapters: {
      ecosystemHealth: { status: ecosystemSnapshot.status === 'captured' ? 'captured' : 'unavailable', note: 'Rotator runtime and managed-app health inventory.' },
      commlinkGlobal: { status: commlinkSnapshot.status === 'captured' ? 'captured' : 'unavailable', note: 'Global Commlink incident-window evidence across ecosystem apps and systems; tenant ID is not required.' },
      appRuntimeLogs: { status: 'pending-adapter', note: 'Per-app runtime logs remain a separate redacted diagnostic source when Commlink does not contain enough evidence.' },
      repairHistory: { status: 'captured', note: 'The rotator records Athena findings, diffs, checks, approvals, deployment state, and successful known fixes.' },
    },
  };
}

async function rotatorRequest(path: string, init: RequestInit = {}) {
  const key = sharedKey();
  if (!key) throw new Error('The DSH-to-rotator shared key is unavailable.');
  const response = await fetch(`${rotatorBaseUrl()}${path}`, {
    ...init,
    headers: { accept: 'application/json', 'x-dsh-mtfixit-key': key, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Rotator HTTP ${response.status}`);
  return payload;
}

async function readJob(jobId: string): Promise<RotatorJob> {
  const payload = await rotatorRequest(`/api/dsh/mtfixit/jobs/${encodeURIComponent(jobId)}`);
  if (!payload?.id) throw new Error('Rotator job read returned no job.');
  return payload as RotatorJob;
}

export async function decideMtFixIt(jobId: string, action: 'approve' | 'deny'): Promise<MtFixItResolutionState> {
  const payload = await rotatorRequest(`/api/dsh/mtfixit/jobs/${encodeURIComponent(jobId)}/resolution`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
  if (!payload?.state?.jobId) throw new Error('Rotator resolution returned no state.');
  return payload.state as MtFixItResolutionState;
}

async function resolveMtFixIt(jobId: string): Promise<MtFixItResolutionState> {
  const payload = await rotatorRequest(`/api/dsh/mtfixit/jobs/${encodeURIComponent(jobId)}/resolution`, {
    method: 'POST',
    body: JSON.stringify({ action: 'resolve' }),
  });
  if (!payload?.state?.jobId) throw new Error('Rotator resolution returned no state.');
  return payload.state as MtFixItResolutionState;
}

async function readResolution(jobId: string): Promise<MtFixItResolutionState | null> {
  try {
    const payload = await rotatorRequest(`/api/dsh/mtfixit/jobs/${encodeURIComponent(jobId)}/resolution`);
    return payload as MtFixItResolutionState;
  } catch (error) {
    if (/not found/i.test(safeErrorText(error))) return null;
    throw error;
  }
}

function jobReport(job: RotatorJob, input: MtFixItSubmissionInput, resolution?: MtFixItResolutionState) {
  const checks = (job.checks || []).map((check) => `${check.ok ? 'PASS' : 'FAIL'} ${check.command}`).join('\n');
  return [
    `Athena repair job: ${job.id}`,
    `Coder status: ${job.status}`,
    `Resolution: ${resolution?.status || 'not resolved yet'}`,
    `Source: ${input.source}`,
    `Tenant hint: ${input.tenantId || 'none'}`,
    `Reporter: ${input.reporter} (${input.reporterId})`,
    `Channel: ${input.channelName || input.channelId || 'unknown'}`,
    `Repository: ${job.repoId || job.appName || 'inferred by rotator'}`,
    '', 'Problem:', input.description,
    '', 'Athena response:', String(job.summary || job.error || resolution?.message || 'No response recorded.').replace(/Athena\s+Coder/gi, 'Athena').slice(0, 5000),
    '', 'Changed files:', (job.changedFiles || []).length ? (job.changedFiles || []).join('\n') : 'None',
    '', 'Checks:', checks || 'No checks were recorded.',
    '', resolution?.pullRequest ? `PR: ${resolution.pullRequest.url}` : job.pullRequest ? `PR: ${job.pullRequest.url}` : 'PR: not published',
    resolution?.mergeCommit ? `Merge commit: ${resolution.mergeCommit}` : '',
    resolution?.workflow ? `Workflow: ${resolution.workflow.name} ${resolution.workflow.status} ${resolution.workflow.conclusion || ''}` : '',
  ].filter(Boolean).join('\n');
}

async function notifyMtman(message: string, options: { fileName?: string; fileContent?: string; buttons?: Array<{ label: string; customId: string; style?: 1 | 2 | 3 | 4 }> } = {}) {
  try {
    await sendOwnerDiscordDm({ message, ...options });
    return true;
  } catch (error) {
    console.error('[MtFixIt] mtman DM delivery failed:', safeErrorText(error));
    return false;
  }
}

async function emit(options: MtFixItSubmitOptions | undefined, event: MtFixItLifecycleEvent) {
  if (!options?.onLifecycle) return;
  try { await options.onLifecycle(event); } catch (error) { console.warn(`[MtFixIt] lifecycle callback failed job=${event.jobId}:`, safeErrorText(error)); }
}

async function persistUnresolved(input: MtFixItSubmissionInput, evidence: DiagnosticEvidence, reason: string) {
  const id = `mtfix_local_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const record = { schemaVersion: 'dsh.mtfixit.unresolved/v2', id, createdAt: new Date().toISOString(), status: 'escalated', reason: safeErrorText(reason), report: input, diagnosticEvidence: evidence };
  for (const root of [String(process.env.MTFIXIT_DATA_DIR || '/data/mtfixit').trim(), '/tmp/dsh-mtfixit'].filter(Boolean)) {
    try {
      const dir = join(root, 'unresolved');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${id}.json`), JSON.stringify(record, null, 2), 'utf8');
      return { id, persisted: true };
    } catch (error) { console.error(`[MtFixIt] unresolved persistence failed root=${root}:`, safeErrorText(error)); }
  }
  return { id, persisted: false };
}

async function localEscalation(input: MtFixItSubmissionInput, evidence: DiagnosticEvidence, reason: string): Promise<MtFixItSubmissionResult> {
  const fallback = await persistUnresolved(input, evidence, reason);
  await notifyMtman(
    `MtFixIt was used by **${input.reporter}** with “${input.description.slice(0, 900)}”. Athena could not start the automatic repair, so report **${fallback.id}** needs mtman review.`,
    { fileName: `${fallback.id}.txt`, fileContent: JSON.stringify({ report: input, diagnosticEvidence: evidence, reason: safeErrorText(reason) }, null, 2).slice(0, 450_000) },
  );
  return { ok: true, jobId: fallback.id, dashboardUrl: `${rotatorBaseUrl()}/athena/coder`, disposition: 'escalated', persisted: fallback.persisted };
}

async function monitorJob(jobId: string, input: MtFixItSubmissionInput, options?: MtFixItSubmitOptions) {
  if (activeMonitors.has(jobId)) return;
  activeMonitors.add(jobId);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let reviewAnnounced = false;
  let knownDeployAnnounced = false;
  try {
    while (Date.now() < deadline) {
      await delay(POLL_INTERVAL_MS);
      const job = await readJob(jobId);
      if (job.status === 'queued' || job.status === 'running') continue;
      if (job.status === 'failed') {
        const report = jobReport(job, input);
        await notifyMtman(`Athena failed to produce a safe fix for **${input.reporter}**’s MtFixIt report. Job **${job.id}** needs review.`, { fileName: `${job.id}.txt`, fileContent: report });
        await emit(options, { jobId, outcome: 'failed', stage: 'failed', message: job.error || job.summary });
        return;
      }

      let resolution = await readResolution(jobId);
      if (!resolution || resolution.status === 'awaiting_analysis') resolution = await resolveMtFixIt(jobId);

      if (resolution.status === 'awaiting_approval') {
        if (!reviewAnnounced) {
          reviewAnnounced = true;
          await notifyMtman(
            `Athena found and validated a **new fix** for **${input.reporter}**’s report: “${input.description.slice(0, 800)}”\n\nApprove to merge/deploy it, or deny to hold it for further instructions. Job: **${jobId}**`,
            {
              fileName: `${jobId}.txt`,
              fileContent: jobReport(job, input, resolution),
              buttons: [
                { label: 'Approve & Deploy', customId: `mtfixit_approve:${jobId}`, style: 3 },
                { label: 'Deny / Hold', customId: `mtfixit_deny:${jobId}`, style: 4 },
              ],
            },
          );
          await emit(options, { jobId, outcome: 'waiting-review', stage: 'waiting-review', message: resolution.message });
        }
        continue;
      }

      if (resolution.status === 'deploying') {
        if (resolution.knownFix && !knownDeployAnnounced) {
          knownDeployAnnounced = true;
          await notifyMtman(`Athena matched **${input.reporter}**’s report to a previously approved successful fix. Job **${jobId}** is deploying automatically.`);
        }
        continue;
      }

      if (resolution.status === 'deployed') {
        await notifyMtman(`Fix applied for **${input.reporter}**’s MtFixIt report. Merge/deployment checks passed for job **${jobId}**${resolution.knownFix ? ' using a known fix.' : '; this successful approved repair is now recorded as a known fix.'}`);
        await emit(options, { jobId, outcome: 'fixed', stage: 'fixed', message: resolution.message });
        return;
      }

      if (resolution.status === 'denied') {
        await notifyMtman(`MtFixIt job **${jobId}** is on hold after deployment was denied. Athena will not merge it without further instruction.`);
        if (!reviewAnnounced) await emit(options, { jobId, outcome: 'waiting-review', stage: 'waiting-review', message: resolution.message });
        return;
      }

      if (resolution.status === 'no_change') {
        await notifyMtman(`Athena completed **${input.reporter}**’s MtFixIt report but found no safe code change to apply. Job **${jobId}** has the findings.`, { fileName: `${jobId}.txt`, fileContent: jobReport(job, input, resolution) });
        await emit(options, { jobId, outcome: 'no-change', stage: 'no-change', message: resolution.message });
        return;
      }

      if (resolution.status === 'failed') {
        await notifyMtman(`Athena found a repair path for **${input.reporter}**, but the apply/merge/deployment path failed for job **${jobId}**.`, { fileName: `${jobId}.txt`, fileContent: jobReport(job, input, resolution) });
        await emit(options, { jobId, outcome: 'failed', stage: 'failed', message: resolution.message });
        return;
      }
    }
    await notifyMtman(`MtFixIt job **${jobId}** exceeded the one-hour lifecycle monitor. The durable job remains available for mtman review.`);
    await emit(options, { jobId, outcome: 'failed', stage: 'failed', message: 'Lifecycle monitor timed out.' });
  } catch (error) {
    console.error(`[MtFixIt] monitor failed job=${jobId}:`, safeErrorText(error));
    await notifyMtman(`MtFixIt job **${jobId}** lost its live DSH monitor: ${safeErrorText(error)}. Durable rotator state remains available.`);
    await emit(options, { jobId, outcome: 'failed', stage: 'failed', message: safeErrorText(error) });
  } finally {
    activeMonitors.delete(jobId);
  }
}

export async function submitMtFixItOrchestrated(input: MtFixItSubmissionInput, options?: MtFixItSubmitOptions): Promise<MtFixItSubmissionResult> {
  const description = String(input.description || '').trim();
  if (!description) throw new Error('A problem description is required.');
  const normalizedInput = { ...input, description };
  const cooldownKey = `${input.source}:${input.reporterId}`;
  const lastSubmittedAt = reporterCooldowns.get(cooldownKey) || 0;
  if (Date.now() - lastSubmittedAt < REPORTER_COOLDOWN_MS) throw new Error('Please wait a minute before submitting another repair report.');
  reporterCooldowns.set(cooldownKey, Date.now());

  const evidence = await captureDiagnosticEvidence(normalizedInput);
  if (!sharedKey()) return localEscalation(normalizedInput, evidence, 'The DSH-to-rotator shared key is unavailable.');
  const baseRequest = buildMtFixItJobRequest(normalizedInput);
  try {
    const payload = await rotatorRequest('/api/dsh/mtfixit/jobs', {
      method: 'POST',
      body: JSON.stringify({ ...baseRequest, context: { ...baseRequest.context, diagnosticEvidence: evidence } }),
    });
    const job = payload?.job as RotatorJob | undefined;
    if (!job?.id) throw new Error('Rotator accepted no repair job.');
    const dashboardUrl = String(payload?.dashboardUrl || `${rotatorBaseUrl()}/athena/coder`);

    await notifyMtman(
      `MtFixIt was used by **${normalizedInput.reporter}** with “${normalizedInput.description.slice(0, 900)}”.\nAthena captured the ecosystem snapshot and has begun working the problem.\nJob: **${job.id}**`,
    );
    void monitorJob(job.id, normalizedInput, options);
    console.log(`[MtFixIt] orchestrated job=${job.id} source=${input.source} reporter=${input.reporterId}`);
    return { ok: true, jobId: job.id, dashboardUrl, disposition: 'submitted' };
  } catch (error) {
    console.error('[MtFixIt] orchestrated submission failed:', safeErrorText(error));
    return localEscalation(normalizedInput, evidence, safeErrorText(error));
  }
}
