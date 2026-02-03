import { Metadata } from 'next';
import { TwitchLinkEmbed } from '@/components/twitch-link-embed';

export const metadata: Metadata = {
  title: 'Link Twitch Account',
  description: 'Link your Twitch account to Discord for automatic shoutouts.',
};

export default function LinkTwitchPage() {
  return <TwitchLinkEmbed />;
}
