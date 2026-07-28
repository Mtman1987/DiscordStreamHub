'use client';

import * as React from 'react';
import { doc } from '@/lib/data-shim';
import { useDataStore, useMemoData, useUser, useDoc } from '@/data';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';

interface UserProfile {
  username: string;
  displayName?: string;
  avatarUrl: string;
}

interface ServerInfo {
  serverName: string;
}

export function UserNav() {
  const store = useDataStore();
  const { user, isUserLoading } = useUser();
  const [userId, setUserId] = React.useState<string | null>(null);
  const [serverId, setServerId] = React.useState<string | null>(null);
  const [localDisplayName, setLocalDisplayName] = React.useState('');
  const [localAvatar, setLocalAvatar] = React.useState('');
  const [localServerName, setLocalServerName] = React.useState('');
  const [canonicalXp, setCanonicalXp] = React.useState<{ xp: number; level: number } | null>(null);

  const refreshLocalSession = React.useCallback(() => {
    setUserId(localStorage.getItem('discordUserId'));
    setServerId(localStorage.getItem('discordServerId'));
    setLocalDisplayName(localStorage.getItem('discordDisplayName') || localStorage.getItem('discordUsername') || '');
    setLocalAvatar(localStorage.getItem('discordAvatar') || '');
    setLocalServerName(localStorage.getItem('serverName') || '');
  }, []);

  React.useEffect(() => {
    refreshLocalSession();
    window.addEventListener('dsh-session-restored', refreshLocalSession);
    return () => window.removeEventListener('dsh-session-restored', refreshLocalSession);
  }, [refreshLocalSession]);

  React.useEffect(() => {
    let cancelled = false;

    async function refreshCanonicalXp() {
      const response = await fetch('/api/spmt/xp', {
        credentials: 'same-origin',
        cache: 'no-store',
      }).catch(() => null);
      const payload = response?.ok ? await response.json().catch(() => null) : null;
      const xp = Number(payload?.xp);
      const level = Number(payload?.level);
      if (cancelled || !Number.isFinite(xp) || !Number.isFinite(level)) return;
      setCanonicalXp({
        xp: Math.max(0, Math.trunc(xp)),
        level: Math.max(1, Math.trunc(level)),
      });
    }

    void refreshCanonicalXp();
    window.addEventListener('dsh-session-restored', refreshCanonicalXp);
    return () => {
      cancelled = true;
      window.removeEventListener('dsh-session-restored', refreshCanonicalXp);
    };
  }, []);

  const handleLogout = React.useCallback(async () => {
    await fetch('/api/auth/spmt-session', {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => null);
    [
      'discordServerId',
      'discordUserId',
      'discordUsername',
      'discordDisplayName',
      'discordAvatar',
      'twitchUsername',
      'serverName',
      'serverIconUrl',
      'isAdmin',
      'isLoggedIn',
      'spmtToken',
      'spmtUserId',
      'spmtUsername',
      'dshAuthMode',
    ].forEach((key) => localStorage.removeItem(key));
    const loginUrl = `${window.location.origin}/login?loggedOut=1`;
    if (window.parent !== window) {
      window.open(loginUrl, '_blank', 'noopener,noreferrer');
      window.location.replace('/logged-out');
      return;
    }
    window.location.replace(loginUrl);
  }, []);

  const userProfileRef = useMemoData(() => {
    if (isUserLoading || !store || !serverId || !userId || !user) return null;
    return doc(store, 'servers', serverId, 'users', userId);
  }, [store, serverId, userId, user, isUserLoading]);

  const serverInfoRef = useMemoData(() => {
    if (!store || !serverId) return null;
    return doc(store, 'servers', serverId);
  }, [store, serverId]);

  const { data: userProfile, isLoading: isUserLoadingProfile } = useDoc<UserProfile>(userProfileRef);
  const { data: serverInfo, isLoading: isServerLoading } = useDoc<ServerInfo>(serverInfoRef);
  
  const isLoading = isUserLoading || isUserLoadingProfile || isServerLoading;

  if (isLoading) {
    return (
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="grid gap-1 group-data-[collapsed=true]:hidden">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    );
  }

  const displayName = userProfile?.displayName || userProfile?.username || localDisplayName || userId || 'Not logged in';
  const avatarUrl = userProfile?.avatarUrl || localAvatar;
  const displayServer = serverInfo?.serverName || localServerName || (serverId ? `Server ID: ${serverId}` : 'No server selected');

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="h-9 w-9">
          {avatarUrl && (
            <AvatarImage src={avatarUrl} alt={displayName} />
          )}
          <AvatarFallback>{displayName.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="grid min-w-0 gap-0.5 text-sm group-data-[collapsed=true]:hidden">
          <div className="truncate font-medium">{displayName}</div>
          <div className="truncate text-muted-foreground">{displayServer}</div>
          {canonicalXp && (
            <div className="truncate text-xs text-muted-foreground">
              LVL {canonicalXp.level} · {canonicalXp.xp.toLocaleString()} XP
            </div>
          )}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleLogout}
        title="Log out of Discord Stream Hub"
        className="h-8 w-8 shrink-0 group-data-[collapsed=true]:hidden"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
