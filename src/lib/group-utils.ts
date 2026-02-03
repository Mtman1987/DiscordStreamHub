type GroupValue = string | number | null | undefined;
type NormalizedGroup = 'vip' | 'community' | 'raid train' | 'raid pile';

const CANONICAL_LABELS: Record<NormalizedGroup, string> = {
  vip: 'VIP',
  community: 'Community',
  'raid train': 'Raid Train',
  'raid pile': 'Raid Pile',
};

const GROUP_SLUGS: Record<NormalizedGroup, string> = {
  vip: 'vip',
  community: 'community',
  'raid train': 'raid-train',
  'raid pile': 'raid-pile',
};

function normalizeGroupString(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function normalizeGroupValue(group: GroupValue): NormalizedGroup | null {
  if (typeof group === 'number') {
    if (group === 0) return 'vip';
    if (group === 1) return 'community';
  }

  if (typeof group === 'string') {
    const normalized = normalizeGroupString(group);
    if (!normalized) return null;

    if (normalized.startsWith('vip')) {
      return 'vip';
    }
    if (normalized.startsWith('community')) {
      return 'community';
    }
    if (normalized.startsWith('raid train') || normalized.startsWith('train')) {
      return 'raid train';
    }
    if (normalized.startsWith('raid pile') || normalized.startsWith('pile')) {
      return 'raid pile';
    }
  }

  return null;
}

export function toCanonicalGroup(group: GroupValue): string | null {
  const normalized = normalizeGroupValue(group);
  if (!normalized) {
    return typeof group === 'string' ? group : null;
  }
  return CANONICAL_LABELS[normalized];
}

export function groupSlugFromValue(group: GroupValue): string | null {
  const normalized = normalizeGroupValue(group);
  if (!normalized) return null;
  return GROUP_SLUGS[normalized];
}

export function slugToCanonicalGroup(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return toCanonicalGroup(slug);
}

export function matchesGroup(value: GroupValue, target: GroupValue): boolean {
  const normalizedValue = normalizeGroupValue(value);
  const normalizedTarget = normalizeGroupValue(target);
  if (!normalizedTarget) return false;
  return normalizedValue === normalizedTarget;
}

export function isVipGroup(group: GroupValue): boolean {
  return normalizeGroupValue(group) === 'vip';
}

export function isCommunityGroup(group: GroupValue): boolean {
  return normalizeGroupValue(group) === 'community';
}
