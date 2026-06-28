import { PageHeader } from "@/components/page-header";
import { UpcomingEvents } from "./_components/upcoming-events";
import { LeaderboardSnapshot } from "./_components/leaderboard-snapshot";
import { RecentShoutouts } from "./_components/recent-shoutouts";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarDays, MessageSquare, Trophy } from "lucide-react";

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
          <Card>
            <CardHeader>
              <CardTitle className="font-headline">DiscordStreamHub Apps</CardTitle>
              <CardDescription>Embeddable admin tools for the site app section.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Button asChild variant="outline" className="justify-start">
                <Link href="/calendar"><CalendarDays className="mr-2 h-4 w-4" /> Admin calendar</Link>
              </Button>
              <Button asChild variant="outline" className="justify-start">
                <Link href="/leaderboard"><Trophy className="mr-2 h-4 w-4" /> Leaderboard</Link>
              </Button>
              <Button asChild variant="outline" className="justify-start">
                <Link href="/forwarding?embed=1"><MessageSquare className="mr-2 h-4 w-4" /> Forum messages</Link>
              </Button>
            </CardContent>
          </Card>
          <UpcomingEvents />
          <LeaderboardSnapshot />
        </div>
      </div>
    </div>
  );
}
