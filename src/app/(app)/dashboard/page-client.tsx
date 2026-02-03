import { PageHeader } from "@/components/page-header";
import { UpcomingEvents } from "./_components/upcoming-events";
import { LeaderboardSnapshot } from "./_components/leaderboard-snapshot";
import { RecentShoutouts } from "./_components/recent-shoutouts";

export default function DashboardPage() {
  return (
    <div style={{ padding: '20px', minHeight: '100vh' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{
          fontSize: '32px',
          fontWeight: 'bold',
          margin: '0 0 8px 0',
          background: 'linear-gradient(45deg, #667eea, #764ba2)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent'
        }}>
          🚀 Dashboard
        </h1>
        <p style={{ color: '#888', margin: 0 }}>
          Welcome back! Here&apos;s a snapshot of your community.
        </p>
      </div>
      <div style={{
        display: 'grid',
        gap: '32px',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))'
      }}>
        <div style={{ gridColumn: 'span 2' }}>
           <RecentShoutouts />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          <UpcomingEvents />
          <LeaderboardSnapshot />
        </div>
      </div>
    </div>
  );
}
