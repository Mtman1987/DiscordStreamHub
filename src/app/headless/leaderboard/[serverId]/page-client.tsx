'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { FirebaseComponentsProvider, useCollection, useFirestore } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import type { LeaderboardEntry, UserProfile } from '@/lib/types';
import * as React from 'react';

interface FormattedLeaderboardEntry {
  username: string;
  points: number;
  rank: number;
  avatarUrl?: string;
}

function LeaderboardComponent() {
  const params = useParams();
  const serverId = params.serverId as string;
  const firestore = useFirestore();
  const [leaderboard, setLeaderboard] = useState<FormattedLeaderboardEntry[]>([]);

  const leaderboardQuery = React.useMemo(() => {
    if (!firestore || !serverId) return null;
    return query(collection(firestore, 'servers', serverId, 'leaderboard'), orderBy('points', 'desc'), limit(10));
  }, [firestore, serverId]);

  const { data: rawLeaderboard } = useCollection<LeaderboardEntry>(leaderboardQuery);
  const { data: allUsers } = useCollection<UserProfile>(collection(firestore, 'servers', serverId, 'users'));

  useEffect(() => {
    if (rawLeaderboard && allUsers) {
      const userMap = new Map(allUsers.map(user => [user.id, user]));
      const formattedData = rawLeaderboard.map((entry, index) => {
        const user = userMap.get(entry.userProfileId);
        return {
          username: user?.username || entry.userProfileId,
          points: entry.points || 0,
          rank: index + 1,
          avatarUrl: user?.avatarUrl,
        };
      });
      setLeaderboard(formattedData);
    }
  }, [rawLeaderboard, allUsers]);

  return (
    <div className="leaderboard min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0">
        <div className="stars absolute inset-0 opacity-60"></div>
        <div className="rockets absolute inset-0"></div>
      </div>

      {/* Main content */}
      <div className="relative z-10 p-8">
        <div className="text-center mb-8">
          <h1 className="text-6xl font-bold text-white mb-4 animate-pulse">
            🚀 SPACE MOUNTAIN LEADERBOARD 🚀
          </h1>
          <div className="text-2xl text-yellow-300 animate-bounce">
            ⭐ TOP SPACE CADETS ⭐
          </div>
        </div>

        <div className="max-w-4xl mx-auto">
          {leaderboard.map((entry, index) => (
            <div
              key={entry.username}
              className={`leaderboard-entry mb-4 p-6 rounded-xl backdrop-blur-sm border-2 transform transition-all duration-1000 animate-slideIn ${
                index === 0 ? 'bg-gradient-to-r from-yellow-500/30 to-orange-500/30 border-yellow-400 scale-110' :
                index === 1 ? 'bg-gradient-to-r from-gray-400/30 to-gray-600/30 border-gray-400 scale-105' :
                index === 2 ? 'bg-gradient-to-r from-orange-600/30 to-yellow-600/30 border-orange-400 scale-102' :
                'bg-gradient-to-r from-blue-500/20 to-purple-500/20 border-blue-400'
              }`}
              style={{ animationDelay: `${index * 0.2}s` }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className={`rank-badge text-3xl font-bold ${
                    index === 0 ? 'text-yellow-300' :
                    index === 1 ? 'text-gray-300' :
                    index === 2 ? 'text-orange-300' :
                    'text-blue-300'
                  }`}>
                    {index === 0 ? '👑' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${entry.rank}`}
                  </div>
                  
                  <div className="avatar w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-purple-600 flex items-center justify-center text-2xl font-bold text-white">
                    {entry.avatarUrl ? (
                      <Image
                        src={entry.avatarUrl}
                        alt={entry.username}
                        width={64}
                        height={64}
                        unoptimized
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      entry.username.charAt(0).toUpperCase()
                    )}
                  </div>
                  
                  <div>
                    <div className="text-2xl font-bold text-white">{entry.username}</div>
                    <div className="text-lg text-blue-200">Space Cadet</div>
                  </div>
                </div>
                
                <div className="text-right">
                  <div className="text-3xl font-bold text-yellow-300 animate-pulse">
                    {entry.points.toLocaleString()}
                  </div>
                  <div className="text-lg text-blue-200">Points</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-8">
          <div className="text-xl text-white animate-bounce">
            🌟 Join Space Mountain to climb the ranks! 🌟
          </div>
        </div>
      </div>

      <style jsx>{`
        .stars {
          background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="20" cy="20" r="1" fill="white" opacity="0.8"/><circle cx="80" cy="30" r="0.5" fill="white" opacity="0.6"/><circle cx="60" cy="70" r="1" fill="white" opacity="0.7"/><circle cx="30" cy="80" r="0.5" fill="white" opacity="0.5"/><circle cx="10" cy="50" r="0.8" fill="white" opacity="0.9"/><circle cx="90" cy="60" r="0.6" fill="white" opacity="0.7"/></svg>') repeat;
          animation: twinkle 3s ease-in-out infinite alternate;
        }
        
        .rockets::before {
          content: '🚀';
          position: absolute;
          font-size: 2rem;
          animation: rocket-fly 15s linear infinite;
          top: 20%;
          left: -5%;
        }
        
        .rockets::after {
          content: '🛸';
          position: absolute;
          font-size: 1.5rem;
          animation: ufo-fly 20s linear infinite reverse;
          top: 60%;
          right: -5%;
        }
        
        @keyframes twinkle {
          0% { opacity: 0.3; }
          100% { opacity: 1; }
        }
        
        @keyframes rocket-fly {
          0% { transform: translateX(-100px) rotate(45deg); }
          100% { transform: translateX(calc(100vw + 100px)) rotate(45deg); }
        }
        
        @keyframes ufo-fly {
          0% { transform: translateX(100px) rotate(-10deg); }
          100% { transform: translateX(calc(-100vw - 100px)) rotate(10deg); }
        }
        
        @keyframes slideIn {
          0% { 
            opacity: 0; 
            transform: translateX(-100px) scale(0.8); 
          }
          100% { 
            opacity: 1; 
            transform: translateX(0) scale(1); 
          }
        }
        
        .animate-slideIn {
          animation: slideIn 0.8s ease-out forwards;
        }
      `}</style>
    </div>
  );
}


export default function HeadlessLeaderboardClientPage() {
    return (
        <FirebaseComponentsProvider>
            <LeaderboardComponent />
        </FirebaseComponentsProvider>
    )
}
