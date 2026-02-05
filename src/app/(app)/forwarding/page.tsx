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
import { useDoc, useFirestore } from '@/firebase';
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
    const combinedRegex = /(<@(\d+)>)|(<a?:\w+:(\d+)>)|(https?:\/\/[^\s]+)/g;
    const elements: (string | JSX.Element)[] = [];
    let lastIndex = 0;
    let match;

    while ((match = combinedRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        elements.push(content.substring(lastIndex, match.index));
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

    if (lastIndex < content.length) {
      elements.push(content.substring(lastIndex));
    }

    return elements;
  }, [content, mentions]);

  return <div className="text-sm whitespace-pre-wrap">{parts}</div>;
}

export default function ForwardingPage() {
  const { toast } = useToast();
  const firestore = useFirestore();
  const [serverId, setServerId] = React.useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = React.useState<string>('');
  const [messages, setMessages] = React.useState<DiscordMessage[]>([]);
  const [newMessage, setNewMessage] = React.useState<string>('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = React.useState(false);
  const [serverEmojis, setServerEmojis] = React.useState<Array<{ id: string; name: string; animated: boolean }>>([]);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const storedServerId = localStorage.getItem('discordServerId');
    if (storedServerId) setServerId(storedServerId);
  }, []);

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
        setMessages(data.messages);
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
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedChannelId || !serverId) return;
    setIsSending(true);
    try {
      const response = await fetch('/api/discord/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId,
          channelId: selectedChannelId,
          content: newMessage,
        }),
      });
      if (response.ok) {
        setNewMessage('');
        await fetchMessages(selectedChannelId);
        toast({ title: 'Message sent!' });
      } else {
        throw new Error('Failed to send');
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Failed to send message' });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Discord Messages"
        description="View and send messages to Discord channels."
      />
      <Card className="h-[calc(100vh-200px)] flex flex-col">
        <CardContent className="flex-1 flex flex-col overflow-hidden p-6">
          <ScrollArea className="flex-1 pr-4" ref={scrollRef}>
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
          </ScrollArea>
          <div className="mt-4 relative">
            <div className="flex gap-2">
              <Textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 min-h-[120px]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
              />
              <div className="flex flex-col gap-2 w-[200px]">
                <Button variant="outline" size="icon" onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="w-full">
                  😀
                </Button>
                <Button onClick={handleSendMessage} disabled={!newMessage.trim() || !selectedChannelId || isSending} className="w-full">
                  {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
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
