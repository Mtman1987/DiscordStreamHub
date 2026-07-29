'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Send, Loader2, Monitor, Volume2, VolumeX, MonitorOff, MessageSquare } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { useDbDoc } from '@/hooks/use-db';
import Image from 'next/image';
import { useSpeechToText } from '@/hooks/use-speech-to-text';
import { Mic, MicOff } from 'lucide-react';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

interface DiscordChannel { id: string; name: string; type?: number; }
interface DiscordEmbed { title?: string; description?: string; url?: string; color?: number; image?: { url: string }; thumbnail?: { url: string }; author?: { name: string; icon_url?: string; url?: string }; fields?: Array<{ name: string; value: string; inline?: boolean }>; footer?: { text: string; icon_url?: string }; }
interface DiscordAttachment { id: string; url: string; filename: string; content_type?: string; }
interface DiscordMessage { id: string; content: string; author: { id: string; username: string; avatar: string; }; timestamp: string; mentions?: Array<{ id: string; username: string }>; embeds?: DiscordEmbed[]; attachments?: DiscordAttachment[]; }
interface LiveTwitchUser { twitchLogin: string; username: string; }

function channelIcon(type?: number) {
  if (type === 5) return '📢';
  if (type === 2) return '🔊';
  if (type === 13) return '🎭';
  if (type === 11) return '🧵';
  return '#';
}

