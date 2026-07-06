'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

const spmtBaseUrl = 'https://spmt.live';

function readDiscordId(user: any) {
  const linkedAccounts = user?.linkedAccounts || user?.linked_accounts || {};
  const discord = linkedAccounts.discord || user?.discord || {};
  return String(user?.discordUserId || user?.discord_user_id || user?.discordId || user?.discord_id || discord.id || discord.userId || '').trim();
}

function readTwitchUsername(user: any) {
  const linkedAccounts = user?.linkedAccounts || user?.linked_accounts || {};
  const twitch = linkedAccounts.twitch || user?.twitch || {};
  return String(user?.twitchUsername || user?.twitchLogin || user?.twitch_login || twitch.username || twitch.login || '').trim();
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = React.useState('Completing SPMT sign in...');

  React.useEffect(() => {
    let cancelled = false;

    async function completeLogin() {
      const searchParams = new URLSearchParams(window.location.search);
      const token = searchParams.get('auth_code') || searchParams.get('token') || searchParams.get('code') || '';
      const next = searchParams.get('next') || '/dashboard';

      if (!token) {
        setMessage('Missing SPMT sign-in token. Return to login and try again.');
        return;
      }

      try {
        const refreshResponse = await fetch(`${spmtBaseUrl}/api/auth/refresh`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        });
        const profileResponse = refreshResponse.ok
          ? refreshResponse
          : await fetch(`${spmtBaseUrl}/api/me`, {
              headers: { Authorization: `Bearer ${token}` },
              credentials: 'include',
            });

        if (!profileResponse.ok) {
          throw new Error('SPMT profile lookup failed');
        }

        const data = await profileResponse.json();
        const user = data.user || data.profile || data;
        const nextToken = data.token || token;
        const discordUserId = readDiscordId(user);
        const twitchUsername = readTwitchUsername(user);
        const discordUsername = String(user.discordUsername || user.discord_username || user.username || user.displayName || '').trim();
        const displayName = String(user.discordDisplayName || user.discord_display_name || user.displayName || discordUsername || '').trim();

        localStorage.setItem('spmtToken', nextToken);
        if (user.id) localStorage.setItem('spmtUserId', String(user.id));
        if (user.username) localStorage.setItem('spmtUsername', String(user.username));
        if (discordUserId) localStorage.setItem('discordUserId', discordUserId);
        if (discordUsername) localStorage.setItem('discordUsername', discordUsername);
        if (displayName) localStorage.setItem('discordDisplayName', displayName);
        if (twitchUsername) localStorage.setItem('twitchUsername', twitchUsername);

        const runtimeResponse = await fetch('/api/runtime-config', { cache: 'no-store' }).catch(() => null);
        const runtime = runtimeResponse?.ok ? await runtimeResponse.json() : null;
        const defaultServerId = runtime?.publicIds?.hardcodedGuildId;
        if (defaultServerId) localStorage.setItem('discordServerId', String(defaultServerId));
        localStorage.setItem('isLoggedIn', 'true');

        if (!cancelled) router.replace(next.startsWith('/') ? next : '/dashboard');
      } catch (error) {
        console.error('[auth/callback] SPMT login failed', error);
        if (!cancelled) setMessage('SPMT sign in failed. Return to login and try again.');
      }
    }

    completeLogin();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-sm text-muted-foreground">
      {message}
    </main>
  );
}
