import { generateShoutout } from '@/ai/flows/generate-shoutout';
import { db } from '@/data/server-init';
import { isCommunityGroup } from '@/lib/group-utils';

export interface ShoutoutResult {
  streamerName: string;
  success: boolean;
  message: string;
}

type CommunityUser = {
  id: string;
  username?: string;
  displayName?: string;
  group?: string;
  isOnline?: boolean;
  dailyShoutout?: any;
};

type UserDocSnapshot = {
  id: string;
  data: () => Omit<CommunityUser, 'id'>;
};

export async function generateAllShoutouts(serverId: string): Promise<ShoutoutResult[]> {
  const usersSnapshot = await db
    .collection('servers')
    .doc(serverId)
    .collection('users')
    .get();

  const users = usersSnapshot.docs
    .map((doc: UserDocSnapshot) => ({ id: doc.id, ...doc.data() }))
    .filter((user: CommunityUser) => isCommunityGroup(user.group));
  const onlineUsers = users.filter((user: CommunityUser) => user.isOnline);

  if (onlineUsers.length === 0) {
    return [
      {
        streamerName: 'N/A',
        success: true,
        message: 'No online community members found to generate shoutouts for.',
      },
    ];
  }

  const results: ShoutoutResult[] = [];

  for (const user of onlineUsers) {
    const username = user.username || user.displayName || 'Unknown';

    try {
      const shoutout = await generateShoutout({ username });
      await db
        .collection('servers')
        .doc(serverId)
        .collection('users')
        .doc(user.id)
        .set(
          {
            dailyShoutout: {
              content: shoutout.shoutout,
              description: shoutout.shoutout,
              createdAt: new Date().toISOString(),
            },
            shoutoutGeneratedAt: new Date().toISOString(),
          },
          { merge: true },
        );

      results.push({
        streamerName: username,
        success: true,
        message: 'Shoutout generated successfully. Ready to post.',
      });
    } catch (error) {
      results.push({
        streamerName: username,
        success: false,
        message: error instanceof Error ? error.message : 'Failed to generate shoutout.',
      });
    }
  }

  return results;
}

