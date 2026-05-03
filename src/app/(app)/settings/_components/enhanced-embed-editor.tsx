'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, Eye } from 'lucide-react';
import { useDbDoc, dbSet } from '@/hooks/use-db';
import { getChannels } from '@/lib/discord-sync-service';

interface EmbedTemplates {
  crew: { title: string; titleEmoji: string; description: string; badge: string; footer: string; color: string; authorIconUrl: string; fieldPlayingLabel: string; fieldViewersLabel: string; fieldStatusLabel: string; };
  partners: { title: string; titleEmoji: string; description: string; badge: string; footer: string; color: string; authorIconUrl: string; fieldPlayingLabel: string; fieldViewersLabel: string; fieldStatusLabel: string; };
  community: { title: string; footer: string; color: string; descriptionFormat: string; };
}

const DEFAULT_TEMPLATES: EmbedTemplates = {
  crew: { title: '{username} is LIVE!', titleEmoji: '🎬', description: '🌟 **Space Mountain Crew Member** 🌟\n\nOne of our amazing crew members is live!', badge: 'Space Mountain Crew', footer: 'Twitch • Crew Shoutout', color: '#00D9FF', authorIconUrl: 'https://cdn.discordapp.com/emojis/1284931162896334929.gif', fieldPlayingLabel: '🎮 Playing', fieldViewersLabel: '👥 Viewers', fieldStatusLabel: '🚀 Crew Status' },
  partners: { title: '{username} is LIVE!', titleEmoji: '⭐', description: '⭐ **Space Mountain Partner** ⭐\n\nOne of our official streaming partners is live!', badge: 'Official Partner', footer: 'Twitch • Partner Shoutout', color: '#8B00FF', authorIconUrl: 'https://cdn.discordapp.com/emojis/1284931162896334929.gif', fieldPlayingLabel: '🎮 Playing', fieldViewersLabel: '👥 Viewers', fieldStatusLabel: '🌟 Partner Status' },
  community: { title: '🎬 {username} is LIVE!', footer: 'Twitch • Community Shoutout', color: '#9146FF', descriptionFormat: '**{title}**\n🎮 Playing: {game}\n👥 Viewers: {viewers}' }
};

const COMMON_EMOJIS = ['🎬', '⭐', '🚀', '🌟', '🎮', '👥', '🔥', '💜', '🌌', '✨', '📺', '🎯'];

