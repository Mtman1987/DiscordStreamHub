'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    discordServerId: '',
    discordUserId: '',
    twitchUsername: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('discordServerId', formData.discordServerId);
    localStorage.setItem('discordUserId', formData.discordUserId);
    localStorage.setItem('twitchUsername', formData.twitchUsername);
    localStorage.setItem('isLoggedIn', 'true');
    router.push('/dashboard');
  };

  const handleReset = () => {
    localStorage.clear();
    setFormData({ discordServerId: '', discordUserId: '', twitchUsername: '' });
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0f0f23',
      color: '#ffffff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{
        backgroundColor: '#1a1a2e',
        border: '1px solid #333',
        borderRadius: '12px',
        padding: '40px',
        width: '100%',
        maxWidth: '400px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <div style={{
            fontSize: '48px',
            marginBottom: '16px'
          }}>🚀</div>
          <h1 style={{
            fontSize: '24px',
            fontWeight: 'bold',
            margin: '0 0 8px 0',
            background: 'linear-gradient(45deg, #667eea, #764ba2)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            Cosmic Raid
          </h1>
          <p style={{
            color: '#888',
            margin: 0,
            fontSize: '14px'
          }}>
            Enter your details to access the dashboard
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '14px',
              fontWeight: '500'
            }}>
              Discord Server ID
            </label>
            <input
              type="text"
              value={formData.discordServerId}
              onChange={(e) => setFormData(prev => ({ ...prev, discordServerId: e.target.value }))}
              placeholder="Your server's unique ID"
              required
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#16213e',
                border: '1px solid #333',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '14px',
                outline: 'none'
              }}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '14px',
              fontWeight: '500'
            }}>
              Discord User ID
            </label>
            <input
              type="text"
              value={formData.discordUserId}
              onChange={(e) => setFormData(prev => ({ ...prev, discordUserId: e.target.value }))}
              placeholder="Your personal Discord ID"
              required
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#16213e',
                border: '1px solid #333',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '14px',
                outline: 'none'
              }}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '14px',
              fontWeight: '500'
            }}>
              Twitch Username
            </label>
            <input
              type="text"
              value={formData.twitchUsername}
              onChange={(e) => setFormData(prev => ({ ...prev, twitchUsername: e.target.value }))}
              placeholder="Your Twitch channel name"
              required
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#16213e',
                border: '1px solid #333',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '14px',
                outline: 'none'
              }}
            />
          </div>

          <button
            type="submit"
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: '#667eea',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
              marginTop: '10px'
            }}
          >
            Continue
          </button>

          <div style={{
            textAlign: 'center',
            margin: '20px 0 10px 0',
            color: '#666',
            fontSize: '12px'
          }}>
            or
          </div>

          <button
            type="button"
            onClick={handleReset}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: 'transparent',
              color: '#888',
              border: '1px solid #333',
              borderRadius: '8px',
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            Clear Session & Reload
          </button>
        </form>
      </div>
    </div>
  );
}