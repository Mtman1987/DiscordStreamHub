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
import { useDbCollection, useDbDoc, dbSet } from '@/hooks/use-db';
import { Send, CheckCircle, XCircle, ThumbsUp, ThumbsDown, Settings2, Loader2, Save, Archive } from 'lucide-react';
import { AdminGuard } from '@/components/admin-guard';
import { useCurrentUser } from '@/hooks/use-current-user';

interface DmTemplates {
  modApproved: string;
  modRejected: string;
  partnerApproved: string;
  partnerRejected: string;
  devApproved: string;
  devRejected: string;
  modApprovedAttachmentUrl?: string;
  modRejectedAttachmentUrl?: string;
  partnerApprovedAttachmentUrl?: string;
  partnerRejectedAttachmentUrl?: string;
  devApprovedAttachmentUrl?: string;
  devRejectedAttachmentUrl?: string;
}

type ApplicationView = 'pending' | 'approved' | 'rejected' | 'archived';

interface ProposalFormState {
  audience: 'community' | 'admin' | 'targeted';
  channelId: string;
  title: string;
  description: string;
  approveLabel: string;
  denyLabel: string;
  approveEmoji: string;
  denyEmoji: string;
  referenceUrl: string;
  color: string;
}

const DEFAULT_TEMPLATES: DmTemplates = {
  modApproved: 'The Owner approved your moderation application. Authorize with SPMT, review the exact terms, and explicitly accept them to continue to onboarding.',
  modRejected: 'Thank you for your interest in SPMT moderation. The Owner is not moving forward with this application at this time.',
  partnerApproved: 'The Owner approved your partnership application. Authorize with SPMT, review the exact terms, and explicitly accept them to continue to onboarding.',
  partnerRejected: 'Thank you for your partnership inquiry. The Owner is not moving forward with this application at this time.',
  devApproved: 'The Owner approved your developer application. Authorize with SPMT, review the exact terms, and explicitly accept them before integration access is granted.',
  devRejected: 'Thank you for your developer inquiry. The Owner is not moving forward with this application at this time.',
};

function VoteSection({ serverId, appId, status }: { serverId: string; appId: string; status: string }) {
  const { data: votes } = useDbCollection<any>(serverId && appId ? `servers/${serverId}/applications/${appId}/votes` : null);
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
      <div className="flex items-center gap-2 text-sm font-medium"><span>Votes</span><Badge variant="outline" className="text-xs">{votes?.length || 0}</Badge></div>
      <div className="flex gap-2">
        <Button size="sm" variant={myVote === 'approve' ? 'default' : 'outline'} onClick={() => castVote('approve')} disabled={isVoting} className="gap-1"><ThumbsUp className="h-3.5 w-3.5" />{approves.length}</Button>
        <Button size="sm" variant={myVote === 'reject' ? 'destructive' : 'outline'} onClick={() => castVote('reject')} disabled={isVoting} className="gap-1"><ThumbsDown className="h-3.5 w-3.5" />{rejects.length}</Button>
      </div>
      <p className="text-xs text-muted-foreground">Individual advisory votes are retained privately for audit. The Owner makes the final decision.</p>
    </div>
  );
}

