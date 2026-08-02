export interface ServerBranding {
  serverName: string;
  communityMemberName: string;
  communityMemberNamePlural: string;
}

export const SPACE_MOUNTAIN_DEFAULTS: ServerBranding = {
  serverName: 'Space Mountain',
  communityMemberName: 'Mountaineer',
  communityMemberNamePlural: 'Mountaineers',
};

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveServerBranding(
  serverId: string,
  serverData: Record<string, unknown> = {},
  brandingData: Record<string, unknown> = {},
  defaultServerName = '',
): ServerBranding {
  const rootServerName = textValue(serverData.serverName)
    || textValue(serverData.name)
    || textValue(serverData.twitchChannel);

  return {
    serverName: textValue(brandingData.serverName)
      || rootServerName
      || textValue(defaultServerName)
      || textValue(serverId)
      || SPACE_MOUNTAIN_DEFAULTS.serverName,
    communityMemberName: textValue(brandingData.communityMemberName)
      || SPACE_MOUNTAIN_DEFAULTS.communityMemberName,
    communityMemberNamePlural: textValue(brandingData.communityMemberNamePlural)
      || SPACE_MOUNTAIN_DEFAULTS.communityMemberNamePlural,
  };
}

export function discoverDirectChildIds(
  collectionPath: string,
  documentPaths: Iterable<string>,
): string[] {
  const normalizedCollection = collectionPath.split('/').filter(Boolean).join('/');
  const prefix = normalizedCollection ? `${normalizedCollection}/` : '';
  const ids = new Set<string>();

  if (!prefix) return [];

  for (const path of documentPaths) {
    const normalizedPath = String(path || '').split('/').filter(Boolean).join('/');
    if (!normalizedPath.startsWith(prefix)) continue;
    const childId = normalizedPath.slice(prefix.length).split('/')[0]?.trim();
    if (childId) ids.add(childId);
  }

  return [...ids].sort();
}

export function resolveTenantBalance(
  canonical: { currentPoints: number; lifetimePoints: number; rank: number | null } | null,
  legacyPoints: number,
  legacyRank: number | null,
) {
  if (canonical) {
    return {
      currentPoints: Number(canonical.currentPoints || 0),
      lifetimePoints: Number(canonical.lifetimePoints || 0),
      rank: canonical.rank,
      source: 'spmt' as const,
    };
  }

  const points = Number(legacyPoints || 0);
  return {
    currentPoints: points,
    lifetimePoints: points,
    rank: legacyRank,
    source: 'legacy' as const,
  };
}
