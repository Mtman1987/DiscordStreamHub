export type MtFixItSource = 'discord' | 'twitch';

export type MtFixItSubmissionInput = {
  source: MtFixItSource;
  reporter: string;
  reporterId: string;
  description: string;
  tenantId?: string;
  channelId?: string;
  channelName?: string;
  guildId?: string;
  messageId?: string;
};

export type MtFixItPublicOutcome =
  | 'accepted'
  | 'fixed'
  | 'waiting-review'
  | 'no-change'
  | 'failed'
  | 'usage';

export function parseMtFixItCommand(message: string): string | null {
  const match = String(message || '').trim().match(/^!mtfixit(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const description = String(match[1] || '').trim();
  if (description.length >= 2 && ((description.startsWith('"') && description.endsWith('"')) || (description.startsWith("'") && description.endsWith("'")))) {
    return description.slice(1, -1).trim();
  }
  return description;
}

function numericTwitchId(value: unknown): string {
  const normalized = String(value || '').trim();
  return /^\d{3,30}$/.test(normalized) ? normalized : '';
}

export function resolveTwitchMtFixItTenantId(roomId: unknown, linkedTwitchId: unknown): string | undefined {
  // Tenant identity remains useful report metadata, but MtFixIt diagnostic
  // capture itself is ecosystem-global through Commlink and does not require it.
  return numericTwitchId(roomId) || numericTwitchId(linkedTwitchId) || undefined;
}

export function buildMtFixItJobRequest(input: MtFixItSubmissionInput) {
  return {
    source: `dsh:${input.source}`,
    reporter: input.reporter,
    reporterId: input.reporterId,
    tenantId: input.tenantId,
    description: input.description.slice(0, 4000),
    context: {
      source: input.source,
      channelId: input.channelId || null,
      channelName: input.channelName || null,
      guildId: input.guildId || null,
      messageId: input.messageId || null,
    },
  };
}

export function mtFixItPublicReply(outcome: MtFixItPublicOutcome): string {
  if (outcome === 'accepted') {
    return 'Athena captured an ecosystem snapshot and has begun working on your report. I’ll message you back here with the outcome.';
  }
  if (outcome === 'fixed') {
    return 'Athena found the problem, applied the approved fix, and the deployment checks passed.';
  }
  if (outcome === 'waiting-review') {
    return 'Athena found and validated a possible fix. It is waiting for mtman review before deployment.';
  }
  if (outcome === 'no-change') {
    return 'Athena finished checking the report but did not find a safe code change to apply. The findings were sent to mtman.';
  }
  if (outcome === 'failed') {
    return 'Athena could not safely complete this repair. The report and findings were sent to mtman for review.';
  }
  return 'Please include the problem after `!mtfixit`, for example: `!mtfixit "I cannot tag people even though I am it"`.';
}
