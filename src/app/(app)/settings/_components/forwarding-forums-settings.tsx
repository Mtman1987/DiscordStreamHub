'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Save, Trash2, Forward } from 'lucide-react';

type ForwardingMode = 'per-source-thread' | 'single-thread';

interface Mapping {
  sourceChannelId: string;
  threadId: string;
  label: string; // friendly name for display
}

export function ForwardingForumsSettings({ serverId }: { serverId: string }) {
  const { toast } = useToast();
  const [mappings, setMappings] = React.useState<Mapping[]>([]);
  const [forumChannelId, setForumChannelId] = React.useState('');
  const [forwardingMode, setForwardingMode] = React.useState<ForwardingMode>('per-source-thread');
  const [sharedThreadId, setSharedThreadId] = React.useState('');
  const [restrictToWhitelist, setRestrictToWhitelist] = React.useState(false);
  const [sourceChannelWhitelist, setSourceChannelWhitelist] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    loadMappings();
  }, [serverId]);

  const loadMappings = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/settings/forwarding-forums?serverId=${serverId}`);
      if (res.ok) {
        const data = await res.json();
        setForumChannelId(data.forumChannelId || '');
        setForwardingMode(data.forwardingMode === 'single-thread' ? 'single-thread' : 'per-source-thread');
        setSharedThreadId(data.sharedThreadId || '');
        setRestrictToWhitelist(Boolean(data.restrictToWhitelist));
        setSourceChannelWhitelist(Array.isArray(data.sourceChannelWhitelist) ? data.sourceChannelWhitelist.join('\n') : '');
        const raw = data.mappings || {};
        const labels = data.labels || {};
        const loaded: Mapping[] = Object.entries(raw).map(([sourceChannelId, threadId]) => ({
          sourceChannelId,
          threadId: threadId as string,
          label: (labels as Record<string, string>)[sourceChannelId] || '',
        }));
        setMappings(loaded.length > 0 ? loaded : [{ sourceChannelId: '', threadId: '', label: '' }]);
      }
    } catch {
      toast({ variant: 'destructive', title: 'Failed to load forwarding config' });
    } finally {
      setIsLoading(false);
    }
  };

  const save = async () => {
    setIsSaving(true);
    try {
      const mappingsObj: Record<string, string> = {};
      const labelsObj: Record<string, string> = {};
      for (const m of mappings) {
        if (m.sourceChannelId && m.threadId) {
          mappingsObj[m.sourceChannelId] = m.threadId;
          if (m.label) labelsObj[m.sourceChannelId] = m.label;
        }
      }
      const whitelist = restrictToWhitelist
        ? sourceChannelWhitelist
          .split(/[\n,]/g)
          .map(part => part.trim())
          .filter(Boolean)
        : [];
      const res = await fetch('/api/settings/forwarding-forums', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId,
          forumChannelId: forwardingMode === 'per-source-thread' ? forumChannelId.trim() : '',
          forwardingMode,
          sharedThreadId: forwardingMode === 'single-thread' ? sharedThreadId.trim() : '',
          restrictToWhitelist,
          sourceChannelWhitelist: whitelist,
          mappings: mappingsObj,
          labels: labelsObj,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: 'Saved', description: 'Forwarding forum mappings updated.' });
    } catch {
      toast({ variant: 'destructive', title: 'Failed to save' });
    } finally {
      setIsSaving(false);
    }
  };

  const addRow = () => setMappings(prev => [...prev, { sourceChannelId: '', threadId: '', label: '' }]);
  const removeRow = (i: number) => setMappings(prev => prev.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: keyof Mapping, value: string) =>
    setMappings(prev => prev.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)));

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Forward className="h-5 w-5" />
          Forum Forwarding Mappings
        </CardTitle>
        <CardDescription>
          Configure how Discord messages move between servers. This page is for the destination server that receives the forwarded posts.
          In per-source mode, the first message from each source channel creates its own forum thread automatically.
          In shared-thread mode, everything you allow here lands in one shared thread.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-xs text-muted-foreground space-y-1">
          <p><strong>Destination server:</strong> This page writes to the server you are currently configuring.</p>
          <p><strong>Source Channel ID:</strong> The channel on the other server that you want mirrored here.</p>
          <p><strong>Forum Parent Channel ID:</strong> The forum or media channel in the destination server used for per-source auto-threading.</p>
          <p><strong>Shared Thread ID:</strong> A single destination thread to reuse for every allowed source channel.</p>
          <p><strong>Thread ID:</strong> Right-click the forum thread → Copy Channel ID</p>
        </div>

        <div className="space-y-2 rounded-md border p-4">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Routing mode</Label>
          <Select value={forwardingMode} onValueChange={(v) => setForwardingMode(v as ForwardingMode)}>
            <SelectTrigger>
              <SelectValue placeholder="Choose routing mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="per-source-thread">One forum thread per source channel</SelectItem>
              <SelectItem value="single-thread">One shared thread for all allowed channels</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Use per-source mode when you want each channel from the partner server to get its own thread.
            Use shared-thread mode when you want every allowed channel to post into the same destination thread.
          </p>
        </div>

        <div className="space-y-1">
          {forwardingMode === 'per-source-thread' ? (
            <>
              <Label className="text-xs">Forum Parent Channel ID</Label>
              <Input
                placeholder="123456789012345678"
                value={forumChannelId}
                onChange={e => setForumChannelId(e.target.value)}
              />
            </>
          ) : (
            <>
              <Label className="text-xs">Shared Thread ID</Label>
              <Input
                placeholder="987654321098765432"
                value={sharedThreadId}
                onChange={e => setSharedThreadId(e.target.value)}
              />
            </>
          )}
        </div>

        <div className="flex items-start gap-3 rounded-md border p-4">
          <Checkbox
            id="restrict-whitelist"
            checked={restrictToWhitelist}
            onCheckedChange={(checked) => setRestrictToWhitelist(Boolean(checked))}
          />
          <div className="space-y-2">
            <Label htmlFor="restrict-whitelist" className="text-sm font-medium">
              Limit forwarding to a source whitelist
            </Label>
            <p className="text-xs text-muted-foreground">
              Leave the list empty to mirror all source channels. When this is enabled, only the IDs you list below will be forwarded.
            </p>
          </div>
        </div>

        {restrictToWhitelist && (
          <div className="space-y-1">
            <Label className="text-xs">Source Channel Whitelist</Label>
            <Textarea
              placeholder="123456789012345678&#10;987654321098765432"
              value={sourceChannelWhitelist}
              onChange={e => setSourceChannelWhitelist(e.target.value)}
              rows={4}
            />
          </div>
        )}

        {forwardingMode === 'single-thread' ? (
          <div className="rounded-md border p-3 text-xs text-muted-foreground">
            In shared-thread mode the source-channel mapping rows below are optional and only useful as labels.
            The shared thread ID above is the actual destination for all allowed messages.
          </div>
        ) : null}

        <div className="space-y-3">
          {forwardingMode === 'per-source-thread' ? (
            mappings.map((m, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Label</Label>
                  <Input
                    placeholder="e.g. van_braak"
                    value={m.label}
                    onChange={e => updateRow(i, 'label', e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Source Channel ID</Label>
                  <Input
                    placeholder="123456789012345678"
                    value={m.sourceChannelId}
                    onChange={e => updateRow(i, 'sourceChannelId', e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Forum Thread ID</Label>
                  <Input
                    placeholder="987654321098765432"
                    value={m.threadId}
                    onChange={e => updateRow(i, 'threadId', e.target.value)}
                  />
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeRow(i)} disabled={mappings.length <= 1}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))
          ) : (
            <div className="rounded-md border p-3 text-xs text-muted-foreground">
              The per-source mapping table is hidden in shared-thread mode because every allowed source channel uses the same shared thread.
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          {forwardingMode === 'per-source-thread' ? (
            <Button variant="outline" size="sm" onClick={addRow}>
              <Plus className="h-4 w-4 mr-1" /> Add Source Channel
            </Button>
          ) : null}
          <Button size="sm" onClick={save} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            Save Mappings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
