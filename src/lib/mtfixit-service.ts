import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildMtFixItJobRequest, type MtFixItSubmissionInput } from './mtfixit-contract';
import { captureCommlinkDiagnosticSnapshot, type CommlinkDiagnosticSnapshot } from './mtfixit-commlink';
import { sendOwnerDiscordDm } from './owner-dm-service';

const DEFAULT_ROTATOR_URL = 'https://mtman-machine-rotator.fly.dev';
const REPORTER_COOLDOWN_MS = 60_000;
const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS = 45 * 60_000;
const MAX_SNAPSHOT_TEXT = 120_000;

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

type DiagnosticEvidence = {
  schemaVersion: 'dsh.mtfixit.snapshot/v1';
  capturedAt: string;
  scope: {
    tenantId: string | null;
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

export type MtFixItFinalEvent = {
  jobId: string;
  outcome: 'analysis' | 'escalated';
  status: 'completed' | 'failed' | 'timeout' | 'monitor-error';
};

export type MtFixItSubmitOptions = {
  onFinal?: (event: MtFixItFinalEvent) => void | Promise<void>;
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
  return String(process.env.ROTATOR_BASE_URL || process.env.CODEX_WORKER_URL || DEFAULT_ROTATOR_URL)
    .trim()
    .replace(/\/$/, '');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanAthenaWording(value: unknown): string {
  return String(value ?? '').replace(/Athena\s+Coder/gi, 'Athena');
}

function safeErrorText(error: unknown): string {
  return cleanAthenaWording(error instanceof Error ? error.message : String(error || 'unknown error'))
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-|github_pat_)[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/([?&](?:token|secret|key|api_key)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, 800);
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
    const response = await fetch(endpoint, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    const raw = redactSnapshotText(await response.text());
    if (!response.ok) throw new Error(`ecosystem snapshot HTTP ${response.status}`);
    ecosystemSnapshot = {
      status: 'captured',
      endpoint,
      snapshotJson: raw.slice(0, MAX_SNAPSHOT_TEXT),
      truncated: raw.length > MAX_SNAPSHOT_TEXT,
    };
  } catch (error) {
    ecosystemSnapshot = { status: 'unavailable', endpoint, error: safeErrorText(error) };
  }

  const commlinkSnapshot = await captureCommlinkDiagnosticSnapshot({
    serviceKey: sharedKey(),
    capturedAt,
    source: input.source,
  });

  return {
    schemaVersion: 'dsh.mtfixit.snapshot/v1',
    capturedAt,
    scope: {
      tenantId: input.tenantId || null,
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
      commlinkGlobal: {
        status: commlinkSnapshot.status === 'captured' ? 'captured' : 'unavailable',
        note: 'Global Commlink incident-window evidence across ecosystem apps and systems; tenant ID is not required for capture.',
      },
      appRuntimeLogs: { status: 'pending-adapter', note: 'Per-app runtime log ingestion remains a separate redacted diagnostic source.' },
      rotatorRepairHistory: { status: 'pending-adapter', note: 'The repair job itself records Athena findings, changed files, checks, and failures.' },
    },
  };
}

function jobReport(job: RotatorJob, input: MtFixItSubmissionInput): string {
  const checks = (job.checks || [])
    .map((check) => `${check.ok ? 'PASS' : 'FAIL'} ${check.command}${check.output ? `\n${cleanAthenaWording(check.output).slice(-2000)}` : ''}`)
    .join('\n\n');
  return [
    `Athena repair job: ${job.id}`,
    `Status: ${job.status}`,
    `Source: ${input.source}`,
    `Tenant: ${input.tenantId || 'unknown'}`,
    `Reporter: ${input.reporter} (${input.reporterId})`,
    `Channel: ${input.channelName || input.channelId || 'unknown'}`,
    `Repository: ${job.repoId || job.appName || 'inferred by rotator'}`,
    '',
    'Problem:',
    input.description,
    '',
    'Athena response:',
    cleanAthenaWording(job.summary || job.error || 'No response was recorded.'),
    '',
    'Changed files:',
    (job.changedFiles || []).length ? (job.changedFiles || []).join('\n') : 'None',
    '',
    'Checks:',
    checks || 'No checks were recorded.',
    '',
    job.pullRequest ? `Draft PR: ${job.pullRequest.url}` : 'Draft PR: not published; mtman review remains required.',
  ].join('\n');
}

async function notifyMtman(message: string, fileName?: string, fileContent?: string): Promise<boolean> {
  try {
    await sendOwnerDiscordDm({ message, fileName, fileContent });
    return true;
  } catch (error) {
    console.error('[MtFixIt] mtman DM delivery failed:', safeErrorText(error));
    return false;
  }
}

async function emitFinal(options: MtFixItSubmitOptions | undefined, event: MtFixItFinalEvent) {
  if (!options?.onFinal) return;
  try {
    await options.onFinal(event);
  } catch (error) {
    console.warn(`[MtFixIt] final public reply failed job=${event.jobId}:`, safeErrorText(error));
  }
}

async function persistUnresolved(input: MtFixItSubmissionInput, evidence: DiagnosticEvidence, reason: string) {
  const id = `mtfix_local_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const record = {
    schemaVersion: 'dsh.mtfixit.unresolved/v1',
    id,
    createdAt: new Date().toISOString(),
    status: 'escalated',
    reason: safeErrorText(reason),
    report: input,
    diagnosticEvidence: evidence,
  };
  const roots = [
    String(process.env.MTFIXIT_DATA_DIR || '/data/mtfixit').trim(),
    '/tmp/dsh-mtfixit',
  ].filter(Boolean);
  for (const root of roots) {
    try {
      const dir = join(root, 'unresolved');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${id}.json`), JSON.stringify(record, null, 2), 'utf8');
      console.warn(`[MtFixIt] unresolved report persisted id=${id} root=${root}`);
      return { id, persisted: true };
    } catch (error) {
      console.error(`[MtFixIt] unresolved persistence failed root=${root}:`, safeErrorText(error));
    }
  }
  return { id, persisted: false };
}

