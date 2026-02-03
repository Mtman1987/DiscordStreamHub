'use client';

import * as React from 'react';
import { useActionState } from 'react';
import {
  collection,
  doc,
  setDoc,
  query,
  orderBy,
  limit,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { useCollection, useDoc, useFirestore, useUser, useMemoFirebase } from '@/firebase';
import { PageHeader } from '@/components/page-header';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Hash, Save, Trash2, ArrowRight, Server, MessageSquareReply, Send, CornerDownRight } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { DiscordServer, DiscordMessage, UserProfile } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { replyToMessageAction } from '@/lib/actions';
import Image from 'next/image';

interface DiscordChannel {
  id: string;
  name: string;
}

interface ForwardingRule {
  id: string;
  sourceChannel: string;
  targetServer: string;
  targetChannel: string;
}

interface ForwardingRulesDoc {
  rules: ForwardingRule[];
}

function ReplyForm({ message, serverId, userProfile, onOpenChange }: { message: DiscordMessage, serverId: string, userProfile: UserProfile, onOpenChange: (open: boolean) => void }) {
  const [state, formAction] = useActionState(replyToMessageAction, { status: 'idle', message: '' });
  const formRef = React.useRef<HTMLFormElement>(null);
  const { toast } = useToast();

  React.useEffect(() => {
    if (state.status === 'success') {
      toast({ title: 'Success!', description: state.message });
      onOpenChange(false);
    } else if (state.status === 'error') {
      toast({ variant: 'destructive', title: 'Error', description: state.message });
    }
  }, [state, toast, onOpenChange]);

  if (!userProfile) return <p>Loading user profile...</p>;

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-4"
    >
      {/* Hidden fields for server action */}
      <input type="hidden" name="messageId" value={message.id} />
      <input type="hidden" name="serverId" value={serverId} />
      <input type="hidden" name="channelId" value={message.channelId} />
      <input type="hidden" name="replierId" value={userProfile.discordUserId} />
      <input type="hidden" name="replierName" value={userProfile.username} />
      <input type="hidden" name="replierAvatar" value={userProfile.avatarUrl} />
      <input type="hidden" name="originalAuthorName" value={message.originalAuthor.name} />

      <Textarea
        name="replyText"
        placeholder={`Reply to ${message.originalAuthor.name}...`}
        required
        className="min-h-[100px]"
      />
      <DialogFooter>
        <Button type="submit">
          <Send className="mr-2 h-4 w-4" /> Post Reply
        </Button>
      </DialogFooter>
    </form>
  )
}

function ParsedMessageContent({ content, userMap }: { content: string, userMap: Map<string, string> }) {
  // Guard against null or undefined content
  if (!content) {
    return null;
  }

  const parts = React.useMemo(() => {
    // Regex for mentions, animated emojis, static emojis, and URLs
    const combinedRegex = /(<@(\d+)>)|(<a?:\w+:(\d+)>)|(https?:\/\/[^\s]+)/g;
    const elements: (string | JSX.Element)[] = [];
    let lastIndex = 0;
    let match;

    while ((match = combinedRegex.exec(content)) !== null) {
      // Add the text before the current match
      if (match.index > lastIndex) {
        elements.push(content.substring(lastIndex, match.index));
      }

      const [fullMatch, mention, userId, emoji, emojiId, url] = match;

      // It's a user mention
      if (mention && userId) {
        const username = userMap.get(userId);
        elements.push(
          <strong key={`mention-${match.index}`} className="text-primary bg-primary/10 px-1 py-0.5 rounded-sm">
            @{username || 'unknown-user'}
          </strong>
        );
      }
      // It's an emoji (static or animated)
      else if (emoji && emojiId) {
        const isAnimated = fullMatch.startsWith('<a:');
        const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${isAnimated ? 'gif' : 'png'}`;
        elements.push(<Image key={`emoji-${match.index}`} src={emojiUrl} alt={fullMatch} width={20} height={20} className="inline-block mx-0.5" />);
      }
      // It's a URL
      else if (url) {
         if (/\.(gif|jpe?g|png|webp)$/i.test(url)) {
           elements.push(
            <a key={`img-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                <img src={url.startsWith('https') ? `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=300` : url} alt="Embedded content" className="max-w-xs rounded-md" />
            </a>
           );
        } else if (/tenor\.com\/view/.test(url)){
             elements.push(
                <a key={`img-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                    <img src={`${url}.gif`} alt="Tenor GIF" className="max-w-xs rounded-md" />
                </a>
           );
        }
        else {
             elements.push(
                <a key={`url-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline break-all">
                    {url}
                </a>
            );
        }
      }

      lastIndex = match.index + fullMatch.length;
    }

    // Add any remaining text after the last match
    if (lastIndex < content.length) {
      elements.push(content.substring(lastIndex));
    }

    return elements;
  }, [content, userMap]);


  return (
    <div className="text-sm whitespace-pre-wrap grid gap-2">
        <p>{parts}</p>
    </div>
  );
}

