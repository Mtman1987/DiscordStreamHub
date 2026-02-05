'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Send, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { doc } from 'firebase/firestore';
import { useDoc, useFirestore, useUser, useMemoFirebase } from '@/firebase';
import Image from 'next/image';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

interface DiscordChannel {
  id: string;
  name: string;
}

interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    avatar: string;
  };
  timestamp: string;
  mentions?: Array<{ id: string; username: string }>;
}

function ParsedMessageContent({ content, mentions }: { content: string; mentions?: Array<{ id: string; username: string }> }) {
  const parts = React.useMemo(() => {
    if (!content) return [];
    
    // Decode HTML entities
    const decodedContent = content
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    
    const combinedRegex = /(<@(\d+)>)|(<a?:\w+:(\d+)>)|(https?:\/\/[^\s]+)/g;
    const elements: (string | JSX.Element)[] = [];
    let lastIndex = 0;
    let match;

    while ((match = combinedRegex.exec(decodedContent)) !== null) {
      if (match.index > lastIndex) {
        elements.push(decodedContent.substring(lastIndex, match.index));
      }

      const [fullMatch, mention, userId, emoji, emojiId, url] = match;

      if (mention && userId) {
        const username = mentions?.find(m => m.id === userId)?.username || 'unknown-user';
        elements.push(
          <strong key={`mention-${match.index}`} className="text-primary bg-primary/10 px-1 py-0.5 rounded-sm">
            @{username}
          </strong>
        );
      } else if (emoji && emojiId) {
        const isAnimated = fullMatch.startsWith('<a:');
        const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${isAnimated ? 'gif' : 'png'}`;
        elements.push(
          <Image key={`emoji-${match.index}`} src={emojiUrl} alt={fullMatch} width={20} height={20} unoptimized className="inline-block mx-0.5" />
        );
      } else if (url) {
        if (/\.(gif|jpe?g|png|webp)$/i.test(url)) {
          elements.push(
            <a key={`img-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
              <Image src={url} alt="Embedded" width={300} height={200} unoptimized className="max-w-xs rounded-md" />
            </a>
          );
        } else if (/tenor\.com\/view/.test(url)) {
          elements.push(
            <a key={`tenor-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
              <Image src={`${url}.gif`} alt="Tenor GIF" width={300} height={200} unoptimized className="max-w-xs rounded-md" />
            </a>
          );
        } else {
          elements.push(
            <a key={`url-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline break-all">
              {url}
            </a>
          );
        }
      }

      lastIndex = match.index + fullMatch.length;
    }

    if (lastIndex < decodedContent.length) {
      elements.push(decodedContent.substring(lastIndex));
    }

    return elements;
  }, [content, mentions]);

  return <div className="text-sm whitespace-pre-wrap">{parts}</div>;
}