async function escalateLocally(input: MtFixItSubmissionInput, evidence: DiagnosticEvidence, reason: string): Promise<MtFixItSubmissionResult> {
  const fallback = await persistUnresolved(input, evidence, reason);
  const report = [
    `MtFixIt fallback report: ${fallback.id}`,
    `Tenant: ${input.tenantId || 'unknown'}`,
    `Source: ${input.source}`,
    `Reporter: ${input.reporter} (${input.reporterId})`,
    `Channel: ${input.channelName || input.channelId || 'unknown'}`,
    `Reason: ${safeErrorText(reason)}`,
    '',
    'Problem:',
    input.description,
    '',
    'Diagnostic snapshot:',
    JSON.stringify(evidence, null, 2).slice(0, 300_000),
  ].join('\n');
  await notifyMtman(
    `MtFixIt could not start the automatic Athena repair. Fallback report **${fallback.id}** is ${fallback.persisted ? 'saved' : 'in-memory only'} and needs mtman review.`,
    `${fallback.id}.txt`,
    report,
  );
  return {
    ok: true,
    jobId: fallback.id,
    dashboardUrl: `${rotatorBaseUrl()}/athena`,
    disposition: 'escalated',
    persisted: fallback.persisted,
  };
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
    throw new Error(`Rotator job read failed: ${response.status}`);
  }
  return payload as RotatorJob;
}

async function monitorJob(jobId: string, input: MtFixItSubmissionInput, options?: MtFixItSubmitOptions) {
  if (activeMonitors.has(jobId)) return;
  activeMonitors.add(jobId);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      await delay(POLL_INTERVAL_MS);
      const job = await readJob(jobId);
      if (job.status !== 'completed' && job.status !== 'failed') continue;
      const report = jobReport(job, input);
      if (job.status === 'completed') {
        await notifyMtman(
          `Athena finished diagnostic job **${job.id}**. The generated findings/patch still require mtman review before merge or deployment.`,
          `${job.id}.txt`,
          report,
        );
        console.log(`[MtFixIt] completion job=${job.id} status=completed escalation=mtman-review`);
        await emitFinal(options, { jobId: job.id, outcome: 'analysis', status: 'completed' });
      } else {
        await notifyMtman(
          `Athena could not complete repair job **${job.id}**. It needs mtman review.`,
          `${job.id}.txt`,
          report,
        );
        console.warn(`[MtFixIt] completion job=${job.id} status=failed escalation=mtman`);
        await emitFinal(options, { jobId: job.id, outcome: 'escalated', status: 'failed' });
      }
      return;
    }
    await notifyMtman(`Athena repair job **${jobId}** did not finish inside the 45-minute monitor window. It needs mtman review.`);
    console.warn(`[MtFixIt] monitor timeout job=${jobId}`);
    await emitFinal(options, { jobId, outcome: 'escalated', status: 'timeout' });
  } catch (error) {
    console.error(`[MtFixIt] monitor failed job=${jobId}:`, safeErrorText(error));
    await notifyMtman(`Athena accepted repair job **${jobId}**, but DSH lost the status monitor. It needs mtman review.`);
    await emitFinal(options, { jobId, outcome: 'escalated', status: 'monitor-error' });
  } finally {
    activeMonitors.delete(jobId);
  }
}

export async function submitMtFixIt(input: MtFixItSubmissionInput, options?: MtFixItSubmitOptions): Promise<MtFixItSubmissionResult> {
  const description = String(input.description || '').trim();
  if (!description) throw new Error('A problem description is required.');

  const normalizedInput = { ...input, description };
  const cooldownKey = `${input.source}:${input.reporterId}`;
  const lastSubmittedAt = reporterCooldowns.get(cooldownKey) || 0;
  if (Date.now() - lastSubmittedAt < REPORTER_COOLDOWN_MS) {
    throw new Error('Please wait a minute before submitting another repair report.');
  }
  reporterCooldowns.set(cooldownKey, Date.now());

  const evidence = await captureDiagnosticEvidence(normalizedInput);
  const key = sharedKey();
  if (!key) {
    return escalateLocally(normalizedInput, evidence, 'The DSH-to-rotator shared key is unavailable.');
  }

  const baseRequest = buildMtFixItJobRequest(normalizedInput);
  const requestBody = {
    ...baseRequest,
    context: {
      ...baseRequest.context,
      diagnosticEvidence: evidence,
    },
  };

  try {
    const response = await fetch(`${rotatorBaseUrl()}/api/dsh/mtfixit/jobs`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-dsh-mtfixit-key': key,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => null);
    const job = payload?.job as RotatorJob | undefined;
    if (!response.ok || !job?.id) {
      throw new Error(`Rotator rejected the report with HTTP ${response.status}.`);
    }

    const dashboardUrl = String(payload?.dashboardUrl || `${rotatorBaseUrl()}/athena`);
    void monitorJob(job.id, normalizedInput, options);
    console.log(`[MtFixIt] accepted job=${job.id} source=${input.source} tenant=${input.tenantId || 'unknown'} reporter=${input.reporterId}`);
    return { ok: true, jobId: job.id, dashboardUrl, disposition: 'submitted' };
  } catch (error) {
    console.error('[MtFixIt] automatic submission failed; using local escalation:', safeErrorText(error));
    return escalateLocally(normalizedInput, evidence, safeErrorText(error));
  }
}
