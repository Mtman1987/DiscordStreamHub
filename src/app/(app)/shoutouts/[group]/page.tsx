'use client';

import * as React from 'react';
import { useParams, usePathname } from 'next/navigation';
import { collection, doc, updateDoc, query, where } from 'firebase/firestore';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { PageHeader } from '@/components/page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { UserProfile } from '@/lib/types';
import { Pencil, Trash2, ArrowLeft, Loader2, Rocket, Users, Clock, Trophy, Send, WandSparkles, XCircle, CheckCircle, PlayCircle, Star, PlusCircle, UserPlus, Layers } from 'lucide-react';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { generateAllShoutoutsAction, updateUserGroupAction, updateUsersByRoleAction } from '@/lib/actions';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { CommunitySpotlight } from './_components/community-spotlight';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';


// Simple row for Raid Train, Raid Pile
function StreamerRow({
  streamer,
  onEdit,
  onRemove,
}: {
  streamer: UserProfile;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-4 py-3 border-b">
      <div className="relative">
        <Avatar>
          <AvatarImage src={streamer.avatarUrl} alt={streamer.username} />
          <AvatarFallback>{streamer.username.charAt(0)}</AvatarFallback>
        </Avatar>
        <div
          className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card ${
            streamer.isOnline ? 'bg-green-500' : 'bg-gray-400'
          }`}
        />
      </div>
      <div className="flex-1">
        <p className="font-medium">{streamer.username}</p>
        <p className="text-sm text-muted-foreground truncate">
          {streamer.isOnline ? streamer.topic || 'Online' : 'Offline'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
          <span className="sr-only">Edit</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">Remove</span>
        </Button>
      </div>
    </div>
  );
}


// --- Components for the "Community" page layout ---

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full md:w-auto">
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <WandSparkles className="mr-2 h-4 w-4" />
      )}
      Generate Shoutouts for All Online Members
    </Button>
  );
}

function OnlineStreamerCard({ streamer }: { streamer: UserProfile }) {
  const handlePostShoutout = () => {
    // This will eventually be a server action
    if (streamer.dailyShoutout) {
      console.log('--- Posting Shoutout for', streamer.username, '---');
      console.log(JSON.stringify(streamer.dailyShoutout, null, 2));
      alert(`Shoutout for ${streamer.username} logged to console!`);
    } else {
      alert(`No AI-generated shoutout available for ${streamer.username}.`);
    }
  };

  // Placeholder data
  const viewerCount = Math.floor(Math.random() * 500) + 50;
  const uptime = `${Math.floor(Math.random() * 4) + 1}h ${Math.floor(Math.random() * 60)}m`;
  const points = Math.floor(Math.random() * 1500) + 200;

  return (
    <Card className="flex flex-col">
      <CardHeader className="p-4">
        <div className="flex items-start gap-4">
          <Avatar className="h-12 w-12 border-2 border-green-500">
            <AvatarImage src={streamer.avatarUrl} alt={streamer.username} />
            <AvatarFallback>{streamer.username.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <CardTitle>
              <Link
                href={`https://twitch.tv/${streamer.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {streamer.username}
              </Link>
            </CardTitle>
            <CardDescription className="truncate">
              {streamer.topic || 'Streaming now!'}
            </CardDescription>
          </div>
          <Rocket className="h-6 w-6 text-primary" />
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-4 flex-1">
        <div className="aspect-video w-full overflow-hidden rounded-md">
            <Image
                src={`https://picsum.photos/seed/stream-${streamer.discordUserId}/400/225`}
                alt={`Stream preview for ${streamer.username}`}
                width={400}
                height={225}
                className="object-cover w-full h-full"
            />
        </div>
        <div className="bg-muted/50 p-3 rounded-md text-sm text-muted-foreground h-full">
          <p className="line-clamp-3">
            {streamer.dailyShoutout?.description || 'Click "Generate Shoutouts" to create a unique message.'}
          </p>
        </div>
      </CardContent>
      <CardFooter className="flex-col items-start gap-4 p-4 pt-0">
         <div className="grid grid-cols-3 gap-2 w-full text-xs text-center">
            <div className="flex flex-col items-center gap-1 bg-secondary p-2 rounded-md">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">{viewerCount}</span>
                <span className="text-muted-foreground">Viewers</span>
            </div>
             <div className="flex flex-col items-center gap-1 bg-secondary p-2 rounded-md">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">{uptime}</span>
                <span className="text-muted-foreground">Uptime</span>
            </div>
             <div className="flex flex-col items-center gap-1 bg-secondary p-2 rounded-md">
                <Trophy className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">{points.toLocaleString()}</span>
                <span className="text-muted-foreground">Points</span>
            </div>
        </div>
        <Button onClick={handlePostShoutout} className="w-full">
            <Send className="mr-2 h-4 w-4" />
            Post Individual Shoutout
        </Button>
      </CardFooter>
    </Card>
  );
}

