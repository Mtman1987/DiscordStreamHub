'use client';

import { useState, useEffect } from 'react';
import { getRuntimeConfigClient } from '@/lib/runtime-config-client';

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

let _cache: { key: string | null; user: CurrentUser | null; fetched: boolean } = { key: null, user: null, fetched: false };

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(_cache.user);
  const [isLoading, setIsLoading] = useState(!_cache.fetched);

  useEffect(() => {
    const userId = localStorage.getItem('discordUserId');
    if (!userId) { setIsLoading(false); _cache = { key: null, user: null, fetched: true }; return; }

    const localDisplayName = localStorage.getItem('discordDisplayName') || localStorage.getItem('discordUsername') || userId;
    const localAvatar = localStorage.getItem('discordAvatar') || undefined;

    getRuntimeConfigClient()
      .then((runtime) => {
        const serverId = localStorage.getItem('discordServerId') || runtime?.publicIds?.hardcodedGuildId || '';
        const hardcodedAdminId = runtime?.publicIds?.hardcodedAdminDiscordId || '';
        if (!serverId) {
          _cache = { key: null, user: null, fetched: true };
          setUser(null);
          setIsLoading(false);
          return null;
        }
        const cacheKey = `${serverId}:${userId}`;
        if (_cache.fetched && _cache.key === cacheKey) { setUser(_cache.user); setIsLoading(false); return null; }

        const fallbackAdmin: CurrentUser = {
          id: userId,
          username: localDisplayName,
          displayName: localDisplayName,
          avatarUrl: localAvatar,
          isAdmin: true,
          group: 'Crew',
        };

        return Promise.all([
          fetch(`/api/db?path=servers/${serverId}/users/${userId}`).then(r => r.ok ? r.json() : null),
          fetch(`/api/db?path=servers/${serverId}`).then(r => r.ok ? r.json() : null),
          Promise.resolve({ serverId, hardcodedAdminId, cacheKey, fallbackAdmin }),
        ]);
      })
      .then((result) => {
        if (!result) return;
        const [data, serverData, context] = result as any;
        const { hardcodedAdminId, cacheKey, fallbackAdmin } = context;
        if (data?.exists && data.data) {
          const ownerRoleId = '1283213615939194955'; // 『👑』Owner
          const userRoles: string[] = data.data.roles || [];
          const adminRoles: string[] = Array.isArray(serverData?.data?.adminRoles) ? serverData.data.adminRoles : [];
          const roleNames: string[] = data.data.roleNames || [];
          const adminRoleSet = new Set(adminRoles.map(role => String(role).toLowerCase()));

          const isAdmin = 
            data.data.isAdmin === true ||
            data.data.group === 'Crew' ||
            userId === hardcodedAdminId ||
            userRoles.includes(ownerRoleId) ||
            userRoles.some(role => adminRoleSet.has(String(role).toLowerCase())) ||
            roleNames.some(role => adminRoleSet.has(String(role).toLowerCase()));

          const u: CurrentUser = {
            id: userId,
            username: data.data.username || localDisplayName,
            displayName: data.data.displayName || data.data.username || localDisplayName,
            avatarUrl: data.data.avatarUrl || localAvatar,
            isAdmin,
            group: data.data.group,
            roles: userRoles,
            twitchLogin: data.data.twitchLogin,
          };
          _cache = { key: cacheKey, user: u, fetched: true };
          setUser(u);
        } else if (userId === hardcodedAdminId) {
          _cache = { key: cacheKey, user: fallbackAdmin, fetched: true };
          setUser(fallbackAdmin);
        } else {
          const localUser: CurrentUser = {
            id: userId,
            username: localDisplayName,
            displayName: localDisplayName,
            avatarUrl: localAvatar,
            isAdmin: localStorage.getItem('isAdmin') === 'true',
            group: localStorage.getItem('isAdmin') === 'true' ? 'Crew' : undefined,
          };
          _cache = { key: cacheKey, user: localUser, fetched: true };
          setUser(localUser);
        }
      })
      .catch(() => {
        // DB unreachable — still let hardcoded admin in
        _cache = { key: null, user: null, fetched: true };
      })
      .finally(() => setIsLoading(false));
  }, []);

  return { user, isLoading, isAdmin: user?.isAdmin ?? false };
}
