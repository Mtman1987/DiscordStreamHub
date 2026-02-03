'use client';

import * as React from 'react';
import { doc } from 'firebase/firestore';
import { useFirestore, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';

interface UserProfile {
  username: string;
  avatarUrl: string;
}

interface ServerInfo {
  serverName: string;
}

export function UserNav() {
  const firestore = useFirestore();
  const { user, isUserLoading } = useUser();
  const [userId, setUserId] = React.useState<string | null>(null);
  const [serverId, setServerId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setUserId(localStorage.getItem('discordUserId'));
    setServerId(localStorage.getItem('discordServerId'));
  }, []);

  const userProfileRef = useMemoFirebase(() => {
    if (isUserLoading || !firestore || !serverId || !userId || !user) return null;
    return doc(firestore, 'servers', serverId, 'users', userId);
  }, [firestore, serverId, userId, user, isUserLoading]);

  const serverInfoRef = useMemoFirebase(() => {
    if (!firestore || !serverId) return null;
    return doc(firestore, 'servers', serverId);
  }, [firestore, serverId]);

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

  const displayName = userProfile?.username || userId || 'Not logged in';
  const displayServer = serverInfo?.serverName || `Server ID: ${serverId}` || 'No server selected';

  return (
    <div className="flex items-center gap-3">
      <Avatar className="h-9 w-9">
        {userProfile?.avatarUrl && (
          <AvatarImage src={userProfile.avatarUrl} alt={displayName} />
        )}
        <AvatarFallback>{displayName.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="grid gap-0.5 text-sm group-data-[collapsed=true]:hidden">
        <div className="font-medium">{displayName}</div>
        <div className="text-muted-foreground">{displayServer}</div>
      </div>
    </div>
  );
}
