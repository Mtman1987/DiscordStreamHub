'use client';

import { useEffect, useState } from 'react';

interface AuthData {
  discordServerId?: string;
  discordUserId?: string;
  twitchUsername?: string;
  twitchToken?: string;
}

export const useSpaceMountainAuth = () => {
  const [authData, setAuthData] = useState<AuthData | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Check if running within Space Mountain
    const isSpaceMountain = window.location.hostname === 'localhost' && 
                           (window.parent !== window || window.opener);

    if (!isSpaceMountain) return;

    const ws = new WebSocket('ws://localhost:6068');
    
    ws.onopen = () => {
      setIsConnected(true);
      // Register as cosmic-raid and request auth data
      ws.send(JSON.stringify({
        type: 'REGISTER_APP',
        payload: { appName: 'cosmic-raid', appPort: 3001, role: 'primary' }
      }));
      
      // Request auth data from StreamWeave
      ws.send(JSON.stringify({
        type: 'ROUTE_MESSAGE',
        targetApp: 'streamweave',
        payload: { type: 'REQUEST_AUTH_DATA', from: 'cosmic-raid' }
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'AUTH_DATA_RESPONSE') {
          const auth = message.payload;
          setAuthData(auth);
          
          // Store in localStorage for dashboard access
          if (auth.discordServerId) localStorage.setItem('discordServerId', auth.discordServerId);
          if (auth.discordUserId) localStorage.setItem('discordUserId', auth.discordUserId);
          if (auth.twitchUsername) localStorage.setItem('twitchUsername', auth.twitchUsername);
        }
      } catch (error) {
        console.error('Space Mountain auth message error:', error);
      }
    };

    ws.onclose = () => setIsConnected(false);

    return () => ws.close();
  }, []);

  return { authData, isConnected };
};