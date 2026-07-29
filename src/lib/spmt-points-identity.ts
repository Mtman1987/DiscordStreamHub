export type SpmtPointsIdentity =
  | {
      provider: 'twitch';
      providerUserId: string;
      providerUsername: string;
    }
  | {
      provider: 'discord';
      providerUserId: string;
      providerUsername: string;
    };

function text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}

export function resolveTwitchPointsIdentity(input: {
  sourceUserId: string;
  fallbackUsername: string;
  metadata?: Record<string, unknown>;
  linkedUser?: Record<string, unknown>;
  linkedUserExists: boolean;
}): SpmtPointsIdentity | null {
  const metadata = input.metadata || {};
  const linkedUser = input.linkedUser || {};
  const twitchId = text(metadata.twitchId) || text(linkedUser.twitchId);
  const twitchUsername = (
    text(metadata.twitchLogin)
    || text(metadata.username)
    || text(linkedUser.twitchLogin)
    || text(input.fallbackUsername)
  ).toLowerCase();

  // sourceUserId is the DSH/Discord document key. It must never be treated as
  // a Twitch user ID merely because both providers use numeric identifiers.
  if (/^\d+$/.test(twitchId) && twitchUsername) {
    return {
      provider: 'twitch',
      providerUserId: twitchId,
      providerUsername: twitchUsername,
    };
  }

  if (input.linkedUserExists) {
    return {
      provider: 'discord',
      providerUserId: text(input.sourceUserId),
      providerUsername: text(input.fallbackUsername) || text(input.sourceUserId),
    };
  }

  return null;
}
