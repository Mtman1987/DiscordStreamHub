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

export function parseMtFixItCommand(message: string): string | null {
  const match = String(message || '').trim().match(/^!mtfixit(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  return String(match[1] || '').trim();
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

export function mtFixItPublicReply(outcome: 'accepted' | 'usage' | 'failed'): string {
  if (outcome === 'accepted') {
    return 'Athena Coder accepted the report. The owner will receive the private engineering details for review.';
  }
  if (outcome === 'usage') {
    return 'Please include the problem after `!mtfixit`, for example: `!mtfixit leaderboard image generation is timing out`.';
  }
  return 'Athena Coder could not accept that report right now. The owner has been notified through service logs.';
}
