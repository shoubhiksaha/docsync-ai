'use client';

import { useEffect } from 'react';
import { reportError } from '@/client/telemetry';

// Replaces the root layout when it fails, so no providers or global CSS are available here.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportError(error, 'global', error.digest), [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', background: '#0a0a0a', color: '#f2f5f4' }}>
        <main style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.4rem', marginBottom: 8 }}>DocSync AI couldn&apos;t load</h1>
          <p style={{ color: '#a3ada9', marginBottom: 4 }}>Please try again in a moment.</p>
          <p lang="hi" style={{ color: '#a3ada9', marginBottom: 20 }}>DocSync AI लोड नहीं हो सका। कृपया थोड़ी देर में फिर कोशिश करें।</p>
          <button
            onClick={reset}
            style={{ minHeight: 44, padding: '10px 20px', borderRadius: 8, border: 'none', background: '#01f9c9', color: '#0a0a0a', fontSize: '1rem', fontWeight: 600, cursor: 'pointer' }}
          >
            Try again / फिर कोशिश करें
          </button>
        </main>
      </body>
    </html>
  );
}
