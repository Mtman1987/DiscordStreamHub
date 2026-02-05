import { doc, getDoc } from 'firebase/firestore';
import { getFirestore } from '@/firebase/client-app';

export interface ServerBranding {
  serverName: string;
  communityMemberName: string;
  communityMemberNamePlural: string;
}

const SPACE_MOUNTAIN_DEFAULTS: ServerBranding = {
  serverName: 'Space Mountain',
  communityMemberName: 'Mountaineer',
  communityMemberNamePlural: 'Mountaineers'
};

export async function getServerBranding(serverId: string): Promise<ServerBranding> {
  try {
    const firestore = getFirestore();
    const brandingRef = doc(firestore, 'servers', serverId, 'config', 'branding');
    const brandingDoc = await getDoc(brandingRef);
    
    if (brandingDoc.exists()) {
      return { ...SPACE_MOUNTAIN_DEFAULTS, ...brandingDoc.data() };
    }
    
    return SPACE_MOUNTAIN_DEFAULTS;
  } catch (error) {
    console.error('Error fetching server branding:', error);
    return SPACE_MOUNTAIN_DEFAULTS;
  }
}

export function getDefaultBranding(): ServerBranding {
  return SPACE_MOUNTAIN_DEFAULTS;
}
