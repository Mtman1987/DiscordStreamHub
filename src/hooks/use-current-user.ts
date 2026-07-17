'use client';

import { useState, useEffect } from 'react';
import { getRuntimeConfigClient } from '@/lib/runtime-config-client';

interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  isAdmin: boolean;
  isOwner: boolean;
  group?: string;
  roles?: string[];
  twitchLogin?: string;
}

let _cache: { key: string | null; user: CurrentUser | null; fetched: boolean } = { key: null, user: null, fetched: false };

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(_cache.user);
  const [isLoading, setIsLoading] = useState(!_cache.fetched);

  useEffect(() => {
    Promise.all([
      (async () => {
        const response = await fetch('/api/auth/spmt-session', { cache: 'no-store', credentials: 'include' }).catch(() => null);
        const data = response?.ok ? await response.json() : null;
        if (data?.success) return data;
        const userId = window.localStorage.getItem('discordUserId') || '';
        const serverId = window.localStorage.getItem('discordServerId') || '';
        if (!userId || !serverId) return null;
        const params = new URLSearchParams({ userId, serverId });
        const restoredResponse = await fetch(`/api/auth/restore-session?${params}`, { cache: 'no-store' }).catch(() => null);
        const restored = restoredResponse?.ok ? await restoredResponse.json() : null;
        if (!restored?.success || !restored?.userMatched || String(restored.discordUserId || restored.userId) !== userId) return null;
        return { success: true, session: { ...restored, discordServerId: restored.serverId || serverId, legacy: true } };
      })(),
      getRuntimeConfigClient(),
    ])
      .then(([sessionResponse, runtime]) => {
        const session = sessionResponse?.success ? sessionResponse.session : null;
        const userId = String(session?.discordUserId || session?.spmtUserId || '').trim();
        const serverId = String(session?.discordServerId || runtime?.publicIds?.hardcodedGuildId || '').trim();
        if (!userId || !serverId) {
          _cache = { key: null, user: null, fetched: true };
          setUser(null);
          setIsLoading(false);
          return null;
        }
        const displayName = String(session?.discordDisplayName || session?.discordUsername || session?.spmtUsername || userId);
        const hardcodedAdminId = runtime?.publicIds?.hardcodedAdminDiscordId || '';
        const cacheKey = `${serverId}:${userId}`;
        if (_cache.fetched && _cache.key === cacheKey) { setUser(_cache.user); setIsLoading(false); return null; }

        return Promise.all([
          fetch(`/api/db?path=servers/${serverId}/users/${userId}`).then(r => r.ok ? r.json() : null),
          fetch(`/api/db?path=servers/${serverId}`).then(r => r.ok ? r.json() : null),
          fetch('/api/admin/access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverId, userId }),
            cache: 'no-store',
          }).then(r => r.ok ? r.json() : null),
          Promise.resolve({ hardcodedAdminId, cacheKey, displayName, userId, legacy: session?.legacy === true }),
        ]);
      })
      .then((result) => {
        if (!result) return;
        const [data, serverData, roleAccess, context] = result as any;
        const { hardcodedAdminId, cacheKey, displayName, userId, legacy } = context;
        if (data?.exists && data.data) {
          const ownerRoleId = '1283213615939194955'; // 『👑』Owner
          const userRoles: string[] = data.data.roles || [];
          const adminRoles: string[] = Array.isArray(serverData?.data?.adminRoles) ? serverData.data.adminRoles : [];
          const roleNames: string[] = data.data.roleNames || [];
          const adminRoleSet = new Set(adminRoles.map(role => String(role).toLowerCase()));
          const ownerId = String(serverData?.data?.ownerId || '').trim();

          const isOwner = roleAccess?.isOwner === true || (!legacy && (
            userId === hardcodedAdminId ||
            userId === ownerId ||
            userRoles.includes(ownerRoleId)));

          // The live Discord member lookup is authoritative for configured mod
          // roles. This also keeps grandfathered sessions working without
          // trusting a stale isAdmin flag saved during an older sync.
          const isAdmin = roleAccess?.isAdmin === true || (!legacy && (
            data.data.isAdmin === true ||
            data.data.group === 'Crew' ||
            isOwner ||
            userRoles.some(role => adminRoleSet.has(String(role).toLowerCase())) ||
            roleNames.some(role => adminRoleSet.has(String(role).toLowerCase()))));

          const u: CurrentUser = {
            id: userId,
            username: data.data.username || displayName,
            displayName: data.data.displayName || data.data.username || displayName,
            avatarUrl: data.data.avatarUrl || undefined,
            isAdmin,
            isOwner,
            group: data.data.group,
            roles: userRoles,
            twitchLogin: data.data.twitchLogin,
          };
          _cache = { key: cacheKey, user: u, fetched: true };
          setUser(u);
        } else if (!legacy && userId === hardcodedAdminId) {
          const ownerUser: CurrentUser = { id: userId, username: displayName, displayName, isAdmin: true, isOwner: true, group: 'Crew' };
          _cache = { key: cacheKey, user: ownerUser, fetched: true };
          setUser(ownerUser);
        } else {
          const sessionUser: CurrentUser = {
            id: userId,
            username: displayName,
            displayName,
            isAdmin: false,
            isOwner: false,
          };
          _cache = { key: cacheKey, user: sessionUser, fetched: true };
          setUser(sessionUser);
        }
      })
      .catch(() => {
        // A failed authoritative lookup never grants local admin privileges.
        _cache = { key: null, user: null, fetched: true };
      })
      .finally(() => setIsLoading(false));
  }, []);

  return { user, isLoading, isAdmin: user?.isAdmin ?? false, isOwner: user?.isOwner ?? false };
}
