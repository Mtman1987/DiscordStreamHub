import { PageHeader } from "@/components/page-header";
import { UpcomingEvents } from "./_components/upcoming-events";
import { LeaderboardSnapshot } from "./_components/leaderboard-snapshot";
import { RecentShoutouts } from "./_components/recent-shoutouts";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Welcome back! Here's a snapshot of your community."
      />
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-8">
           <RecentShoutouts />
        </div>
        <div className="space-y-8">
          <UpcomingEvents />
          <LeaderboardSnapshot />
        </div>
      </div>
    </div>
  );
}
