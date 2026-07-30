import Link from 'next/link';
import { ExternalLink, MessageSquare } from 'lucide-react';

export default function MessagesPage() {
  return (
    <section className="flex h-[calc(100vh-8.5rem)] min-h-[36rem] flex-col overflow-hidden rounded-xl border bg-card shadow-xl">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold"><MessageSquare className="h-5 w-5" /> Commlink Messaging</h1>
          <p className="text-xs text-muted-foreground">Choose one Discord channel or an all-channel read lane; replies remain locked to their source.</p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link className="rounded-md border px-3 py-2 hover:bg-muted" href="/forwarding">Discord native tools</Link>
          <a className="flex items-center gap-1 rounded-md border px-3 py-2 hover:bg-muted" href="https://spmt.live/?view=commlink" target="_blank" rel="noopener noreferrer">
            Open full workspace <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>
      <iframe
        className="min-h-0 flex-1 border-0"
        src="https://spmt.live/commlink/?embedded=1"
        title="SPMT Commlink messaging workspace"
        allow="microphone; autoplay; clipboard-write"
      />
    </section>
  );
}
