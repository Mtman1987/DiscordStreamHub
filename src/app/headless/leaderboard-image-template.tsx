/* eslint-disable @next/next/no-img-element */
import * as React from 'react';

// Simplified types for the template
interface LeaderboardEntry {
  rank: number;
  username: string;
  avatarUrl: string;
  points: number;
}

interface LeaderboardImageTemplateProps {
  entries: LeaderboardEntry[];
}

export function LeaderboardImageTemplate({ entries }: LeaderboardImageTemplateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '600px',
        height: '800px',
        padding: '32px',
        backgroundColor: '#1a202c', // slate-900
        color: 'white',
        fontFamily: '"Inter", sans-serif',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '24px' }}>
        <div style={{ fontSize: '36px', fontWeight: 700, color: '#fbbF24', letterSpacing: '0.05em' }}>
          LEADERBOARD
        </div>
        <div style={{ fontSize: '16px', color: '#a0aec0' }}>Top Community Contributors</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {entries.map((entry, index) => (
          <div
            key={entry.username}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '12px',
              borderRadius: '12px',
              backgroundColor:
                index === 0 ? 'rgba(251, 191, 36, 0.2)' :
                index === 1 ? 'rgba(192, 192, 192, 0.2)' :
                index === 2 ? 'rgba(205, 127, 50, 0.2)' :
                'rgba(255, 255, 255, 0.05)',
              border: '1px solid',
              borderColor:
                index === 0 ? 'rgba(251, 191, 36, 0.5)' :
                index === 1 ? 'rgba(192, 192, 192, 0.5)' :
                index === 2 ? 'rgba(205, 127, 50, 0.5)' :
                'rgba(255, 255, 255, 0.1)',
            }}
          >
            <div style={{ width: '48px', textAlign: 'center', fontSize: '24px', fontWeight: 700, color: '#cbd5e0' }}>
              {entry.rank}
            </div>
            <img
              src={entry.avatarUrl}
              alt={entry.username}
              style={{ width: '48px', height: '48px', borderRadius: '50%', marginLeft: '16px', border: '2px solid #4a5568' }}
            />
            <div style={{ marginLeft: '16px', flexGrow: 1 }}>
              <div style={{ fontSize: '18px', fontWeight: 600 }}>{entry.username}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#fbbF24' }}>
                {entry.points.toLocaleString()}
              </div>
              <div style={{ fontSize: '12px', color: '#a0aec0' }}>POINTS</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 'auto', textAlign: 'center', fontSize: '12px', color: '#718096' }}>
        Powered by Streamer's Hub
      </div>
    </div>
  );
}
