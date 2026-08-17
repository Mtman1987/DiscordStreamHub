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

export type MtFixItPublicOutcome = 'accepted' | 'analysis' | 'escalated' | 'usage' | 'failed';

export function parseMtFixItCommand(message: string): string | null {
  const match = String(message || '').trim().match(/^!mtfixit(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  return String(match[1] || '').trim();
}

function numericTwitchId(value: unknown): string {
  const normalized = String(value || '').trim();
  return /^\d{3,30}$/.test(normalized) ? normalized : '';
}

export function resolveTwitchMtFixItTenantId(roomId: unknown, linkedTwitchId: unknown): string | undefined {
  // StreamWeaver tenant storage is keyed by Twitch broadcaster ID. Twitch IRC's
  // room-id is authoritative for the channel receiving the command; the linked
  // DSH user record is a fallback for clients that omit that tag.
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
    return 'Athena received the report and is checking a tenant-scoped diagnostic snapshot now. If the repair still needs help, I’ll send it to mtman.';
  }
  if (outcome === 'analysis') {
    return 'Athena finished the diagnostic pass and produced repair findings for review. The remaining work has been sent to mtman.';
  }
  if (outcome === 'escalated') {
    return 'Athena received the report but could not complete the automatic repair. It has been queued for mtman.';
  }
  if (outcome === 'usage') {
    return 'Please include the problem after `!mtfixit`, for example: `!mtfixit leaderboard image generation is timing out`.';
  }
  return 'Athena received the report, but the automatic repair path is temporarily unavailable. The report is being kept for follow-up.';
}