export default function ForwardingPage() {
  const firestore = useFirestore();
  const { user, isUserLoading } = useUser();
  const { toast } = useToast();
  const [sourceServerId, setSourceServerId] = React.useState<string | null>(
    null
  );
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);

  const [newRuleSource, setNewRuleSource] = React.useState<string>('');
  const [newRuleTargetServer, setNewRuleTargetServer] =
    React.useState<string>('');
  const [newRuleTargetChannel, setNewRuleTargetChannel] =
    React.useState<string>('');
    
  const [replyingTo, setReplyingTo] = React.useState<DiscordMessage | null>(null);

  const scrollAreaRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const storedServerId = localStorage.getItem('discordServerId');
    const storedUserId = localStorage.getItem('discordUserId');
    if (storedServerId) setSourceServerId(storedServerId);
    if (storedUserId) setCurrentUserId(storedUserId);
  }, []);
  
  const currentUserProfileRef = useMemoFirebase(() => {
    if (!firestore || !sourceServerId || !currentUserId) return null;
    return doc(firestore, 'servers', sourceServerId, 'users', currentUserId);
  }, [firestore, sourceServerId, currentUserId]);

  const { data: currentUserProfile } = useDoc<UserProfile>(currentUserProfileRef);

  const discordsCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'discords');
  }, [firestore]);

  const { data: allServers, isLoading: isLoadingAllServers } =
    useCollection<DiscordServer>(discordsCollectionRef);

  const sourceChannelsConfigRef = useMemoFirebase(() => {
    if (isUserLoading || !firestore || !sourceServerId || !user) return null;
    return doc(firestore, 'servers', sourceServerId, 'config', 'channels');
  }, [firestore, sourceServerId, user, isUserLoading]);

  const { data: sourceChannelsData, isLoading: isLoadingSourceChannels } =
    useDoc<{ list: DiscordChannel[] }>(sourceChannelsConfigRef);
  const sourceChannels = sourceChannelsData?.list || [];
  const sourceChannelMap = React.useMemo(
    () => new Map(sourceChannels.map((c) => [c.id, c.name])),
    [sourceChannels]
  );

  const targetChannelsConfigRef = useMemoFirebase(() => {
    if (isUserLoading || !firestore || !newRuleTargetServer || !user)
      return null;
    return doc(firestore, 'servers', newRuleTargetServer, 'config', 'channels');
  }, [firestore, newRuleTargetServer, user, isUserLoading]);

  const { data: targetChannelsData, isLoading: isLoadingTargetChannels } =
    useDoc<{ list: DiscordChannel[] }>(targetChannelsConfigRef);
  const targetChannels = targetChannelsData?.list || [];

  const rulesDocRef = useMemoFirebase(() => {
    if (isUserLoading || !firestore || !sourceServerId || !user) return null;
    return doc(
      firestore,
      'servers',
      sourceServerId,
      'config',
      'forwardingRules'
    );
  }, [firestore, sourceServerId, user, isUserLoading]);

  const { data: rulesDoc, isLoading: isLoadingRules } =
    useDoc<ForwardingRulesDoc>(rulesDocRef);
  const forwardingRules = rulesDoc?.rules || [];

  const messagesQueryRef = useMemoFirebase(() => {
    if (!firestore || !sourceServerId) return null;
    const messagesCollection = collection(
      firestore,
      'servers',
      sourceServerId,
      'messages'
    );
    return query(messagesCollection, orderBy('timestamp', 'asc'), limit(100));
  }, [firestore, sourceServerId]);

  const { data: messages, isLoading: isLoadingMessages } =
    useCollection<DiscordMessage>(messagesQueryRef);

  const serverUsersQueryRef = useMemoFirebase(() => {
    if (!firestore || !sourceServerId) return null;
    return collection(firestore, 'servers', sourceServerId, 'users');
  }, [firestore, sourceServerId]);

  const { data: serverUsers } = useCollection<UserProfile>(serverUsersQueryRef);

  const userMap = React.useMemo(() => {
    const map = new Map<string, string>();
    if (serverUsers) {
      for (const user of serverUsers) {
        map.set(user.discordUserId, user.username);
      }
    }
    return map;
  }, [serverUsers]);

  React.useEffect(() => {
    if (scrollAreaRef.current) {
        const viewport = scrollAreaRef.current.querySelector('div[data-radix-scroll-area-viewport]');
        if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
        }
    }
  }, [messages]);


  const saveRulesToFirestore = (rules: ForwardingRule[]) => {
    if (!rulesDocRef) return;
    setDoc(rulesDocRef, { rules: rules }, { merge: true })
      .then(() => {
        toast({
          title: 'Rules Saved!',
          description: 'Your forwarding rules have been updated.',
        });
      })
      .catch((error) => {
        console.error('Failed to save rules', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Could not save rules.',
        });
      });
  };

  const handleAddRule = () => {
    if (!newRuleSource || !newRuleTargetServer || !newRuleTargetChannel) {
      toast({
        variant: 'destructive',
        title: 'Missing Information',
        description: 'Please select source, target server, and target channel.',
      });
      return;
    }
    if (
      sourceServerId === newRuleTargetServer &&
      newRuleSource === newRuleTargetChannel
    ) {
      toast({
        variant: 'destructive',
        title: 'Invalid Rule',
        description: 'Source and target cannot be the same.',
      });
      return;
    }

    const newRule: ForwardingRule = {
      id: new Date().getTime().toString(),
      sourceChannel: newRuleSource,
      targetServer: newRuleTargetServer,
      targetChannel: newRuleTargetChannel,
    };
    const updatedRules = [...forwardingRules, newRule];
    saveRulesToFirestore(updatedRules);

    setNewRuleSource('');
    setNewRuleTargetServer('');
    setNewRuleTargetChannel('');
  };

  const handleRemoveRule = (ruleId: string) => {
    const updatedRules = forwardingRules.filter((rule) => rule.id !== ruleId);
    saveRulesToFirestore(updatedRules);
  };

  const getServerName = (serverId: string) =>
    allServers?.find((s) => s.serverId === serverId)?.serverName || serverId;
  const getChannelName = (channelId: string) =>
    sourceChannelMap.get(channelId) || channelId;

  return (
    <div className="flex flex-col h-full space-y-8">
      <PageHeader
        title="Message History & Forwarding"
        description="View incoming messages and manage forwarding rules."
      />
      <div className="grid flex-1 gap-8 lg:grid-cols-3">
        {/* Message History Column */}
        <div className="lg:col-span-2">
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle>Message History</CardTitle>
              <CardDescription>
                A live feed of the last 100 captured messages. Click a message to reply.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden">
              <ScrollArea className="h-[600px] pr-4" ref={scrollAreaRef}>
                <div className="space-y-6">
                  {isLoadingMessages &&
                    Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex items-start gap-4">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="space-y-2 flex-1">
                          <Skeleton className="h-4 w-48" />
                          <Skeleton className="h-4 w-full" />
                        </div>
                      </div>
                    ))}
                  {messages &&
                    messages.map((msg) => (
                      <div key={msg.id} className="group relative" onClick={() => !msg.reply && setReplyingTo(msg)}>
                         <div className="flex items-start gap-4 p-2 rounded-md transition-colors hover:bg-muted/50 cursor-pointer">
                            <Avatar className="h-10 w-10 border">
                              <AvatarImage src={msg.originalAuthor.avatar} />
                              <AvatarFallback>
                                {msg.originalAuthor.name?.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="grid gap-1 flex-1">
                              <div className="flex items-baseline gap-2">
                                <p className="font-semibold">
                                  {msg.originalAuthor.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  (in #{getChannelName(msg.channelId)})
                                </p>
                              </div>
                              <ParsedMessageContent content={msg.messageContent} userMap={userMap} />
                              <p className="text-xs text-muted-foreground">
                                {msg.timestamp ? formatDistanceToNow(
                                  new Date(msg.timestamp.seconds * 1000),
                                  { addSuffix: true }
                                ) : 'sending...'}
                              </p>
                            </div>
                         </div>
                         {!msg.reply && (
                            <div className="absolute top-1 right-1 hidden group-hover:block">
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MessageSquareReply className="h-4 w-4" />
                                </Button>
                            </div>
                         )}

                        {msg.reply && msg.reply.authorName && (
                           <div className="ml-8 mt-2 flex items-start gap-3 rounded-md border bg-muted/20 p-3">
                             <CornerDownRight className="h-4 w-4 mt-1 text-muted-foreground"/>
                             <Avatar className="h-8 w-8 border">
                                <AvatarImage src={msg.reply.authorAvatar} />
                                <AvatarFallback>{msg.reply.authorName.charAt(0) || '?'}</AvatarFallback>
                             </Avatar>
                             <div className="grid gap-1 flex-1">
                                <div className="flex items-baseline gap-2">
                                    <p className="font-semibold">{msg.reply.authorName}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {formatDistanceToNow(
                                          // Check if it's a Firestore Timestamp or a JS Date
                                          msg.reply.timestamp instanceof Timestamp 
                                            ? msg.reply.timestamp.toDate() 
                                            : new Date(msg.reply.timestamp), 
                                          { addSuffix: true }
                                        )}
                                    </p>
                                </div>
                                <p className="text-sm">{msg.reply.text}</p>
                             </div>
                           </div>
                        )}
                      </div>
                    ))}
                  {!isLoadingMessages && messages?.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground pt-10">
                      No messages captured yet.
                    </p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Forwarding Rules Column */}
        <div className="lg:col-span-1">
          <Card>
            <CardContent className="p-4 flex flex-col h-full">
              <h3 className="text-lg font-headline p-2">Create New Rule</h3>
              <div className="p-2 space-y-4 border-b">
                <div className="grid grid-cols-1 items-center gap-4">
                  <div className="space-y-2 flex-1 w-full">
                    <Label
                      htmlFor="source-channel"
                      className="flex items-center gap-2"
                    >
                      <Hash /> From Channel:
                    </Label>
                    <Select value={newRuleSource} onValueChange={setNewRuleSource}>
                      <SelectTrigger id="source-channel">
                        <SelectValue placeholder="Select source" />
                      </SelectTrigger>
                      <SelectContent>
                        {isLoadingSourceChannels ? (
                          <SelectItem value="loading" disabled>
                            Loading...
                          </SelectItem>
                        ) : (
                          sourceChannels.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              #{c.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="self-center flex justify-center">
                    <ArrowRight />
                  </div>

                  <div className="space-y-2 flex-1">
                    <Label
                      htmlFor="target-server"
                      className="flex items-center gap-2"
                    >
                      <Server /> To Server:
                    </Label>
                    <Select
                      value={newRuleTargetServer}
                      onValueChange={(v) => {
                        setNewRuleTargetServer(v);
                        setNewRuleTargetChannel('');
                      }}
                    >
                      <SelectTrigger id="target-server">
                        <SelectValue placeholder="Select target server" />
                      </SelectTrigger>
                      <SelectContent>
                        {isLoadingAllServers ? (
                          <SelectItem value="loading" disabled>
                            Loading...
                          </SelectItem>
                        ) : (
                          allServers?.map((s) => (
                            <SelectItem key={s.serverId} value={s.serverId}>
                              {s.serverName}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 flex-1">
                    <Label
                      htmlFor="target-channel"
                      className="flex items-center gap-2"
                    >
                      <Hash /> To Channel:
                    </Label>
                    <Select
                      value={newRuleTargetChannel}
                      onValueChange={setNewRuleTargetChannel}
                      disabled={!newRuleTargetServer || isLoadingTargetChannels}
                    >
                      <SelectTrigger id="target-channel">
                        <SelectValue placeholder="Select target" />
                      </SelectTrigger>
                      <SelectContent>
                        {isLoadingTargetChannels ? (
                          <SelectItem value="loading" disabled>
                            Loading...
                          </SelectItem>
                        ) : (
                          targetChannels.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              #{c.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button onClick={handleAddRule} className="w-full">
                  <Save className="mr-2 h-4 w-4" /> Add Rule
                </Button>
              </div>
              <ScrollArea className="flex-1 mt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingRules && (
                      <TableRow>
                        <TableCell colSpan={3}>
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoadingRules &&
                      forwardingRules.map((rule) => (
                        <TableRow key={rule.id}>
                          <TableCell>
                            <span className="font-semibold">
                              #{getChannelName(rule.sourceChannel)}
                            </span>
                            <p className="text-xs text-muted-foreground">
                              {getServerName(sourceServerId || '')}
                            </p>
                          </TableCell>
                          <TableCell>
                            <span className="font-semibold">
                              #
                              {targetChannels.find(
                                (c) => c.id === rule.targetChannel
                              )?.name || rule.targetChannel}
                            </span>
                            <p className="text-xs text-muted-foreground">
                              {getServerName(rule.targetServer)}
                            </p>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveRule(rule.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                {!isLoadingRules && forwardingRules.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground p-8">
                    No forwarding rules configured.
                  </p>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
      
      {replyingTo && currentUserProfile && (
        <Dialog open={!!replyingTo} onOpenChange={() => setReplyingTo(null)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Reply to {replyingTo.originalAuthor.name}</DialogTitle>
                    <DialogDescription>
                        Your reply will be sent to the #{getChannelName(replyingTo.channelId)} channel.
                    </DialogDescription>
                </DialogHeader>
                <div className="my-4 p-3 rounded-md border bg-muted/30">
                    <ParsedMessageContent content={replyingTo.messageContent} userMap={userMap} />
                </div>
                <ReplyForm message={replyingTo} serverId={sourceServerId!} userProfile={currentUserProfile} onOpenChange={() => setReplyingTo(null)} />
            </DialogContent>
        </Dialog>
      )}

    </div>
  );
}

    