function OfflineStreamerTile({ streamer }: { streamer: UserProfile }) {
    return (
        <div className="flex flex-col items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors">
            <Avatar className="h-12 w-12">
                <AvatarImage src={streamer.avatarUrl} alt={streamer.username} />
                <AvatarFallback>{streamer.username.charAt(0)}</AvatarFallback>
            </Avatar>
            <p className="text-xs text-center font-medium truncate w-full">{streamer.username}</p>
        </div>
    )
}

// --- Components for the "VIP" page layout ---
const mockVipClip = {
    gifUrl: "https://media.tenor.com/yG_mD8bW32EAAAAd/star-wars-celebration-lightsaber.gif",
};

function VipMemberCard({ streamer }: { streamer: UserProfile }) {
    const { toast } = useToast();
    const firestore = useFirestore();
    const [serverId, setServerId] = React.useState<string | null>(null);
    const [discordLink, setDiscordLink] = React.useState(streamer.partnerDiscordLink || 'https://discord.gg/spacemountain');
    const [isSavingLink, setIsSavingLink] = React.useState(false);

    React.useEffect(() => {
        const storedServerId = localStorage.getItem('discordServerId');
        if (storedServerId) setServerId(storedServerId);
    }, []);

    const handleSaveDiscordLink = async () => {
        if (!firestore || !serverId || !streamer.id) return;
        
        setIsSavingLink(true);
        try {
            const userDocRef = doc(firestore, 'servers', serverId, 'users', streamer.id);
            await updateDoc(userDocRef, { partnerDiscordLink: discordLink });
            toast({ title: 'Success', description: 'Discord link saved!' });
        } catch (error) {
            console.error('Failed to save Discord link:', error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not save Discord link.' });
        } finally {
            setIsSavingLink(false);
        }
    };

    const handlePostShoutout = () => {
        // This will eventually be a server action
        if (streamer.dailyShoutout) {
            console.log('--- Posting Partner Shoutout for', streamer.username, '---');
            console.log(JSON.stringify(streamer.dailyShoutout, null, 2));
            alert(`Partner Shoutout for ${streamer.username} logged to console!`);
        } else {
            alert(`No AI-generated shoutout available for ${streamer.username}.`);
        }
    };
    
    // Placeholder data
    const viewerCount = Math.floor(Math.random() * 500) + 50;
    const uptime = `${Math.floor(Math.random() * 4) + 1}h ${Math.floor(Math.random() * 60)}m`;
    const points = Math.floor(Math.random() * 1500) + 200;

    return (
        <Card className="grid md:grid-cols-12 overflow-hidden">
            <div className="md:col-span-5 relative aspect-video md:aspect-auto w-full h-full group border-r-2">
                 <Image
                    src={mockVipClip.gifUrl}
                    alt={`Twitch clip from ${streamer.username}`}
                    layout="fill"
                    objectFit="cover"
                    unoptimized // GIFs should not be optimized by Next/image
                />
                <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <PlayCircle className="h-12 w-12 text-white/70 group-hover:text-white group-hover:scale-110 transition-transform" />
                </div>
                <Badge className="absolute top-2 right-2" variant="destructive">Featured Clip</Badge>
            </div>

            <div className="md:col-span-7 flex flex-col p-4">
                <CardHeader className="p-0">
                    <div className="flex items-start gap-4">
                         <Avatar className={`h-14 w-14 border-4 ${streamer.isOnline ? 'border-green-500' : 'border-gray-400'}`}>
                            <AvatarImage src={streamer.avatarUrl} alt={streamer.username} />
                            <AvatarFallback>{streamer.username.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                            <CardTitle className="flex items-center gap-2 text-2xl">
                               <Star className="h-6 w-6 text-yellow-400" />
                                <Link href={`https://twitch.tv/${streamer.username}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                    {streamer.username}
                                </Link>
                            </CardTitle>
                            <CardDescription className="truncate">
                               {streamer.isOnline ? streamer.topic || 'Streaming now!' : 'Offline'}
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0 mt-4 flex-1 space-y-4">
                    <div className="bg-muted/50 p-3 rounded-md text-sm text-muted-foreground flex-1">
                        <p className="line-clamp-4">
                            {streamer.dailyShoutout?.description || 'A unique shoutout message will be generated when this partner goes live.'}
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor={`discord-link-${streamer.id}`} className="text-xs">Partner Discord Link</Label>
                        <div className="flex gap-2">
                            <Input
                                id={`discord-link-${streamer.id}`}
                                value={discordLink}
                                onChange={(e) => setDiscordLink(e.target.value)}
                                placeholder="https://discord.gg/spacemountain"
                                className="text-sm"
                            />
                            <Button
                                size="sm"
                                onClick={handleSaveDiscordLink}
                                disabled={isSavingLink}
                            >
                                {isSavingLink ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                            </Button>
                        </div>
                    </div>
                     <div className="grid grid-cols-3 gap-2 w-full text-xs text-center">
                        <div className="flex flex-col items-center gap-1 bg-secondary p-2 rounded-md">
                            <Users className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold">{viewerCount}</span>
                            <span className="text-muted-foreground">Viewers</span>
                        </div>
                        <div className="flex flex-col items-center gap-1 bg-secondary p-2 rounded-md">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold">{uptime}</span>
                            <span className="text-muted-foreground">Uptime</span>
                        </div>
                        <div className="flex flex-col items-center gap-1 bg-secondary p-2 rounded-md">
                            <Trophy className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold">{points.toLocaleString()}</span>
                            <span className="text-muted-foreground">Points</span>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="p-0 mt-4">
                     <Button onClick={handlePostShoutout} className="w-full">
                        <Send className="mr-2 h-4 w-4" />
                        Post Partner Shoutout
                    </Button>
                </CardFooter>
            </div>
        </Card>
    )
}

function FormSubmitButton({ children, ...props }: React.ComponentProps<typeof Button>) {
    const { pending } = useFormStatus();
    return (
        <Button {...props} type="submit" disabled={pending}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : children}
        </Button>
    )
}

// Dialog for adding/managing members to groups
function ManageMembersDialog({ groupName, communityMembers, allRoles, serverId, currentPath }: { groupName: string, communityMembers: UserProfile[], allRoles: string[], serverId: string, currentPath: string }) {
    const { toast } = useToast();
    const [open, setOpen] = React.useState(false);
    
    const [promoteState, promoteAction] = useActionState(updateUserGroupAction, { status: 'idle', message: '' });
    const [roleState, roleAction] = useActionState(updateUsersByRoleAction, { status: 'idle', message: '' });
    
    const promoteFormRef = React.useRef<HTMLFormElement>(null);
    const roleFormRef = React.useRef<HTMLFormElement>(null);

    React.useEffect(() => {
        if (promoteState.status === 'success') {
            toast({ title: 'Success!', description: promoteState.message });
            setOpen(false);
        } else if (promoteState.status === 'error') {
            toast({ variant: 'destructive', title: 'Error', description: promoteState.message });
        }
    }, [promoteState, toast]);
    
    React.useEffect(() => {
        if (roleState.status === 'success') {
            toast({ title: 'Success!', description: roleState.message });
            setOpen(false);
        } else if (roleState.status === 'error') {
            toast({ variant: 'destructive', title: 'Error', description: roleState.message });
        }
    }, [roleState, toast]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Manage Members
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Manage {groupName} Members</DialogTitle>
                    <DialogDescription>
                        Assign members to the {groupName} group individually or by their Discord role.
                    </DialogDescription>
                </DialogHeader>

                {/* Promote Single Member (not for Community page) */}
                {groupName !== 'Community' && (
                    <form ref={promoteFormRef} action={promoteAction} className="space-y-4 rounded-lg border p-4">
                         <input type="hidden" name="serverId" value={serverId} />
                         <input type="hidden" name="newGroup" value={groupName} />
                         <input type="hidden" name="currentPath" value={currentPath} />
                        <h3 className="font-semibold flex items-center gap-2"><UserPlus className="h-5 w-5" /> Promote a Member</h3>
                        <div className="grid gap-2">
                            <Label htmlFor="member-select">Select Member from Community</Label>
                            <Select name="userId" required>
                                <SelectTrigger id="member-select">
                                    <SelectValue placeholder="Choose a community member..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {communityMembers.length > 0 ? (
                                        communityMembers.map(member => (
                                            <SelectItem key={member.discordUserId} value={member.id}>
                                                {member.username}
                                            </SelectItem>
                                        ))
                                    ) : (
                                        <SelectItem value="loading" disabled>No community members found</SelectItem>
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                        <DialogFooter>
                            <FormSubmitButton>Promote to {groupName}</FormSubmitButton>
                        </DialogFooter>
                    </form>
                )}


                 {/* Assign by Role */}
                <form ref={roleFormRef} action={roleAction} className="space-y-4 rounded-lg border p-4">
                    <input type="hidden" name="serverId" value={serverId} />
                    <input type="hidden" name="newGroup" value={groupName} />
                    <input type="hidden" name="currentPath" value={currentPath} />
                    <h3 className="font-semibold flex items-center gap-2"><Layers className="h-5 w-5" /> Assign Members by Role</h3>
                     <div className="grid gap-2">
                        <Label htmlFor="role-select">Select Discord Role</Label>
                        <Select name="roleName" required>
                             <SelectTrigger id="role-select">
                                <SelectValue placeholder="Choose a role..." />
                            </SelectTrigger>
                            <SelectContent>
                                {allRoles.length > 0 ? (
                                    allRoles.map(role => (
                                        <SelectItem key={role} value={role}>
                                            {role}
                                        </SelectItem>
                                    ))
                                ) : (
                                    <SelectItem value="loading" disabled>No roles found. Sync server first.</SelectItem>
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <FormSubmitButton>Assign by Role</FormSubmitButton>
                    </DialogFooter>
                </form>

            </DialogContent>
        </Dialog>
    )
}


// Main component that renders different layouts based on group
export default function GroupDetailPage() {
  const params = useParams();
  const pathname = usePathname();
  const { toast } = useToast();
  const firestore = useFirestore();
  const [serverId, setServerId] = React.useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = React.useState<string>('');
  const [isSavingChannel, setIsSavingChannel] = React.useState(false);
  const [channels, setChannels] = React.useState<Array<{id: string, name: string}>>([]);

  const group = Array.isArray(params.group) ? params.group[0] : params.group;
  const isCommunityPage = group === 'community';
  const isPartnersPage = group === 'partners';
  const isCrewPage = group === 'crew';

  const groupName =
    group === 'crew' ? 'Crew' :
    group === 'partners' ? 'Partners' :
    group === 'community' ? 'Community' :
    group === 'raid-train' ? 'Raid Train' :
    group === 'raid-pile' ? 'Raid Pile' :
    'Unknown';

  console.log('[GroupPage] URL group param:', group, '→ groupName:', groupName);

  const [editingStreamer, setEditingStreamer] = React.useState<UserProfile | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  
  // Conditionally declare the hook only for the community page
  const [generateState, formAction] = isCommunityPage 
    ? useActionState(generateAllShoutoutsAction, { status: 'idle', results: [], error: undefined })
    : [{ status: 'idle', results: [], error: undefined }, () => {}];

  React.useEffect(() => {
    const storedServerId = localStorage.getItem('discordServerId');
    if (storedServerId) {
      setServerId(storedServerId);
      
      // Load channels
      if (firestore) {
        const channelsRef = doc(firestore, 'servers', storedServerId, 'config', 'channels');
        import('firebase/firestore').then(async ({ getDoc }) => {
          const docSnap = await getDoc(channelsRef);
          if (docSnap.exists()) {
            const channelList = docSnap.data().list || [];
            console.log('[GroupPage] Loaded channels:', channelList);
            setChannels(channelList);
          } else {
            console.log('[GroupPage] No channels document found');
          }
        });
        
        // Load saved channel for this group
        const groupConfigRef = doc(firestore, 'servers', storedServerId, 'config', 'groupChannels');
        import('firebase/firestore').then(async ({ getDoc }) => {
          const docSnap = await getDoc(groupConfigRef);
          if (docSnap.exists()) {
            const savedChannel = docSnap.data()[groupName];
            if (savedChannel) setSelectedChannelId(savedChannel);
          }
        });
      }
    }
  }, [firestore, groupName]);

  // Fetch all users for the server once.
  const usersCollectionRef = useMemoFirebase(() => {
    if (!firestore || !serverId) return null;
    return collection(firestore, 'servers', serverId, 'users');
  }, [firestore, serverId]);

  const { data: allUsers, isLoading: isLoadingUsers } = useCollection<UserProfile>(usersCollectionRef);

  // Memoize filtered lists based on allUsers
  const { members, onlineUsers, offlineUsers, communityMembers, allRoles } = React.useMemo(() => {
    let mutableUsers = allUsers ? [...allUsers] : [];

    const groupMembers = mutableUsers.filter((u) => {
      return u.group === groupName;
    });
    const online = groupMembers.filter(u => u.isOnline);
    const offline = groupMembers.filter(u => !u.isOnline);
    const community = mutableUsers.filter(u => u.group === 'Community');

    // Extract all unique roles from all users
    const roles = new Set<string>();
    mutableUsers.forEach(user => {
        user.roles?.forEach(role => roles.add(role));
    });
    const sortedRoles = Array.from(roles).sort();

    return { members: groupMembers, onlineUsers: online, offlineUsers: offline, communityMembers: community, allRoles: sortedRoles };
  }, [allUsers, groupName, isPartnersPage, isLoadingUsers]);


  const handleSaveChannel = async () => {
    if (!firestore || !serverId || !selectedChannelId) return;
    
    setIsSavingChannel(true);
    try {
      const groupConfigRef = doc(firestore, 'servers', serverId, 'config', 'groupChannels');
      await import('firebase/firestore').then(({ setDoc }) => 
        setDoc(groupConfigRef, { [groupName]: selectedChannelId }, { merge: true })
      );
      toast({ title: 'Success', description: `Channel saved for ${groupName} group.` });
    } catch (error) {
      console.error('Failed to save channel:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not save channel.' });
    } finally {
      setIsSavingChannel(false);
    }
  };

  const handleEditClick = (streamer: UserProfile) => {
    setEditingStreamer(streamer);
  };

  const handleRemoveClick = async (streamer: UserProfile) => {
    if (!firestore || !serverId) return;
    if (!streamer.id) {
        toast({
            variant: 'destructive',
            title: 'Error',
            description: 'Cannot reassign a user without a document ID.'
        });
        return;
    }

    try {
      const userDocRef = doc(firestore, 'servers', serverId, 'users', streamer.id);
      await updateDoc(userDocRef, { group: 'Community' });
      toast({
        title: 'Member Reassigned',
        description: `${streamer.username} has been moved back to the Community group.`,
      });
    } catch (error) {
      console.error('Failed to remove member from group:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not reassign member.',
      });
    }
  };

  const handleSaveChanges = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingStreamer || !firestore || !serverId) return;

    setIsSaving(true);
    const formData = new FormData(e.currentTarget);
    const updatedUsername = formData.get('username') as string;
    const updatedTopic = formData.get('topic') as string;

    if (!editingStreamer.id) {
        toast({
            variant: 'destructive',
            title: 'Error',
            description: 'Cannot update a user without a document ID.'
        });
        setIsSaving(false);
        return;
    }

    try {
        const userDocRef = doc(firestore, 'servers', serverId, 'users', editingStreamer.id);
        await updateDoc(userDocRef, {
            username: updatedUsername,
            topic: updatedTopic,
        });
        toast({
            title: "Success",
            description: "Streamer details updated."
        })
        setEditingStreamer(null);
    } catch (error) {
        console.error('Failed to save changes:', error);
        toast({
            variant: 'destructive',
            title: 'Error',
            description: 'Could not save changes.'
        });
    } finally {
        setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title={`${groupName} Group`}
        description={`Manage the members and shoutouts for the ${groupName} group.`}
      >
        <div className="flex items-center gap-2">
          <Select value={selectedChannelId} onValueChange={setSelectedChannelId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select channel..." />
            </SelectTrigger>
            <SelectContent>
              {channels.map(channel => (
                <SelectItem key={channel.id} value={channel.id}>
                  #{channel.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleSaveChannel} disabled={isSavingChannel || !selectedChannelId}>
            {isSavingChannel ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Channel
          </Button>
        </div>
        {serverId && <ManageMembersDialog groupName={groupName} communityMembers={communityMembers} allRoles={allRoles} serverId={serverId} currentPath={pathname} />}
        <Button asChild variant="outline">
          <Link href="/shoutouts">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Shoutouts Hub
          </Link>
        </Button>
      </PageHeader>
      
      {isLoadingUsers && (
        <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-48 w-full" />
            ))}
        </div>
      )}

      {/* RENDER CREW LAYOUT */}
      {!isLoadingUsers && isCrewPage && (
        <div className="space-y-8">
            {/* Online Crew */}
            <div>
                <h2 className="text-2xl font-headline text-primary mb-2">
                    Online Crew ({onlineUsers.length})
                </h2>
                <p className="text-muted-foreground">
                    Space Mountain crew and staff members, currently live.
                </p>
            </div>
            {onlineUsers.length > 0 ? (
                <div className="grid grid-cols-1 gap-6">
                    {onlineUsers.map(streamer => (
                        <VipMemberCard key={streamer.id} streamer={streamer} />
                    ))}
                </div>
            ) : (
                 <Card className="flex flex-col items-center justify-center py-20 text-center">
                    <CardHeader>
                        <Star className="mx-auto h-12 w-12 text-muted-foreground" />
                        <CardTitle className="mt-4">No Crew Currently Live</CardTitle>
                        <CardDescription>When a crew member goes live, their card will appear here.</CardDescription>
                    </CardHeader>
                </Card>
            )}

            <Separator />
            
            {/* Offline Crew */}
            <Accordion type="single" collapsible className="w-full" defaultValue="offline-vips">
                <AccordionItem value="offline-vips">
                    <AccordionTrigger>
                        <div className="flex flex-col items-start">
                            <h2 className="text-2xl font-headline text-primary">
                                Offline Crew ({offlineUsers.length})
                            </h2>
                            <p className="text-sm text-muted-foreground font-normal">
                                Click to see all offline crew members.
                            </p>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent>
                        <Card>
                            <CardContent className="p-4">
                                <ScrollArea className="h-72">
                                    {offlineUsers.length > 0 ? (
                                        <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-x-4 gap-y-6 pr-4">
                                        {offlineUsers.map((streamer) => (
                                            <OfflineStreamerTile key={streamer.id} streamer={streamer} />
                                        ))}
                                        </div>
                                    ) : (
                                        <p className="py-10 text-center text-muted-foreground">
                                        No offline crew found.
                                        </p>
                                    )}
                                </ScrollArea>
                            </CardContent>
                        </Card>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>
      )}

      {/* RENDER PARTNERS LAYOUT */}
      {!isLoadingUsers && isPartnersPage && (
        <div className="space-y-8">
            {/* Online Partners */}
            <div>
                <h2 className="text-2xl font-headline text-primary mb-2">
                    Online Partners ({onlineUsers.length})
                </h2>
                <p className="text-muted-foreground">
                    Your official Cosmic Raid partners, currently live. Each member has a featured clip.
                </p>
            </div>
            {onlineUsers.length > 0 ? (
                <div className="grid grid-cols-1 gap-6">
                    {onlineUsers.map(streamer => (
                        <VipMemberCard key={streamer.id} streamer={streamer} />
                    ))}
                </div>
            ) : (
                 <Card className="flex flex-col items-center justify-center py-20 text-center">
                    <CardHeader>
                        <Star className="mx-auto h-12 w-12 text-muted-foreground" />
                        <CardTitle className="mt-4">No Partners Currently Live</CardTitle>
                        <CardDescription>When a partner goes live, their card will appear here.</CardDescription>
                    </CardHeader>
                </Card>
            )}

            <Separator />
            
            {/* Offline Partners */}
            <Accordion type="single" collapsible className="w-full" defaultValue="offline-vips">
                <AccordionItem value="offline-vips">
                    <AccordionTrigger>
                        <div className="flex flex-col items-start">
                            <h2 className="text-2xl font-headline text-primary">
                                Offline Partners ({offlineUsers.length})
                            </h2>
                            <p className="text-sm text-muted-foreground font-normal">
                                Click to see all offline partner members.
                            </p>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent>
                        <Card>
                            <CardContent className="p-4">
                                <ScrollArea className="h-72">
                                    {offlineUsers.length > 0 ? (
                                        <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-x-4 gap-y-6 pr-4">
                                        {offlineUsers.map((streamer) => (
                                            <OfflineStreamerTile key={streamer.id} streamer={streamer} />
                                        ))}
                                        </div>
                                    ) : (
                                        <p className="py-10 text-center text-muted-foreground">
                                        No offline partners found.
                                        </p>
                                    )}
                                </ScrollArea>
                            </CardContent>
                        </Card>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>
      )}


      {/* RENDER COMMUNITY LAYOUT */}
      {!isLoadingUsers && isCommunityPage && (
        <div className="space-y-8">
          <CommunitySpotlight />

          <div>
            <h2 className="text-2xl font-headline text-primary mb-2">
              Live Dashboard
            </h2>
            <p className="text-muted-foreground">
              Generate and post shoutouts for all currently online members.
            </p>
          </div>
            
           <form action={formAction} className="space-y-6">
            {serverId && <input type="hidden" name="serverId" value={serverId} />}
            <SubmitButton />

            {generateState.status === 'error' && generateState.error && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{generateState.error}</AlertDescription>
              </Alert>
            )}

            {generateState.status === 'success' && generateState.results && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Generation Results:</h3>
                {generateState.results.map((result, index) => (
                  <Alert key={index} variant={result.success ? 'default' : 'destructive'}>
                    {result.success ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    <AlertTitle className='flex items-center gap-2'>
                      {result.streamerName}
                      <Badge variant={result.success ? 'secondary' : 'destructive'}>
                        {result.success ? 'Success' : 'Failed'}
                      </Badge>
                    </AlertTitle>
                    <AlertDescription>
                      {result.message}
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            )}
          </form>

          {onlineUsers.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {onlineUsers.map((streamer) => (
                <OnlineStreamerCard key={streamer.id} streamer={streamer} />
              ))}
            </div>
          ) : (
             <Card className="flex flex-col items-center justify-center py-20 text-center">
                <CardHeader>
                    <Rocket className="mx-auto h-12 w-12 text-muted-foreground" />
                    <CardTitle className="mt-4">All Quiet on the Frontier</CardTitle>
                    <CardDescription>No community members are currently online.</CardDescription>
                </CardHeader>
            </Card>
          )}

          <Separator />

          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="offline-users">
              <AccordionTrigger>
                <div className="flex flex-col items-start">
                    <h2 className="text-2xl font-headline text-primary">
                      Offline Community Members ({offlineUsers.length})
                    </h2>
                    <p className="text-sm text-muted-foreground font-normal">
                      A list of all community members who are currently offline. Click to expand.
                    </p>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <Card>
                  <CardContent className="p-4">
                    <ScrollArea className="h-72">
                      {offlineUsers.length > 0 ? (
                        <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-x-4 gap-y-6 pr-4">
                          {offlineUsers.map((streamer) => (
                            <OfflineStreamerTile key={streamer.id} streamer={streamer} />
                          ))}
                        </div>
                      ) : (
                        <p className="py-10 text-center text-muted-foreground">
                          No offline users found.
                        </p>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}

      {/* RENDER SIMPLE MANAGEMENT LAYOUT for Raid Train, Raid Pile, etc. */}
      {!isLoadingUsers && !isCommunityPage && !isPartnersPage && !isCrewPage && (
        <Card>
          <CardHeader>
            <CardTitle>Group Members ({members.length})</CardTitle>
            <CardDescription>
              The following streamers are in the {groupName} group.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col">
              {members.length > 0 ? members.map((streamer) => (
                <StreamerRow
                  key={streamer.id}
                  streamer={streamer}
                  onEdit={() => handleEditClick(streamer)}
                  onRemove={() => handleRemoveClick(streamer)}
                />
              )) : (
                  <p className="py-10 text-center text-muted-foreground">
                      No members found in this group.
                  </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {editingStreamer && (
        <Dialog
          open={!!editingStreamer}
          onOpenChange={() => setEditingStreamer(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Streamer</DialogTitle>
              <DialogDescription>
                Update the details for {editingStreamer.username}.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSaveChanges}>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="username" className="text-right">
                    Name
                  </Label>
                  <Input
                    id="username"
                    name="username"
                    defaultValue={editingStreamer.username}
                    className="col-span-3"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="topic" className="text-right">
                    Topic
                  </Label>
                  <Input
                    id="topic"
                    name="topic"
                    defaultValue={editingStreamer.topic || ''}
                    className="col-span-3"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingStreamer(null)}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