export default function ForwardingPage() {
  const { toast } = useToast();
  const firestore = useFirestore();
  const { user } = useUser();
  const [serverId, setServerId] = React.useState<string | null>(null);
  const [userId, setUserId] = React.useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = React.useState<string>('');
  const [messages, setMessages] = React.useState<DiscordMessage[]>([]);
  const [newMessage, setNewMessage] = React.useState<string>('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = React.useState(false);
  const [serverEmojis, setServerEmojis] = React.useState<Array<{ id: string; name: string; animated: boolean }>>([]);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setServerId(localStorage.getItem('discordServerId'));
    setUserId(localStorage.getItem('discordUserId'));
  }, []);

  const userProfileRef = useMemoFirebase(() => {
    if (!firestore || !serverId || !userId || !user) return null;
    return doc(firestore, 'servers', serverId, 'users', userId);
  }, [firestore, serverId, userId, user]);

  const { data: userProfile } = useDoc<{ username: string; avatarUrl: string }>(userProfileRef);

  React.useEffect(() => {
    const fetchServerEmojis = async () => {
      if (!serverId) return;
      try {
        const response = await fetch(`/api/discord/emojis?serverId=${serverId}`);
        const data = await response.json();
        if (data.emojis) setServerEmojis(data.emojis);
      } catch (error) {
        console.error('Failed to fetch server emojis:', error);
      }
    };
    fetchServerEmojis();
  }, [serverId]);

  const channelsConfigRef = React.useMemo(() => {
    if (!firestore || !serverId) return null;
    return doc(firestore, 'servers', serverId, 'config', 'channels');
  }, [firestore, serverId]);

  const { data: channelsData } = useDoc<{ list: DiscordChannel[] }>(channelsConfigRef);
  const channels = channelsData?.list ?? [];

  const fetchMessages = React.useCallback(async (channelId: string) => {
    if (!channelId) return;
    setIsLoading(true);
    try {
      const response = await fetch(`/api/discord/messages?channelId=${channelId}&limit=50`);
      const data = await response.json();
      if (data.messages) {
        // Discord API returns messages in reverse chronological order (newest first)
        // Reverse them so oldest is first (normal chat order)
        setMessages(data.messages.reverse());
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Failed to fetch messages' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    if (selectedChannelId) {
      fetchMessages(selectedChannelId);
    }
  }, [selectedChannelId, fetchMessages]);

  React.useEffect(() => {
    const viewport = document.querySelector('[data-radix-scroll-area-viewport]');
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      const viewport = document.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedChannelId) return;
    setIsSending(true);
    try {
      const response = await fetch('/api/discord/send-as-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: selectedChannelId,
          content: newMessage,
          username: userProfile?.username || 'User',
          avatarUrl: userProfile?.avatarUrl || ''
        }),
      });
      if (response.ok) {
        setNewMessage('');
        // Reset textarea height
        const textarea = document.querySelector('textarea');
        if (textarea) {
          textarea.style.height = 'auto';
        }
        
        // Refetch messages and scroll to bottom
        await new Promise(resolve => setTimeout(resolve, 500));
        await fetchMessages(selectedChannelId);
        scrollToBottom();
        
        toast({ title: 'Message sent!' });
      } else {
        const errorData = await response.json();
        console.error('Send error:', errorData);
        toast({ variant: 'destructive', title: 'Failed to send message', description: errorData.error });
        throw new Error('Failed to send');
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Failed to send message' });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="h-screen flex flex-col p-8">
      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardContent className="flex-1 flex flex-col overflow-hidden p-6">
          <ScrollArea className="flex-1 pr-4">
            <div ref={scrollRef} className="min-h-full">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Select a channel to view messages</p>
            ) : (
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div key={msg.id} className="flex items-start gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={msg.author.avatar ? `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.png` : undefined} />
                      <AvatarFallback>{msg.author.username.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="flex items-baseline gap-2">
                        <p className="font-semibold">{msg.author.username}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(msg.timestamp), { addSuffix: true })}
                        </p>
                      </div>
                      <ParsedMessageContent content={msg.content} mentions={msg.mentions} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            </div>
          </ScrollArea>
          <div className="mt-4 relative">
            <div className="flex gap-2">
              <Textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 min-h-[40px] max-h-[200px] resize-none"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 200) + 'px';
                }}
              />
              <div className="flex flex-col gap-2 w-[200px]">
                <div className="flex gap-2">
                  <Button variant="outline" size="icon" onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="flex-1">
                    😀
                  </Button>
                  <Button onClick={handleSendMessage} disabled={!newMessage.trim() || !selectedChannelId || isSending} className="flex-1">
                    {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
                <Select value={selectedChannelId} onValueChange={setSelectedChannelId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Channel" />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        #{c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {showEmojiPicker && (
              <div className="absolute bottom-full mb-2 right-0 z-50">
                <div className="bg-background border rounded-lg shadow-lg p-2">
                  {serverEmojis.length > 0 && (
                    <div className="mb-2 pb-2 border-b">
                      <p className="text-xs font-semibold mb-2">Server Emojis</p>
                      <div className="flex flex-wrap gap-1 max-w-[350px]">
                        {serverEmojis.map((emoji) => (
                          <button
                            key={emoji.id}
                            onClick={() => {
                              setNewMessage(prev => prev + `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`);
                              setShowEmojiPicker(false);
                            }}
                            className="hover:bg-muted p-1 rounded"
                            title={emoji.name}
                          >
                            <Image
                              src={`https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`}
                              alt={emoji.name}
                              width={24}
                              height={24}
                              unoptimized
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <EmojiPicker onEmojiClick={(emoji) => {
                    setNewMessage(prev => prev + emoji.emoji);
                    setShowEmojiPicker(false);
                  }} />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
