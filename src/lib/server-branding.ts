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

    const serverData = serverDoc.exists ? serverDoc.data() || {} : {};
    const compatibleServerData = serverId === getHardcodedGuildId()
      ? { serverName: SPACE_MOUNTAIN_DEFAULTS.serverName, ...serverData }
      : serverData;

    return resolveServerBranding(
      serverId,
      compatibleServerData,
      brandingDoc.exists ? brandingDoc.data() || {} : {},
    );
  } catch (error) {
    console.error('Error fetching server branding:', error);
    return resolveServerBranding(
      serverId,
      serverId === getHardcodedGuildId() ? { serverName: SPACE_MOUNTAIN_DEFAULTS.serverName } : {},
    );
  }
}

export function getDefaultBranding(): ServerBranding {
  return SPACE_MOUNTAIN_DEFAULTS;
}
