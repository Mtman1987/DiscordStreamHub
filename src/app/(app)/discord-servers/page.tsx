
'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
type Server = { id: string; name: string; botInstalled: boolean; selected: boolean; canInstall: boolean; installUrl: string | null };
export default function DiscordServersPage() {
  const [servers, setServers] = React.useState<Server[]>([]);
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  const [needsConnect, setNeedsConnect] = React.useState(false);
  const refresh = React.useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/discord/servers', { cache: 'no-store', credentials: 'include' });
      const data = await response.json();
      setNeedsConnect(!!data.needsDiscordConnect);
      if (!response.ok) throw new Error(data.error || 'Unable to load servers.');
      setServers(data.servers || []);
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to load servers.'); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => {
    void refresh();
    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) setError(params.get('error') || '');
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);
  async function select(server: Server) {
    setBusy(server.id); setError('');
    try {
      const response = await fetch('/api/discord/servers', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guildId: server.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to select server.');
      localStorage.setItem('discordServerId', data.serverId);
      localStorage.setItem('serverName', data.serverName);
      localStorage.setItem('serverIconUrl', data.iconUrl || '');
      window.dispatchEvent(new Event('dsh-session-restored'));
      window.location.assign('/dashboard');
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to select server.'); }
    finally { setBusy(''); }
  }
  return <Card className="mx-auto max-w-3xl">
    <CardHeader><CardTitle>Your Discord servers</CardTitle><CardDescription>
      Connect Discord, choose a server you own or moderate, and install SPMT to use your community tools.
    </CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button asChild><a href="/api/discord/servers/authorize">{needsConnect ? 'Connect Discord' : 'Refresh Discord authorization'}</a></Button>
        <Button variant="outline" onClick={refresh} disabled={loading}>{loading ? 'Loading…' : 'Refresh servers'}</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Input aria-label="Search Discord servers" placeholder="Search your servers…" value={query} onChange={e => setQuery(e.target.value)} />
      {!loading && !needsConnect && servers.length === 0 && <p className="text-sm text-muted-foreground">No servers with management or moderation permissions were found. Check that you connected the correct Discord account.</p>}
      {servers.filter(s => s.name.toLowerCase().includes(query.toLowerCase())).map(server =>
        <div key={server.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
          <div><p className="font-medium">{server.name}</p><p className="text-sm text-muted-foreground">
            {server.selected ? 'Selected' : server.botInstalled ? 'SPMT is installed' : 'SPMT bot installation required'}
          </p></div>
          {server.botInstalled ? <Button disabled={!!busy} onClick={() => select(server)}>{busy === server.id ? 'Connecting…' : server.selected ? 'Open server' : 'Connect and select'}</Button>
            : server.installUrl ? <Button asChild><a href={server.installUrl} target="_blank" rel="noopener noreferrer">Install SPMT</a></Button>
            : <span className="max-w-xs text-sm text-muted-foreground">Ask the server owner or someone with Manage Server permission to install SPMT, then refresh.</span>}
        </div>)}
      <p className="text-sm text-muted-foreground">After approving the installation in Discord, return here and refresh. Connect and select saves the server to your account and loads its channels and roles.</p>
    </CardContent>
  </Card>;
}
