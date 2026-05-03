'use client';

import { useState, useEffect } from 'react';

interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  isAdmin: boolean;
  group?: string;
  roles?: string[];
  twitchLogin?: string;
}

let _cache: { user: CurrentUser | null; fetched: boolean } = { user: null, fetched: false };

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(_cache.user);
  const [isLoading, setIsLoading] = useState(!_cache.fetched);

  useEffect(() => {
    if (_cache.fetched) { setUser(_cache.user); setIsLoading(false); return; }

    const userId = localStorage.getItem('discordUserId');
    const serverId = localStorage.getItem('discordServerId') || process.env.NEXT_PUBLIC_HARDCODED_GUILD_ID || '1240832965865635881';
    const hardcodedAdminId = process.env.NEXT_PUBLIC_HARDCODED_ADMIN_DISCORD_ID || '767875979561009173';
    if (!userId) { setIsLoading(false); _cache.fetched = true; return; }

    // Hardcoded admin always gets in, even if DB is down
    const fallbackAdmin: CurrentUser = {
      id: userId,
      username: 'Admin',
      displayName: 'Admin',
      isAdmin: true,
      group: 'Crew',
    };

    fetch(`/api/db?path=servers/${serverId}/users/${userId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.exists && data.data) {
          const ownerRoleId = '1283213615939194955'; // 『👑』Owner
          const userRoles: string[] = data.data.roles || [];

          const isAdmin = 
            data.data.isAdmin === true ||
            data.data.group === 'Crew' ||
            userId === hardcodedAdminId ||
            userRoles.includes(ownerRoleId);

          const u: CurrentUser = {
            id: userId,
            username: data.data.username || userId,
            displayName: data.data.displayName || data.data.username || userId,
            avatarUrl: data.data.avatarUrl,
            isAdmin,
            group: data.data.group,
            roles: userRoles,
            twitchLogin: data.data.twitchLogin,
          };
          _cache = { user: u, fetched: true };
          setUser(u);
        } else if (userId === hardcodedAdminId) {
          _cache = { user: fallbackAdmin, fetched: true };
          setUser(fallbackAdmin);
        } else {
          _cache = { user: null, fetched: true };
        }
      })
      .catch(() => {
        // DB unreachable — still let hardcoded admin in
        if (userId === hardcodedAdminId) {
          _cache = { user: fallbackAdmin, fetched: true };
          setUser(fallbackAdmin);
        } else {
          _cache = { user: null, fetched: true };
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  return { user, isLoading, isAdmin: user?.isAdmin ?? false };
}