export function EnhancedEmbedEditor({ serverId }: { serverId: string }) {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = React.useState(false);
  const [isPreviewing, setIsPreviewing] = React.useState<string | null>(null);
  const [templates, setTemplates] = React.useState<EmbedTemplates>(DEFAULT_TEMPLATES);
  const [channels, setChannels] = React.useState<any[]>([]);
  const [selectedChannel, setSelectedChannel] = React.useState('');

  React.useEffect(() => { if (serverId) getChannels(serverId).then(setChannels).catch(console.error); }, [serverId]);

  const { data: savedTemplates } = useDbDoc<EmbedTemplates>(serverId ? `servers/${serverId}/config/embedTemplates` : null);
  React.useEffect(() => { if (savedTemplates) setTemplates({ ...DEFAULT_TEMPLATES, ...savedTemplates }); }, [savedTemplates]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await dbSet(`servers/${serverId}/config/embedTemplates`, templates);
      toast({ title: 'Templates saved!', description: 'Your embed templates have been updated.' });
    } catch { toast({ variant: 'destructive', title: 'Error', description: 'Failed to save templates.' }); }
    finally { setIsSaving(false); }
  };

  const handlePreview = async (type: 'crew' | 'partners' | 'community') => {
    if (!selectedChannel) { toast({ variant: 'destructive', title: 'Channel Required', description: 'Please select a channel first.' }); return; }
    setIsPreviewing(type);
    try {
      const response = await fetch('/api/discord/preview-template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serverId, channelId: selectedChannel, type, templates }) });
      toast(response.ok ? { title: 'Preview Posted' } : { variant: 'destructive', title: 'Preview Failed' });
    } catch { toast({ variant: 'destructive', title: 'Error' }); }
    finally { setIsPreviewing(null); }
  };

  const updateCrew = (field: string, value: string) => setTemplates(t => ({...t, crew: {...t.crew, [field]: value}}));
  const updatePartners = (field: string, value: string) => setTemplates(t => ({...t, partners: {...t.partners, [field]: value}}));
  const updateCommunity = (field: string, value: string) => setTemplates(t => ({...t, community: {...t.community, [field]: value}}));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enhanced Embed Customization</CardTitle>
        <CardDescription>Full control over colors, emojis, and formatting. Use {'{username}'}, {'{title}'}, {'{game}'}, {'{viewers}'} as placeholders.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Preview Channel</Label>
          <Select value={selectedChannel} onValueChange={setSelectedChannel}>
            <SelectTrigger><SelectValue placeholder="Choose a channel for previews" /></SelectTrigger>
            <SelectContent>{channels.map(ch => <SelectItem key={ch.id} value={ch.id}>#{ch.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div className="space-y-4 border-t pt-4">
          <h3 className="font-semibold text-lg">Crew Members</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Title Emoji</Label>
              <Select value={templates.crew.titleEmoji} onValueChange={v => updateCrew('titleEmoji', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{COMMON_EMOJIS.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Color</Label><div className="flex gap-2"><Input type="color" value={templates.crew.color} onChange={e => updateCrew('color', e.target.value)} className="w-20" /><Input value={templates.crew.color} onChange={e => updateCrew('color', e.target.value)} /></div></div>
          </div>
          <div className="space-y-2"><Label>Title</Label><Input value={templates.crew.title} onChange={e => updateCrew('title', e.target.value)} /></div>
          <div className="space-y-2"><Label>Description</Label><Textarea value={templates.crew.description} onChange={e => updateCrew('description', e.target.value)} rows={3} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Badge</Label><Input value={templates.crew.badge} onChange={e => updateCrew('badge', e.target.value)} /></div>
            <div className="space-y-2"><Label>Footer</Label><Input value={templates.crew.footer} onChange={e => updateCrew('footer', e.target.value)} /></div>
          </div>
          <Button variant="outline" onClick={() => handlePreview('crew')} disabled={isPreviewing === 'crew' || !selectedChannel} className="w-full">
            {isPreviewing === 'crew' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}Preview Crew
          </Button>
        </div>

        <div className="space-y-4 border-t pt-4">
          <h3 className="font-semibold text-lg">Partners</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Title Emoji</Label>
              <Select value={templates.partners.titleEmoji} onValueChange={v => updatePartners('titleEmoji', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{COMMON_EMOJIS.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Color</Label><div className="flex gap-2"><Input type="color" value={templates.partners.color} onChange={e => updatePartners('color', e.target.value)} className="w-20" /><Input value={templates.partners.color} onChange={e => updatePartners('color', e.target.value)} /></div></div>
          </div>
          <div className="space-y-2"><Label>Title</Label><Input value={templates.partners.title} onChange={e => updatePartners('title', e.target.value)} /></div>
          <div className="space-y-2"><Label>Description</Label><Textarea value={templates.partners.description} onChange={e => updatePartners('description', e.target.value)} rows={3} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Badge</Label><Input value={templates.partners.badge} onChange={e => updatePartners('badge', e.target.value)} /></div>
            <div className="space-y-2"><Label>Footer</Label><Input value={templates.partners.footer} onChange={e => updatePartners('footer', e.target.value)} /></div>
          </div>
          <Button variant="outline" onClick={() => handlePreview('partners')} disabled={isPreviewing === 'partners' || !selectedChannel} className="w-full">
            {isPreviewing === 'partners' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}Preview Partners
          </Button>
        </div>

        <div className="space-y-4 border-t pt-4">
          <h3 className="font-semibold text-lg">Community</h3>
          <div className="space-y-2"><Label>Color</Label><div className="flex gap-2"><Input type="color" value={templates.community.color} onChange={e => updateCommunity('color', e.target.value)} className="w-20" /><Input value={templates.community.color} onChange={e => updateCommunity('color', e.target.value)} /></div></div>
          <div className="space-y-2"><Label>Title</Label><Input value={templates.community.title} onChange={e => updateCommunity('title', e.target.value)} /></div>
          <div className="space-y-2"><Label>Description Format</Label><Textarea value={templates.community.descriptionFormat} onChange={e => updateCommunity('descriptionFormat', e.target.value)} rows={3} /></div>
          <div className="space-y-2"><Label>Footer</Label><Input value={templates.community.footer} onChange={e => updateCommunity('footer', e.target.value)} /></div>
          <Button variant="outline" onClick={() => handlePreview('community')} disabled={isPreviewing === 'community' || !selectedChannel} className="w-full">
            {isPreviewing === 'community' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}Preview Community
          </Button>
        </div>

        <Button onClick={handleSave} disabled={isSaving} className="w-full" size="lg">
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save All Templates
        </Button>
      </CardContent>
    </Card>
  );
}