function ApplicationCard({ app, serverId, type, onUpdateStatus, canDecide }: {
  app: any; serverId: string; type: 'mod' | 'partner' | 'dev';
  onUpdateStatus: (id: string, status: 'approved' | 'rejected') => void;
  canDecide: boolean;
}) {
  const submittedDate = app.submittedAt?.seconds ? new Date(app.submittedAt.seconds * 1000) : (app.submittedAt ? new Date(app.submittedAt) : new Date());
  const archivedDate = app.archivedAt ? new Date(app.archivedAt) : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{app.username}</CardTitle>
            <CardDescription>Submitted {submittedDate.toLocaleDateString()}{archivedDate ? ` · Archived ${archivedDate.toLocaleDateString()}` : ''}</CardDescription>
          </div>
          <Badge variant={app.status === 'approved' ? 'default' : app.status === 'rejected' ? 'destructive' : 'secondary'}>{app.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.isArray(app.answers) ? (
          <div className="space-y-3 text-sm">{app.answers.map((item: any) => <div key={item.id}><span className="font-semibold">{item.question}:</span><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{item.answer}</p></div>)}</div>
        ) : type === 'mod' ? (
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
        {app.reviewedBy && <div className="text-sm"><span className="font-semibold">Decision maker:</span> {app.reviewedBy}</div>}
        {app.agreementStatus && <div className="text-sm"><span className="font-semibold">Agreement:</span> {app.agreementStatus}{app.agreementAcceptance?.acceptedAt ? ` · ${app.agreementAcceptance.acceptedAt}` : ''}</div>}
        <VoteSection serverId={serverId} appId={app.id} status={app.status} />
        <div className="flex gap-2 pt-1">
          {app.status === 'pending' && <>
            <Button size="sm" onClick={() => onUpdateStatus(app.id, 'approved')} disabled={!canDecide} title={canDecide ? undefined : 'Only the owner can make final decisions'}><CheckCircle className="h-4 w-4 mr-1" />Approve</Button>
            <Button size="sm" variant="destructive" onClick={() => onUpdateStatus(app.id, 'rejected')} disabled={!canDecide} title={canDecide ? undefined : 'Only the owner can make final decisions'}><XCircle className="h-4 w-4 mr-1" />Reject</Button>
          </>}
          {app.status === 'approved' && app.agreementStatus !== 'accepted' && <Button size="sm" variant="outline" onClick={() => onUpdateStatus(app.id, 'approved')} disabled={!canDecide}>Resend agreement</Button>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ApplicationsPage() {
  const [serverId, setServerId] = React.useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = React.useState('');
  const [applicationView, setApplicationView] = React.useState<ApplicationView>('pending');
  const [isPosting, setIsPosting] = React.useState(false);
  const [isSavingTemplates, setIsSavingTemplates] = React.useState(false);
  const [isPostingProposal, setIsPostingProposal] = React.useState(false);
  const [templates, setTemplates] = React.useState<DmTemplates>(DEFAULT_TEMPLATES);
  const [proposal, setProposal] = React.useState<ProposalFormState>({ audience: 'community', channelId: '', title: '', description: '', approveLabel: 'Approve', denyLabel: 'Deny', approveEmoji: '✅', denyEmoji: '❌', referenceUrl: '', color: '#5865F2' });
  const { toast } = useToast();
  const { user, isOwner } = useCurrentUser();

  React.useEffect(() => { setServerId(localStorage.getItem('discordServerId')); }, []);
  const { data: channelsData } = useDbDoc<{ list: any[] }>(serverId ? `servers/${serverId}/config/channels` : null);
  const channels = channelsData?.list ?? [];
  const { data: applications, refetch: refetchApplications } = useDbCollection<any>(serverId ? `servers/${serverId}/applications` : null);
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
    if (!isOwner || !user?.id) { toast({ title: 'Owner approval required', description: 'Admins can vote, but only the owner can approve or reject.', variant: 'destructive' }); return; }
    try {
      const app = applications?.find(a => a.id === appId);
      if (!app) return;
      const decision = await fetch('/api/applications/decision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serverId, applicationId: appId, reviewerId: user.id, status }) });
      if (!decision.ok) { const data = await decision.json().catch(() => ({})); throw new Error(data.error || 'Decision failed'); }
      const notify = await fetch('/api/applications/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serverId, applicationId: appId, userId: app.userId, type: app.type, status }) });
      if (!notify.ok) throw new Error('Decision saved, but DM notification failed');
      toast({ title: `Application ${status}`, description: 'Moved to the Application Vault and user notified via DM' });
      refetchApplications();
    } catch (error) { toast({ title: 'Error', description: error instanceof Error ? error.message : 'Could not update application', variant: 'destructive' }); }
  };

  const saveTemplates = async () => {
    if (!serverId) return;
    setIsSavingTemplates(true);
    try { await dbSet(`servers/${serverId}/config/dmTemplates`, templates); toast({ title: 'DM templates saved!' }); }
    catch { toast({ title: 'Error saving templates', variant: 'destructive' }); }
    finally { setIsSavingTemplates(false); }
  };

  const postProposal = async () => {
    if (!serverId || !user?.id || !proposal.channelId || !proposal.title || !proposal.description) { toast({ title: 'Proposal missing fields', description: 'Choose a channel and add a title and description.', variant: 'destructive' }); return; }
    setIsPostingProposal(true);
    try {
      const res = await fetch('/api/proposals/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...proposal, serverId, authorId: user.id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to post proposal');
      toast({ title: 'Proposal posted', description: 'Discord voting reactions were added.' });
      setProposal(p => ({ ...p, title: '', description: '', referenceUrl: '' }));
    } catch (error) { toast({ title: 'Proposal failed', description: error instanceof Error ? error.message : 'Could not post proposal', variant: 'destructive' }); }
    finally { setIsPostingProposal(false); }
  };

  const filteredApplications = (applications || []).filter(app => applicationView === 'archived' ? app.status === 'approved' || app.status === 'rejected' : app.status === applicationView);
  const modApps = filteredApplications.filter(app => app.type === 'mod');
  const partnerApps = filteredApplications.filter(app => app.type === 'partner');
  const devApps = filteredApplications.filter(app => app.type === 'dev');
  const emptyLabel = applicationView === 'pending' ? 'No pending applications' : 'No applications in this vault view';

  return (
    <AdminGuard>
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><h1 className="text-3xl font-bold">Applications</h1><p className="text-muted-foreground">Review active requests and look up completed decisions in the Application Vault.</p></div>
          <div className="w-full sm:w-64 space-y-2">
            <Label htmlFor="application-view" className="flex items-center gap-2"><Archive className="h-4 w-4" />Queue / Vault</Label>
            <Select value={applicationView} onValueChange={(value: ApplicationView) => setApplicationView(value)}>
              <SelectTrigger id="application-view"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending / Active review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="archived">All archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Tabs defaultValue="mod" className="space-y-4">
              <TabsList><TabsTrigger value="mod">Mod ({modApps.length})</TabsTrigger><TabsTrigger value="partner">Partner ({partnerApps.length})</TabsTrigger><TabsTrigger value="dev">Developer ({devApps.length})</TabsTrigger></TabsList>
              <TabsContent value="mod" className="space-y-4">{modApps.length === 0 ? <Card><CardContent className="py-8 text-center text-muted-foreground">{emptyLabel}</CardContent></Card> : modApps.map(app => <ApplicationCard key={app.id} app={app} serverId={serverId!} type="mod" onUpdateStatus={updateStatus} canDecide={isOwner} />)}</TabsContent>
              <TabsContent value="partner" className="space-y-4">{partnerApps.length === 0 ? <Card><CardContent className="py-8 text-center text-muted-foreground">{emptyLabel}</CardContent></Card> : partnerApps.map(app => <ApplicationCard key={app.id} app={app} serverId={serverId!} type="partner" onUpdateStatus={updateStatus} canDecide={isOwner} />)}</TabsContent>
              <TabsContent value="dev" className="space-y-4">{devApps.length === 0 ? <Card><CardContent className="py-8 text-center text-muted-foreground">{emptyLabel}</CardContent></Card> : devApps.map(app => <ApplicationCard key={app.id} app={app} serverId={serverId!} type="dev" onUpdateStatus={updateStatus} canDecide={isOwner} />)}</TabsContent>
            </Tabs>
          </div>

          <div className="space-y-4">
            <Card><CardHeader className="pb-3"><CardTitle className="text-base">Post Application Embed</CardTitle></CardHeader><CardContent className="space-y-3"><Select value={selectedChannel} onValueChange={setSelectedChannel}><SelectTrigger><SelectValue placeholder="Channel" /></SelectTrigger><SelectContent>{channels.map((ch: any) => <SelectItem key={ch.id} value={ch.id}>#{ch.name}</SelectItem>)}</SelectContent></Select><Button onClick={postEmbed} disabled={isPosting || !selectedChannel} className="w-full" size="sm">{isPosting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}Post Embed</Button></CardContent></Card>

            <Accordion type="single" collapsible><AccordionItem value="templates" className="border rounded-lg"><AccordionTrigger className="px-4 py-3 text-sm"><span className="flex items-center gap-2"><Settings2 className="h-4 w-4" />DM Message Templates</span></AccordionTrigger><AccordionContent className="px-4 pb-4 space-y-4">
              {(['modApproved','modRejected','partnerApproved','partnerRejected','devApproved','devRejected'] as const).map(key => <div className="space-y-2" key={key}><Label className="text-xs">{key.replace(/([A-Z])/g, ' $1')}</Label><Textarea value={templates[key]} onChange={e => setTemplates(t => ({...t, [key]: e.target.value}))} rows={3} className="text-xs" /></div>)}
              <Button onClick={saveTemplates} disabled={isSavingTemplates} size="sm" className="w-full">{isSavingTemplates ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Save className="h-3 w-3 mr-2" />}Save Templates</Button>
            </AccordionContent></AccordionItem></Accordion>

            <Card><CardHeader className="pb-3"><CardTitle className="text-base">Post Proposal Vote</CardTitle><CardDescription>Create separate admin-only, targeted, or community proposal embeds.</CardDescription></CardHeader><CardContent className="space-y-3">
              <Select value={proposal.audience} onValueChange={(value: ProposalFormState['audience']) => setProposal(p => ({ ...p, audience: value }))}><SelectTrigger><SelectValue placeholder="Audience" /></SelectTrigger><SelectContent><SelectItem value="community">Full community</SelectItem><SelectItem value="admin">Admin-only</SelectItem><SelectItem value="targeted">Targeted group</SelectItem></SelectContent></Select>
              <Select value={proposal.channelId} onValueChange={channelId => setProposal(p => ({ ...p, channelId }))}><SelectTrigger><SelectValue placeholder="Proposal channel" /></SelectTrigger><SelectContent>{channels.map((ch: any) => <SelectItem key={ch.id} value={ch.id}>#{ch.name}</SelectItem>)}</SelectContent></Select>
              <Input value={proposal.title} onChange={e => setProposal(p => ({ ...p, title: e.target.value }))} placeholder="Proposal title" /><Textarea value={proposal.description} onChange={e => setProposal(p => ({ ...p, description: e.target.value }))} rows={4} placeholder="What changed, why it matters, and what people are voting on." /><Input value={proposal.referenceUrl} onChange={e => setProposal(p => ({ ...p, referenceUrl: e.target.value }))} placeholder="Optional notes/image/resource URL" />
              <div className="grid grid-cols-2 gap-2"><Input value={proposal.approveEmoji} onChange={e => setProposal(p => ({ ...p, approveEmoji: e.target.value }))} placeholder="Approve emoji" /><Input value={proposal.denyEmoji} onChange={e => setProposal(p => ({ ...p, denyEmoji: e.target.value }))} placeholder="Deny emoji" /><Input value={proposal.approveLabel} onChange={e => setProposal(p => ({ ...p, approveLabel: e.target.value }))} placeholder="Approve label" /><Input value={proposal.denyLabel} onChange={e => setProposal(p => ({ ...p, denyLabel: e.target.value }))} placeholder="Deny label" /></div>
              <Input value={proposal.color} onChange={e => setProposal(p => ({ ...p, color: e.target.value }))} placeholder="#5865F2" /><Button onClick={postProposal} disabled={isPostingProposal || !proposal.channelId || !proposal.title || !proposal.description} className="w-full" size="sm">{isPostingProposal ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}Post Proposal</Button>
            </CardContent></Card>
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}
