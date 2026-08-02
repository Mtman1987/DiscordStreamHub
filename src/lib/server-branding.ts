import { db } from '@/data/server-init';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import {
  resolveServerBranding,
  SPACE_MOUNTAIN_DEFAULTS,
  type ServerBranding,
} from '@/lib/tenant-utils';

export type { ServerBranding } from '@/lib/tenant-utils';

export async function getServerBranding(serverId: string): Promise<ServerBranding> {
  try {
    const serverRef = db.collection('servers').doc(serverId);
    const [serverDoc, brandingDoc] = await Promise.all([
      serverRef.get(),
      serverRef.collection('config').doc('branding').get(),
    ]);

    return resolveServerBranding(
      serverId,
      serverDoc.exists ? serverDoc.data() || {} : {},
      brandingDoc.exists ? brandingDoc.data() || {} : {},
      serverId === getHardcodedGuildId() ? SPACE_MOUNTAIN_DEFAULTS.serverName : '',
    );
  } catch (error) {
    console.error('Error fetching server branding:', error);
    return resolveServerBranding(
      serverId,
      {},
      {},
      serverId === getHardcodedGuildId() ? SPACE_MOUNTAIN_DEFAULTS.serverName : '',
    );
  }
}

export function getDefaultBranding(): ServerBranding {
  return SPACE_MOUNTAIN_DEFAULTS;
}
