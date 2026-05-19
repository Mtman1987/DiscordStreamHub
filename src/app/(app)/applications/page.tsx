'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';
import { useDbCollection, useDbDoc, dbSet, dbUpdate, dbDelete } from '@/hooks/use-db';
import { Send, CheckCircle, XCircle, Trash2, ThumbsUp, ThumbsDown, Settings2, Loader2, Save } from 'lucide-react';
import { AdminGuard } from '@/components/admin-guard';

interface DmTemplates {
  modApproved: string;
  modRejected: string;
  partnerApproved: string;
  partnerRejected: string;
}

const DEFAULT_TEMPLATES: DmTemplates = {
  modApproved: 'Congratulations! Your application to join the Mod Team has been approved! You will receive your Mod role shortly. Check the staff channels for onboarding info.',
  modRejected: "Thank you for your interest in joining the mod team. After careful review, we've decided not to move forward at this time. You're still a valued member — keep being awesome and feel free to reapply!",
  partnerApproved: 'Congratulations! Your partnership application has been approved! Set up your forum post in the partner section and grab your Partner role to access coordination channels.',
  partnerRejected: "Thank you for your interest in partnering with us. After careful review, we've decided not to move forward at this time. Feel free to stay connected and explore other collaboration opportunities!",
};

function VoteSection({ serverId, appId, status }: { serverId: string; appId: string; status: string }) {
  const { data: votes } = useDbCollection<any>(
    serverId && appId ? `servers/${serverId}/applications/${appId}/votes` : null
  );
  const [isVoting, setIsVoting] = React.useState(false);
  const { toast } = useToast();
  const adminId = React.useMemo(() => localStorage.getItem('discordUserId') || '', []);
  const adminName = React.useMemo(() => localStorage.getItem('twitchUsername') || 'Admin', []);

  const castVote = async (vote: 'approve' | 'reject') => {
    setIsVoting(true);
    try {
      const res = await fetch('/api/applications/vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, applicationId: appId, adminId, adminName, vote }),
      });
      if (!res.ok) throw new Error('Vote failed');
      toast({ title: 'Vote recorded' });
    } catch { toast({ title: 'Error', variant: 'destructive' }); }
    finally { setIsVoting(false); }
  };

  if (status !== 'pending') return null;
  const approves = votes?.filter(v => v.vote === 'approve') || [];
  const rejects = votes?.filter(v => v.vote === 'reject') || [];
  const myVote = votes?.find(v => v.id === adminId)?.vote;

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span>Votes</span>
        <Badge variant="outline" className="text-xs">{(votes?.length || 0)}</Badge>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant={myVote === 'approve' ? 'default' : 'outline'} onClick={() => castVote('approve')} disabled={isVoting} className="gap-1">
          <ThumbsUp className="h-3.5 w-3.5" />{approves.length}
        </Button>
        <Button size="sm" variant={myVote === 'reject' ? 'destructive' : 'outline'} onClick={() => castVote('reject')} disabled={isVoting} className="gap-1">
          <ThumbsDown className="h-3.5 w-3.5" />{rejects.length}
        </Button>
      </div>
    </div>
  );
}

