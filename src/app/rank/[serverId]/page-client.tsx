'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function RankPage() {
  const params = useParams();
  const serverId = params.serverId as string;
  const [message, setMessage] = useState('=ƒöì Checking your rank...');

  useEffect(() => {
    // Simple Discord OAuth simulation - in a real app you'd use proper OAuth
    const checkRank = async () => {
      try {
        // For demo purposes, we'll use a simple prompt for Discord ID
        const discordId = prompt('Enter your Discord User ID to check your rank:');
        const username = prompt('Enter your Discord username:') || 'User';
        
        if (!discordId) {
          setMessage('G¥î Discord ID is required to check your rank.');
          return;
        }

        const response = await fetch('/api/discord/check-rank', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: discordId, username, serverId })
        });

        const data = await response.json();
        setMessage(data.content || 'G¥î Unable to fetch rank information.');
      } catch (error) {
        setMessage('G¥î Error checking rank. Please try again.');
      }
    };

    if (serverId) {
      checkRank();
    }
  }, [serverId]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-black/30 backdrop-blur-sm rounded-xl p-8 border border-blue-400/30">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-6">
            =ƒÜÇ Space Mountain Rank Check
          </h1>
          <div className="text-lg text-white whitespace-pre-line">
            {message}
          </div>
          <div className="mt-6">
            <button 
              onClick={() => window.close()} 
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

