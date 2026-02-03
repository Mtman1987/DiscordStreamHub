export const metadata: Metadata = {
  title: 'Link Twitch Account',
  description: 'Link your Twitch account to Discord for automatic shoutouts.',
};

export default function LinkTwitchPage() {
  return (
    <div className="container mx-auto py-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Link Twitch Account</h1>
        <p className="text-muted-foreground mb-8">
          Connect your Twitch account to get automatic shoutouts when you go live!
        </p>
        {/* TODO: Implement the linking form */}
        <div className="bg-muted p-8 rounded-lg text-center">
          <p>Coming soon...</p>
        </div>
      </div>
    </div>
  );
}
=======
import { Metadata } from 'next';
import { TwitchLinkEmbed } from '@/components/twitch-link-embed';

export const metadata: Metadata = {
  title: 'Link Twitch Account',
  description: 'Link your Twitch account to Discord for automatic shoutouts.',
};

export default function LinkTwitchPage() {
  return <TwitchLinkEmbed />;
}