function ApplicationCard({ app, serverId, type, onUpdateStatus, onDelete }: {
  app: any; serverId: string; type: 'mod' | 'partner';
  onUpdateStatus: (id: string, status: 'approved' | 'rejected') => void;
  onDelete: (id: string) => void;
}) {
  const submittedDate = app.submittedAt?.seconds ? new Date(app.submittedAt.seconds * 1000) : (app.submittedAt ? new Date(app.submittedAt) : new Date());

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{app.username}</CardTitle>
            <CardDescription>Submitted {submittedDate.toLocaleDateString()}</CardDescription>
          </div>
          <Badge variant={app.status === 'approved' ? 'default' : app.status === 'rejected' ? 'destructive' : 'secondary'}>{app.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {type === 'mod' ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="font-semibold">Timezone:</span> {app.timezone}</div>
            <div><span className="font-semibold">Member Since:</span> {app.memberDuration}</div>
            <div className="col-span-2"><span className="font-semibold">Why Mod:</span><p className="text-muted-foreground mt-1">{app.whyMod}</p></div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="font-semibold">Community:</span> {app.communityName}</div>
            <div><span className="font-semibold">Contact:</span> {app.contactInfo}</div>
            <div className="col-span-2"><span className="font-semibold">Why Partner:</span><p className="text-muted-foreground mt-1">{app.whyPartner}</p></div>
          </div>
        )}
        <VoteSection serverId={serverId} appId={app.id} status={app.status} />
        <div className="flex gap-2 pt-1">
          {app.status === 'pending' && (
            <>
              <Button size="sm" onClick={() => onUpdateStatus(app.id, 'approved')}><CheckCircle className="h-4 w-4 mr-1" />Approve</Button>
              <Button size="sm" variant="destructive" onClick={() => onUpdateStatus(app.id, 'rejected')}><XCircle className="h-4 w-4 mr-1" />Reject</Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => onDelete(app.id)}><Trash2 className="h-4 w-4 mr-1" />Delete</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ApplicationsPage() {
  const [serverId, setServerId] = React.useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = React.useState('');
  const [isPosting, setIsPosting] = React.useState(false);
  const [isSavingTemplates, setIsSavingTemplates] = React.useState(false);
  const [templates, setTemplates] = React.useState<DmTemplates>(DEFAULT_TEMPLATES);
  const { toast } = useToast();

  React.useEffect(() => { setServerId(localStorage.getItem('discordServerId')); }, []);

  const { data: channelsData } = useDbDoc<{ list: any[] }>(serverId ? `servers/${serverId}/config/channels` : null);
  const channels = channelsData?.list ?? [];

  const { data: applications } = useDbCollection<any>(serverId ? `servers/${serverId}/applications` : null);

  const { data: savedTemplates } = useDbDoc<DmTemplates>(serverId ? `servers/${serverId}/config/dmTemplates` : null);
  React.useEffect(() => { if (savedTemplates) setTemplates({ ...DEFAULT_TEMPLATES, ...savedTemplates }); }, [savedTemplates]);

  const postEmbed = async () => {
    if (!serverId || !selectedChannel) { toast({ title: 'Select a channel', variant: 'destructive' }); return; }
    setIsPosting(true);
    try {
      const res = await fetch('/api/applications/post-embed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serverId, channelId: selectedChannel }) });
      if (!res.ok) throw new Error('Failed');
      toast({ title: 'Application embed posted!' });
    } catch { toast({ title: 'Error', variant: 'destructive' }); }
    finally { setIsPosting(false); }
  };

  const updateStatus = async (appId: string, status: 'approved' | 'rejected') => {
    if (!serverId) return;
    try {
      const app = applications?.find(a => a.id === appId);
      if (!app) return;
      await dbUpdate(`servers/${serverId}/applications/${appId}`, { status, reviewedAt: new Date().toISOString() });
      await fetch('/api/applications/notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, userId: app.userId, type: app.type, status }),
      });
      toast({ title: `Application ${status}`, description: 'User has been notified via DM' });
    } catch { toast({ title: 'Error', variant: 'destructive' }); }
  };

  const deleteApplication = async (appId: string) => {
    if (!serverId) return;
    try {
      await dbDelete(`servers/${serverId}/applications/${appId}`);
      toast({ title: 'Application deleted' });
    } catch { toast({ title: 'Error', variant: 'destructive' }); }
  };

  const saveTemplates = async () => {
    if (!serverId) return;
    setIsSavingTemplates(true);
    try {
      await dbSet(`servers/${serverId}/config/dmTemplates`, templates);
      toast({ title: 'DM templates saved!' });
    } catch { toast({ title: 'Error saving templates', variant: 'destructive' }); }
    finally { setIsSavingTemplates(false); }
  };

  const modApps = applications?.filter(app => app.type === 'mod') || [];
  const partnerApps = applications?.filter(app => app.type === 'partner') || [];

  return (
    <AdminGuard>
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Applications</h1>
        <p className="text-muted-foreground">Review and manage mod team and partnership applications</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Tabs defaultValue="mod" className="space-y-4">
            <TabsList>
              <TabsTrigger value="mod">Mod ({modApps.length})</TabsTrigger>
              <TabsTrigger value="partner">Partner ({partnerApps.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="mod" className="space-y-4">
              {modApps.length === 0 ? (
                <Card><CardContent className="py-8 text-center text-muted-foreground">No mod applications yet</CardContent></Card>
              ) : modApps.map(app => (
                <ApplicationCard key={app.id} app={app} serverId={serverId!} type="mod" onUpdateStatus={updateStatus} onDelete={deleteApplication} />
              ))}
            </TabsContent>
            <TabsContent value="partner" className="space-y-4">
              {partnerApps.length === 0 ? (
                <Card><CardContent className="py-8 text-center text-muted-foreground">No partner applications yet</CardContent></Card>
              ) : partnerApps.map(app => (
                <ApplicationCard key={app.id} app={app} serverId={serverId!} type="partner" onUpdateStatus={updateStatus} onDelete={deleteApplication} />
              ))}
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Post Application Embed</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={selectedChannel} onValueChange={setSelectedChannel}>
                <SelectTrigger><SelectValue placeholder="Channel" /></SelectTrigger>
                <SelectContent>{channels.map((ch: any) => <SelectItem key={ch.id} value={ch.id}>#{ch.name}</SelectItem>)}</SelectContent>
              </Select>
              <Button onClick={postEmbed} disabled={isPosting || !selectedChannel} className="w-full" size="sm">
                {isPosting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}Post Embed
              </Button>
            </CardContent>
          </Card>

          <Accordion type="single" collapsible>
            <AccordionItem value="templates" className="border rounded-lg">
              <AccordionTrigger className="px-4 py-3 text-sm">
                <span className="flex items-center gap-2"><Settings2 className="h-4 w-4" />DM Message Templates</span>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs">Mod Approved</Label>
                  <Textarea value={templates.modApproved} onChange={e => setTemplates(t => ({...t, modApproved: e.target.value}))} rows={3} className="text-xs" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Mod Rejected</Label>
                  <Textarea value={templates.modRejected} onChange={e => setTemplates(t => ({...t, modRejected: e.target.value}))} rows={3} className="text-xs" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Partner Approved</Label>
                  <Textarea value={templates.partnerApproved} onChange={e => setTemplates(t => ({...t, partnerApproved: e.target.value}))} rows={3} className="text-xs" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Partner Rejected</Label>
                  <Textarea value={templates.partnerRejected} onChange={e => setTemplates(t => ({...t, partnerRejected: e.target.value}))} rows={3} className="text-xs" />
                </div>
                <Button onClick={saveTemplates} disabled={isSavingTemplates} size="sm" className="w-full">
                  {isSavingTemplates ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Save className="h-3 w-3 mr-2" />}Save Templates
                </Button>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>
    </div>
    </AdminGuard>
  );
}
