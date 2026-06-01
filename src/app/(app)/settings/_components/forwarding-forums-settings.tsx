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
import { Loader2, Plus, Save, Trash2, Forward, RefreshCw } from 'lucide-react';

type ForwardingMode = 'per-source-thread' | 'single-thread';

type SavedRule = {
  serverId: string;
  ruleLabel: string;
  sourceServerId: string;
  destinationServerId: string;
  forumChannelId?: string;
  sharedThreadId?: string;
  forwardingMode?: ForwardingMode;
  restrictToWhitelist?: boolean;
  sourceChannelWhitelist?: string[];
};

interface Mapping {
  sourceChannelId: string;
  threadId: string;
  label: string;
}

const emptyMapping = (): Mapping => ({ sourceChannelId: '', threadId: '', label: '' });

export function ForwardingForumsSettings() {
  const { toast } = useToast();
  const [ruleLabel, setRuleLabel] = React.useState('');
  const [sourceServerId, setSourceServerId] = React.useState('');
  const [destinationServerId, setDestinationServerId] = React.useState('');
  const [mappings, setMappings] = React.useState<Mapping[]>([emptyMapping()]);
  const [forumChannelId, setForumChannelId] = React.useState('');
  const [forwardingMode, setForwardingMode] = React.useState<ForwardingMode>('per-source-thread');
  const [sharedThreadId, setSharedThreadId] = React.useState('');
  const [restrictToWhitelist, setRestrictToWhitelist] = React.useState(false);
  const [sourceChannelWhitelist, setSourceChannelWhitelist] = React.useState('');
  const [showAdvancedOverrides, setShowAdvancedOverrides] = React.useState(false);
  const [savedRules, setSavedRules] = React.useState<SavedRule[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  const loadSavedRules = React.useCallback(async () => {
    try {
      const res = await fetch('/api/settings/forwarding-forums/list');
      if (!res.ok) return;
      const data = await res.json();
      setSavedRules(Array.isArray(data.rules) ? data.rules : []);
    } catch {
      setSavedRules([]);
    }
  }, []);

  React.useEffect(() => {
    void loadSavedRules();
  }, [loadSavedRules]);

  const loadRule = React.useCallback(async () => {
    if (!sourceServerId.trim()) {
      toast({ variant: 'destructive', title: 'Source server ID required' });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`/api/settings/forwarding-forums?sourceServerId=${encodeURIComponent(sourceServerId.trim())}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRuleLabel(data.ruleLabel || '');
      setDestinationServerId(data.destinationServerId || '');
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
      setMappings(loaded.length > 0 ? loaded : [emptyMapping()]);
      setShowAdvancedOverrides(loaded.length > 0);
      toast({ title: 'Rule loaded', description: `Loaded forwarding rule for ${sourceServerId.trim()}` });
    } catch {
      toast({ variant: 'destructive', title: 'Failed to load forwarding rule' });
    } finally {
      setIsLoading(false);
    }
  }, [sourceServerId, toast]);

  const save = async () => {
    if (!sourceServerId.trim() || !destinationServerId.trim()) {
      toast({ variant: 'destructive', title: 'Source and destination server IDs are required' });
      return;
    }

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
          ruleLabel: ruleLabel.trim() || `${sourceServerId.trim()} → ${destinationServerId.trim()}`,
          sourceServerId: sourceServerId.trim(),
          destinationServerId: destinationServerId.trim(),
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
      toast({ title: 'Saved', description: 'Forwarding rule updated.' });
      void loadSavedRules();
    } catch {
      toast({ variant: 'destructive', title: 'Failed to save' });
    } finally {
      setIsSaving(false);
    }
  };

  const addRow = () => setMappings(prev => [...prev, emptyMapping()]);
  const removeRow = (i: number) => setMappings(prev => prev.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: keyof Mapping, value: string) =>
    setMappings(prev => prev.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)));
  const loadSavedRule = (rule: SavedRule) => {
    setRuleLabel(rule.ruleLabel || '');
    setSourceServerId(rule.sourceServerId || '');
    setDestinationServerId(rule.destinationServerId || '');
    setForwardingMode(rule.forwardingMode === 'single-thread' ? 'single-thread' : 'per-source-thread');
    setForumChannelId(rule.forumChannelId || '');
    setSharedThreadId(rule.sharedThreadId || '');
    setRestrictToWhitelist(Boolean(rule.restrictToWhitelist));
    setSourceChannelWhitelist(Array.isArray(rule.sourceChannelWhitelist) ? rule.sourceChannelWhitelist.join('\n') : '');
    setMappings([emptyMapping()]);
    setShowAdvancedOverrides(false);
  };
  const deleteSavedRule = async (targetSourceServerId: string) => {
    try {
      const res = await fetch('/api/settings/forwarding-forums', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceServerId: targetSourceServerId }),
      });
      if (!res.ok) throw new Error();
      setSavedRules(prev => prev.filter(rule => rule.sourceServerId !== targetSourceServerId));
      if (sourceServerId.trim() === targetSourceServerId) {
        setRuleLabel('');
        setSourceServerId('');
        setDestinationServerId('');
        setForumChannelId('');
        setSharedThreadId('');
        setSourceChannelWhitelist('');
        setMappings([emptyMapping()]);
        setRestrictToWhitelist(false);
        setShowAdvancedOverrides(false);
      }
      toast({ title: 'Deleted', description: 'Forwarding rule removed.' });
    } catch {
      toast({ variant: 'destructive', title: 'Failed to delete rule' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Forward className="h-5 w-5" />
          Forum Forwarding Rule
        </CardTitle>
        <CardDescription>
          Set a source server and a destination server explicitly. The rule below defines where messages come from and where they go.
          If the whitelist is empty, all source channels are allowed. Use the saved rules list below to load or delete existing flows.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label className="text-xs">Rule Label</Label>
          <Input
            placeholder="e.g. Space Mountain inbound"
            value={ruleLabel}
            onChange={e => setRuleLabel(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Friendly name for this forwarding rule so you can tell it apart from other partner flows.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Source Server ID</Label>
            <Input
              placeholder="123456789012345678"
              value={sourceServerId}
              onChange={e => setSourceServerId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Messages must originate from this Discord server.</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Destination Server ID</Label>
            <Input
              placeholder="987654321098765432"
              value={destinationServerId}
              onChange={e => setDestinationServerId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Forwarded posts land in this Discord server.</p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadRule} disabled={isLoading || !sourceServerId.trim()}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Load Existing Rule
          </Button>
        </div>

        <div className="rounded-md border p-4 space-y-2">
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
            Per-source mode creates a thread the first time a source channel speaks. Shared-thread mode sends all allowed source channels into one destination thread.
          </p>
        </div>

        <div className="space-y-1">
          {forwardingMode === 'per-source-thread' ? (
            <>
              <Label className="text-xs">Destination Forum Parent Channel ID</Label>
              <Input
                placeholder="1510992840346435744"
                value={forumChannelId}
                onChange={e => setForumChannelId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                This must be a forum or media channel in the destination server.
              </p>
            </>
          ) : (
            <>
              <Label className="text-xs">Shared Destination Thread ID</Label>
              <Input
                placeholder="1497583782524485653"
                value={sharedThreadId}
                onChange={e => setSharedThreadId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Use this when every allowed source channel should post into one shared thread.
              </p>
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
              Restrict to a source channel whitelist
            </Label>
            <p className="text-xs text-muted-foreground">
              Leave the whitelist empty to mirror all source channels. If you fill it in, only those source channel IDs will be forwarded.
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

        <div className="flex items-start gap-3 rounded-md border p-4">
          <Checkbox
            id="advanced-overrides"
            checked={showAdvancedOverrides}
            onCheckedChange={(checked) => setShowAdvancedOverrides(Boolean(checked))}
          />
          <div className="space-y-2">
            <Label htmlFor="advanced-overrides" className="text-sm font-medium">
              Show advanced source/thread overrides
            </Label>
            <p className="text-xs text-muted-foreground">
              Use this only if you want to pin a specific source channel to an existing destination thread.
              If you are just using the whitelist plus auto-create, you can leave this off.
            </p>
          </div>
        </div>

        {showAdvancedOverrides ? (
          <div className="space-y-3">
            {mappings.map((m, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Label (optional)</Label>
                  <Input
                    placeholder="e.g. Space Mountain inbound"
                    value={m.label}
                    onChange={e => updateRow(i, 'label', e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Source Channel ID (optional override)</Label>
                  <Input
                    placeholder="123456789012345678"
                    value={m.sourceChannelId}
                    onChange={e => updateRow(i, 'sourceChannelId', e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Forum Thread ID (optional override)</Label>
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
            ))}
          </div>
        ) : (
          <div className="rounded-md border p-3 text-xs text-muted-foreground">
            No per-channel overrides are enabled. With a blank whitelist, every allowed source channel will auto-create or reuse its thread according to the selected mode.
          </div>
        )}

        <div className="flex gap-2 pt-2">
          {showAdvancedOverrides ? (
            <Button variant="outline" size="sm" onClick={addRow}>
              <Plus className="h-4 w-4 mr-1" /> Add Source Channel
            </Button>
          ) : null}
          <Button size="sm" onClick={save} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
          Save Rule
        </Button>
        </div>

        <div className="rounded-md border p-4 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Saved Rules</Label>
            <p className="text-xs text-muted-foreground">
              These are the forwarding rules already stored in the app. Use Load to edit one or the trash icon to delete it.
            </p>
          </div>
          {savedRules.length === 0 ? (
            <div className="text-xs text-muted-foreground">No saved forwarding rules yet.</div>
          ) : (
            <div className="space-y-2">
              {savedRules.map(rule => (
                <div key={rule.sourceServerId} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0 space-y-1">
                    <div className="font-medium text-sm truncate">{rule.ruleLabel || `${rule.sourceServerId} → ${rule.destinationServerId}`}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {rule.sourceServerId} → {rule.destinationServerId}
                      {rule.forwardingMode === 'single-thread' ? ' · shared thread' : ' · per-source threads'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => loadSavedRule(rule)}>
                      Load
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteSavedRule(rule.sourceServerId)} aria-label={`Delete ${rule.ruleLabel || rule.sourceServerId}`}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
