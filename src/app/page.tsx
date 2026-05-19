import { redirect } from 'next/navigation';
import ActivityClient from './activity/activity-client';

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const isDiscordActivityLaunch = Boolean(
    params.guild_id ||
      params.channel_id ||
      params.instance_id ||
      params.frame_id ||
      params.platform ||
      params.location_id
  );

  if (isDiscordActivityLaunch) {
    return <ActivityClient />;
  }

  redirect('/login');
}
