'use client';

import { useState } from 'react';

export default function SignalRemoveClient({ controlToken }: { controlToken: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Only the person who sent this Signal or an approved DSH administrator can remove it.');
  const [done, setDone] = useState(false);

  async function removeSignal() {
    if (!controlToken || busy || done) return;
    setBusy(true);
    try {
      const response = await fetch('/api/signal/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ controlToken }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || payload.message || 'Signal removal failed.');
      }
      setDone(true);
      setMessage(payload.message || 'Signal removed from the live shoutout rotation.');
      window.setTimeout(() => {
        try { window.close(); } catch {}
      }, 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#090b12', color: '#f4f6ff', fontFamily: 'system-ui,sans-serif', padding: '1rem' }}>
      <section style={{ width: 'min(34rem, calc(100vw - 2rem))', padding: '2rem', textAlign: 'center', border: '1px solid #292f43', borderRadius: '1rem', background: '#111522', boxShadow: '0 1rem 4rem rgba(0,0,0,.35)' }}>
        <button
          type="button"
          onClick={removeSignal}
          disabled={!controlToken || busy || done}
          aria-label="Remove Signal"
          style={{ appearance: 'none', border: 0, background: 'transparent', fontSize: '4rem', lineHeight: 1, cursor: busy || done ? 'default' : 'pointer' }}
        >
          🗑️
        </button>
        <h1 style={{ fontSize: '1.2rem', margin: '1rem 0 .5rem' }}>Remove Signal shoutout</h1>
        <p style={{ minHeight: '3rem', margin: 0, color: '#b7bdd1', lineHeight: 1.5 }}>
          {controlToken ? message : 'This Signal control link is invalid.'}
        </p>
        {!done && controlToken && (
          <p style={{ margin: '1rem 0 0', color: '#858ca3', fontSize: '.9rem' }}>Tap the trash can to confirm.</p>
        )}
      </section>
    </main>
  );
}
