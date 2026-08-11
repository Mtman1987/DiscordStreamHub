import { PageHeader } from '@/components/page-header';
import { UpcomingEvents } from './_components/upcoming-events';
import { LeaderboardSnapshot } from './_components/leaderboard-snapshot';
import { RecentShoutouts } from './_components/recent-shoutouts';
import Link from 'next/link';
import { CalendarDays, FileText, Megaphone, MessageSquare, Trophy } from 'lucide-react';

const quickActions = [
  {
    href: '/shoutouts',
    label: 'AI Shoutouts',
    description: 'Review community shoutout groups and live promotion tools.',
    Icon: Megaphone,
  },
  {
    href: '/calendar',
    label: 'Calendar',
    description: 'Manage the actual upcoming community schedule.',
    Icon: CalendarDays,
  },
  {
    href: '/leaderboard',
    label: 'Leaderboard',
    description: 'See ranks, point totals, and reward activity.',
    Icon: Trophy,
  },
  {
    href: '/messages',
    label: 'Messages',
    description: 'Review community and forwarded Discord messages.',
    Icon: MessageSquare,
  },
  {
    href: '/applications',
    label: 'Applications',
    description: 'Review incoming community applications and status.',
    Icon: FileText,
  },
] as const;

export default function DashboardPage() {
  return (
    <div className="space-y-6 pb-20">
      <PageHeader
        title="Community Command Center"
        description="Live shoutout activity, the next real events, community ranks, and the tools you actually use."
      />

      <section className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3" aria-label="Discord Stream Hub quick actions">
        {quickActions.map(({ href, label, description, Icon }) => (
          <Link
            key={href}
            href={href}
            className="group min-h-32 rounded-xl border border-white/10 bg-card/70 p-3.5 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-primary/35 hover:bg-card"
          >
            <div className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </div>
            <h2 className="font-headline text-sm font-semibold group-hover:text-primary">{label}</h2>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
          </Link>
        ))}
      </section>

      <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
        <RecentShoutouts />
        <div className="space-y-6">
          <UpcomingEvents />
          <LeaderboardSnapshot />
        </div>
      </section>
    </div>
  );
}
