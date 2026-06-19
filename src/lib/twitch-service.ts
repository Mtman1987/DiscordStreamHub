'use server';

import { getClipsForUser, getUserByLogin } from './twitch-api-service';

export async function getTwitchClips(login: string, limit: number = 1) {
  const user = await getUserByLogin(login);
  if (!user) {
    return [];
  }

  return getClipsForUser(user.id, limit);
}
