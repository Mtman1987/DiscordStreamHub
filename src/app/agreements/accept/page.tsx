'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

const TERMS_URL = 'https://spmt.live/terms.html';
const PRIVACY_URL = 'https://spmt.live/privacy.html';

function AgreementAcceptanceContent() {
  const params = useSearchParams();
  const [data, setData] = React.useState<any>(null);
  const [error, setError] = React.useState('');
  const [reviewed, setReviewed] = React.useState(false);
  const [consent, setConsent] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const query = params.toString();

  const load = React.useCallback(async () => {
    const response = await fetch(`/api/applications/agreement?${query}`, { cache: 'no-store', credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to load agreement.');
    setData(payload);
  }, [query]);

  React.useEffect(() => { load().catch(e => setError(e.message)); }, [load]);

  const accept = async () => {
    setSubmitting(true); setError('');
    try {
      const response = await fetch('/api/applications/agreement', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: params.get('serverId'), applicationId: params.get('applicationId'), token: params.get('token'),
          reviewedTerms: reviewed, electronicConsent: consent,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Acceptance failed.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Acceptance failed.'); }
    finally { setSubmitting(false); }
  };

  if (error && !data) return <main className="mx-auto max-w-3xl p-6"><Card><CardContent className="p-6 text-destructive">{error}</CardContent></Card></main>;
  if (!data) return <main className="p-6 text-center">Loading verified SPMT agreement…</main>;
  const loginNext = `/agreements/accept?${query}`;
  const documentUrl = `/api/applications/agreement?${query}&format=document`;

  return <main className="mx-auto max-w-4xl space-y-4 p-4 md:p-8">
    <Card>
      <CardHeader>
        <CardTitle>SPMT {data.roleName} Community Terms</CardTitle>
        <CardDescription>Document hash: <code className="break-all">{data.document.hash}</code></CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.authenticated ? <div className="rounded border p-3 text-sm">Authorized account: <strong>{data.account?.username}</strong> · Discord ID {data.account?.discordUserId}</div> :
          <Button asChild><a href={`/login?next=${encodeURIComponent(loginNext)}`}>Authorize to sign</a></Button>}
        {data.authenticated && !data.identityMatches && <p className="text-sm text-destructive">This SPMT account is not linked to the approved Discord applicant. Sign out and authorize the correct account.</p>}
        <div className="flex flex-wrap gap-3 text-sm">
          <a className="underline" href={`${documentUrl}&download=1`}>Download agreement</a>
          <a className="underline" href={data.document.sourceUrl} target="_blank" rel="noreferrer">Published source</a>
          <a className="underline" href={TERMS_URL} target="_blank" rel="noreferrer">Terms of Service</a>
          <a className="underline" href={PRIVACY_URL} target="_blank" rel="noreferrer">Privacy Policy</a>
        </div>
        <iframe title="SPMT community terms" src={documentUrl} className="h-[55vh] w-full rounded border bg-white p-2" />
        {data.accepted ? <div className="rounded border border-green-600 p-4"><strong>Accepted {data.accepted.acceptedAt}</strong><div><a className="underline" href={data.accepted.receiptUrl}>Download acceptance receipt</a></div></div> : <>
          <div className="flex items-start gap-2"><Checkbox id="reviewed" checked={reviewed} onCheckedChange={value => setReviewed(value === true)} /><Label htmlFor="reviewed">I reviewed this Community Terms document, the <a className="underline" href={TERMS_URL} target="_blank" rel="noreferrer">Terms of Service</a>, and the <a className="underline" href={PRIVACY_URL} target="_blank" rel="noreferrer">Privacy Policy</a>; I confirm the account and role and intend to accept them.</Label></div>
          <div className="flex items-start gap-2"><Checkbox id="consent" checked={consent} onCheckedChange={value => setConsent(value === true)} /><Label htmlFor="consent">I consent to electronic records and an electronic signature for this acceptance.</Label></div>
          <Button onClick={accept} disabled={!data.identityMatches || !reviewed || !consent || submitting}>{submitting ? 'Recording acceptance…' : 'Accept Community Terms'}</Button>
        </>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  </main>;
}

export default function AgreementAcceptancePage() {
  return <React.Suspense fallback={<main className="p-6 text-center">Loading verified SPMT agreement…</main>}><AgreementAcceptanceContent /></React.Suspense>;
}