function EmbedRenderer({ embed }: { embed: DiscordEmbed }) {
  const borderColor = embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : '#5865F2';
  return (
    <div className="mt-2 border-l-4 rounded bg-muted/50 p-3 max-w-md" style={{ borderLeftColor: borderColor }}>
      {embed.author && (
        <div className="flex items-center gap-2 mb-1">
          {embed.author.icon_url && <Image src={embed.author.icon_url} alt="" width={20} height={20} unoptimized className="rounded-full" />}
          <span className="text-xs font-semibold">{embed.author.name}</span>
        </div>
      )}
      {embed.title && (
        <p className="font-semibold text-sm">
          {embed.url ? <a href={embed.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{embed.title}</a> : embed.title}
        </p>
      )}
      {embed.description && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{embed.description}</p>}
      {embed.fields && embed.fields.length > 0 && (
        <div className="grid grid-cols-1 gap-1 mt-2">
          {embed.fields.map((f, i) => (
            <div key={i} className={f.inline ? 'inline-block mr-4' : ''}>
              <p className="text-xs font-semibold">{f.name}</p>
              <p className="text-xs text-muted-foreground">{f.value}</p>
            </div>
          ))}
        </div>
      )}
      {embed.thumbnail && <Image src={embed.thumbnail.url} alt="" width={80} height={80} unoptimized className="rounded mt-2 float-right" />}
      {embed.image && <Image src={embed.image.url} alt="" width={400} height={300} unoptimized className="rounded mt-2 max-w-full" />}
      {embed.footer && (
        <div className="flex items-center gap-1 mt-2">
          {embed.footer.icon_url && <Image src={embed.footer.icon_url} alt="" width={16} height={16} unoptimized className="rounded-full" />}
          <span className="text-xs text-muted-foreground">{embed.footer.text}</span>
        </div>
      )}
    </div>
  );
}

function AttachmentRenderer({ attachment }: { attachment: DiscordAttachment }) {
  const isImage = attachment.content_type?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(attachment.filename);
  const isVideo = attachment.content_type?.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(attachment.filename);
  if (isImage) return <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="mt-2 block"><Image src={attachment.url} alt={attachment.filename} width={400} height={300} unoptimized className="max-w-sm rounded-md" /></a>;
  if (isVideo) return <video src={attachment.url} controls className="mt-2 max-w-sm rounded-md" />;
  return <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="mt-1 text-blue-500 hover:underline text-sm block">📎 {attachment.filename}</a>;
}

function ParsedMessageContent({ content, mentions }: { content: string; mentions?: Array<{ id: string; username: string }> }) {
  const parts = React.useMemo(() => {
    if (!content) return [];
    const decoded = content.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const regex = /(<@(\d+)>)|(<a?:\w+:(\d+)>)|(https?:\/\/[^\s]+)/g;
    const elements: (string | React.ReactElement)[] = [];
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(decoded)) !== null) {
      if (match.index > lastIndex) elements.push(decoded.substring(lastIndex, match.index));
      const [fullMatch, mention, userId, emoji, emojiId, url] = match;
      if (mention && userId) {
        const username = mentions?.find(m => m.id === userId)?.username || 'unknown-user';
        elements.push(<strong key={`m-${match.index}`} className="text-primary bg-primary/10 px-1 py-0.5 rounded-sm">@{username}</strong>);
      } else if (emoji && emojiId) {
        const isAnim = fullMatch.startsWith('<a:');
        elements.push(<Image key={`e-${match.index}`} src={`https://cdn.discordapp.com/emojis/${emojiId}.${isAnim ? 'gif' : 'png'}`} alt={fullMatch} width={20} height={20} unoptimized className="inline-block mx-0.5" />);
      } else if (url) {
        if (/\.(gif|jpe?g|png|webp)$/i.test(url)) elements.push(<a key={`i-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="mt-2 block"><Image src={url} alt="Embedded" width={300} height={200} unoptimized className="max-w-xs rounded-md" /></a>);
        else elements.push(<a key={`u-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline break-all">{url}</a>);
      }
      lastIndex = match.index + fullMatch.length;
    }
    if (lastIndex < decoded.length) elements.push(decoded.substring(lastIndex));
    return elements;
  }, [content, mentions]);
  return <div className="text-sm whitespace-pre-wrap">{parts}</div>;
}

export default function ForwardingPage() {
  const { toast } = useToast();
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

  const twitchPlayerRef = React.useRef<HTMLIFrameElement>(null);
  const [twitchPlayerReady, setTwitchPlayerReady] = React.useState(false);

  const [showDiscord, setShowDiscord] = React.useState(true);
  const [showTwitch, setShowTwitch] = React.useState(false);
  const [selectedTwitchChannel, setSelectedTwitchChannel] = React.useState<string>('');
  const [manualTwitchChannel, setManualTwitchChannel] = React.useState<string>('');
  const [liveUsers, setLiveUsers] = React.useState<LiveTwitchUser[]>([]);
  const [showVideo, setShowVideo] = React.useState(false);
  const [isMuted, setIsMuted] = React.useState(true);
  const [isEmbedded, setIsEmbedded] = React.useState(false);
  const [twitchParent, setTwitchParent] = React.useState('localhost');

  const speech = useSpeechToText();

  React.useEffect(() => {
    setTwitchParent(window.location.hostname);
    const params = new URLSearchParams(window.location.search);
    const embedded = params.get('embed') === '1';
    const mode = String(params.get('mode') || '').toLowerCase();
    const fromQuery = params.get('serverId');
    const discordChannelId = params.get('discordChannelId') || params.get('channelId') || '';
    const twitchChannel = params.get('twitchChannel') || '';
    setIsEmbedded(embedded);
    setServerId(fromQuery || localStorage.getItem('discordServerId'));
    setUserId(localStorage.getItem('discordUserId'));
    if (mode === 'twitch') {
      setShowDiscord(false);
      setShowTwitch(true);
    } else if (mode === 'discord') {
      setShowDiscord(true);
      setShowTwitch(false);
    }
    if (discordChannelId) setSelectedChannelId(discordChannelId);
    if (twitchChannel) setSelectedTwitchChannel(twitchChannel.trim().replace(/^@/, '').toLowerCase());
  }, []);

  const { data: userProfile } = useDbDoc<{ username: string; avatarUrl: string }>(
    serverId && userId ? `servers/${serverId}/users/${userId}` : null
  );

  React.useEffect(() => {
    const fetchLive = async () => {
      if (!serverId) return;
      try {
        const res = await fetch(`/api/twitch/live-members?serverId=${serverId}`);
        if (res.ok) {
          const data = await res.json();
          const members = (data.liveMembers || []).map((m: any) => ({
            twitchLogin: m.twitchLogin || m.twitchUsername || '',
            username: m.username || m.twitchLogin || '',
          })).filter((m: any) => m.twitchLogin);
          setLiveUsers(members);
        }
      } catch (e) {
        console.error('Failed to fetch live users:', e);
      }
    };
    fetchLive();
    const interval = setInterval(fetchLive, 60000);
    return () => clearInterval(interval);
  }, [serverId]);

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

  const channelsData = useDbDoc<{ list: DiscordChannel[] }>(
    serverId ? `servers/${serverId}/config/channels` : null
  ).data;
  const channels = channelsData?.list ?? [];

  const fetchMessages = React.useCallback(async (channelId: string, silent = false) => {
    if (!channelId) return;
    if (!silent) setIsLoading(true);
    try {
      const response = await fetch(`/api/discord/messages?channelId=${channelId}&limit=50`);
      const data = await response.json();
      if (data.messages) setMessages(data.messages.reverse());
    } catch (error) {
      if (!silent) toast({ variant: 'destructive', title: 'Failed to fetch messages' });
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    if (!selectedChannelId || !showDiscord) return;
    fetchMessages(selectedChannelId);
    const interval = setInterval(() => fetchMessages(selectedChannelId, true), 30000);
    return () => clearInterval(interval);
  }, [selectedChannelId, fetchMessages, showDiscord]);

  React.useEffect(() => {
    const viewport = document.querySelector('[data-radix-scroll-area-viewport]');
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [messages]);

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
        const textarea = document.querySelector('textarea');
        if (textarea) textarea.style.height = 'auto';
        await new Promise(resolve => setTimeout(resolve, 500));
        await fetchMessages(selectedChannelId, true);
        toast({ title: 'Message sent!' });
      } else {
        const errorData = await response.json();
        toast({ variant: 'destructive', title: 'Failed to send message', description: errorData.error });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Failed to send message' });
    } finally {
      setIsSending(false);
    }
  };

  const twitchPlayerUrl = selectedTwitchChannel ? `https://player.twitch.tv/?channel=${selectedTwitchChannel}&parent=${encodeURIComponent(twitchParent)}&muted=false` : '';
  const twitchChatUrl = selectedTwitchChannel ? `https://www.twitch.tv/embed/${selectedTwitchChannel}/chat?parent=${encodeURIComponent(twitchParent)}&darkpopout` : '';

  const panelCount = (showDiscord ? 1 : 0) + (showTwitch ? 1 : 0);

  React.useEffect(() => {
    if (speech.transcript && speech.isListening) {
      setNewMessage(speech.transcript);
    }
  }, [speech.transcript, speech.isListening]);

  const applyManualTwitchChannel = React.useCallback(() => {
    const cleaned = manualTwitchChannel.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').split(/[/?#]/)[0];
    if (cleaned) setSelectedTwitchChannel(cleaned.toLowerCase());
  }, [manualTwitchChannel]);

  return (
    <div className={`h-screen flex flex-col overflow-hidden ${isEmbedded ? 'p-3' : 'p-8'}`}>
      {!isEmbedded && <div className="flex items-center gap-2 mb-4">
        <Button variant={showDiscord ? 'default' : 'outline'} size="sm" onClick={() => setShowDiscord(!showDiscord)}>
          <MessageSquare className="h-4 w-4 mr-1" /> Discord
        </Button>
        <Button variant={showTwitch ? 'default' : 'outline'} size="sm" onClick={() => setShowTwitch(!showTwitch)}>
          <Monitor className="h-4 w-4 mr-1" /> Twitch
        </Button>
      </div>}

      {showTwitch && selectedTwitchChannel && (
        <Card
          className="mb-4"
          style={showVideo
            ? { height: panelCount === 2 ? '40%' : '50%' }
            : { position: 'fixed', width: 1, height: 1, top: -9999, left: -9999, overflow: 'hidden', pointerEvents: 'none' as const, zIndex: -1 }
          }
        >
          <CardContent className="h-full p-0">
            <iframe src={twitchPlayerUrl} className="w-full h-full" allowFullScreen allow="autoplay" />
          </CardContent>
        </Card>
      )}

      <div className={`flex-1 grid grid-cols-1 ${panelCount > 1 ? 'xl:grid-cols-2' : ''} gap-4 min-h-0`}>
        {showDiscord && (
          <Card className="flex-1 flex flex-col overflow-hidden" data-workspace-chat-surface>
            <CardContent className={`flex-1 flex flex-col overflow-hidden ${isEmbedded ? 'p-3' : 'p-6'}`}>
              <ScrollArea className="flex-1 pr-4">
                <div ref={scrollRef} className="min-h-full">
                  {isLoading ? (
                    <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
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
                              <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(msg.timestamp), { addSuffix: true })}</p>
                            </div>
                            <ParsedMessageContent content={msg.content} mentions={msg.mentions} />
                            {msg.attachments?.map((att) => <AttachmentRenderer key={att.id} attachment={att} />)}
                            {msg.embeds?.map((embed, i) => <EmbedRenderer key={`embed-${msg.id}-${i}`} embed={embed} />)}
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
                    value={speech.isListening ? speech.transcript : newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type a message or use the mic..."
                    className="flex-1 min-h-[40px] max-h-[200px] resize-none"
                    rows={1}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    onInput={(e) => {
                      const t = e.target as HTMLTextAreaElement;
                      t.style.height = 'auto';
                      t.style.height = Math.min(t.scrollHeight, 200) + 'px';
                    }}
                  />
                  <Button variant={speech.isListening ? 'secondary' : 'outline'} size="icon" onClick={speech.isListening ? speech.stop : speech.start} title={speech.isListening ? 'Stop listening' : 'Start voice input'}>
                    {speech.isListening ? <MicOff className="h-5 w-5 text-red-500" /> : <Mic className="h-5 w-5" />}
                  </Button>
                  <div className="flex flex-col gap-2 w-[200px]">
                    <div className="flex gap-2">
                      <Button variant="outline" size="icon" onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="flex-1">😀</Button>
                      <Button onClick={handleSendMessage} disabled={!newMessage.trim() || !selectedChannelId || isSending} className="flex-1">
                        {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </Button>
                    </div>
                    <Select value={selectedChannelId} onValueChange={setSelectedChannelId}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="Channel" /></SelectTrigger>
                      <SelectContent>
                        {channels.map((c) => <SelectItem key={c.id} value={c.id}>{channelIcon(c.type)} {c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {showEmojiPicker && (
                  <div className="absolute bottom-full mb-2 right-0 z-50">
                    <div className="bg-background border rounded-lg shadow-lg p-2 max-h-[400px] overflow-y-auto">
                      {serverEmojis.length > 0 && (
                        <div className="mb-2 pb-2 border-b">
                          <p className="text-xs font-semibold mb-2">Server Emojis</p>
                          <div className="flex flex-wrap gap-1 max-w-[350px] max-h-[150px] overflow-y-auto">
                            {serverEmojis.map((emoji) => (
                              <button key={emoji.id} onClick={() => { setNewMessage(prev => prev + `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`); setShowEmojiPicker(false); }} className="hover:bg-muted p-1 rounded" title={emoji.name}>
                                <Image src={`https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`} alt={emoji.name} width={24} height={24} unoptimized />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <EmojiPicker onEmojiClick={(emoji) => { setNewMessage(prev => prev + emoji.emoji); setShowEmojiPicker(false); }} />
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {showTwitch && (
          <div className="flex-1 flex flex-col min-h-0">
            {!isEmbedded && <div className="flex items-center gap-2 mb-3 px-2">
              <Select value={selectedTwitchChannel} onValueChange={setSelectedTwitchChannel}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Select a live channel" /></SelectTrigger>
                <SelectContent>
                  {liveUsers.map((u) => <SelectItem key={u.twitchLogin} value={u.twitchLogin}>🟢 {u.twitchLogin}</SelectItem>)}
                  {liveUsers.length === 0 && <SelectItem value="_none" disabled>No one is live</SelectItem>}
                </SelectContent>
              </Select>
              <Input
                value={manualTwitchChannel}
                onChange={(e) => setManualTwitchChannel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyManualTwitchChannel();
                }}
                placeholder="or type channel"
                className="max-w-[180px]"
              />
              <Button variant="outline" onClick={applyManualTwitchChannel}>Open</Button>
              <Button variant={showVideo ? 'default' : 'outline'} size="icon" onClick={() => setShowVideo(!showVideo)} title={showVideo ? 'Hide video' : 'Show video'}>
                {showVideo ? <Monitor className="h-4 w-4" /> : <MonitorOff className="h-4 w-4" />}
              </Button>
            </div>}
            {selectedTwitchChannel ? (
              <iframe src={twitchChatUrl} className="flex-1 rounded border" style={{ minHeight: 0, width: '100%' }} />
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">Select a live channel to view chat</div>
            )}
          </div>
        )}

        {!showDiscord && !showTwitch && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Toggle Discord or Twitch to get started
          </div>
        )}
      </div>
    </div>
  );
}
