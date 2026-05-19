import { NextResponse } from 'next/server';

function html(clientId: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Discord Stream Hub Activity</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #0d0f12; color: #e5edf5; font-family: Arial, system-ui, sans-serif; }
    main { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 14px; padding: 14px; }
    .panel { background: #171b20; border: 1px solid #334155; border-radius: 8px; overflow: hidden; }
    header, .controls, .meta, aside section { padding: 14px; }
    header { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
    h1, h2, p { margin: 0; }
    h1 { font-size: 20px; }
    h2 { font-size: 15px; margin-bottom: 10px; }
    .muted { color: #94a3b8; font-size: 13px; }
    .video-wrap { position: relative; aspect-ratio: 16/9; background: #000; }
    video { width: 100%; height: 100%; background: #000; display: block; }
    .empty { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; color: #94a3b8; gap: 8px; }
    button, input { min-height: 38px; border-radius: 6px; border: 1px solid #475569; background: #1e293b; color: #e5edf5; padding: 8px 10px; }
    button { cursor: pointer; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    button:hover { border-color: #34d399; }
    input { width: 100%; background: #020617; }
    .controls { display: flex; flex-wrap: wrap; gap: 8px; border-top: 1px solid #334155; }
    .volume { min-width: 220px; flex: 1; display: flex; align-items: center; gap: 8px; border: 1px solid #475569; border-radius: 6px; background: #0f172a; padding: 8px 10px; }
    .volume input { min-height: 0; padding: 0; accent-color: #34d399; }
    .download { min-height: 38px; display: inline-flex; align-items: center; border-radius: 6px; border: 1px solid #475569; background: #1e293b; color: #e5edf5; padding: 8px 10px; text-decoration: none; }
    .download:hover { border-color: #34d399; }
    aside { display: grid; gap: 14px; align-content: start; }
    section { background: #171b20; border: 1px solid #334155; border-radius: 8px; }
    form { display: grid; gap: 8px; }
    ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
    li { color: #cbd5e1; font-size: 13px; border-top: 1px solid #263241; padding-top: 8px; }
    .status { color: #86efac; border: 1px solid rgba(52,211,153,.5); border-radius: 999px; padding: 5px 10px; font-size: 13px; white-space: nowrap; }
    .error { color: #fecaca; margin-top: 8px; font-size: 13px; }
    @media (max-width: 850px) { main { grid-template-columns: 1fr; } }
  </style>
  <script src="/activity-hls"></script>
</head>
<body>
  <main>
    <section class="panel">
      <header>
        <div>
          <p class="muted">Discord Watch Requests</p>
          <h1 id="room">Room</h1>
        </div>
        <div class="status" id="activity-status">Loading</div>
      </header>
      <div class="video-wrap">
        <video id="video" controls playsinline></video>
        <div class="empty" id="empty"><strong>No video loaded</strong><span>Type !wr in Discord or use the request box.</span></div>
      </div>
      <div class="controls">
        <button data-action="play">Play</button>
        <button data-action="pause">Pause</button>
        <button data-action="seek">Sync</button>
        <button data-action="next">Next</button>
        <button data-action="clear">Clear</button>
        <button id="fullscreen" type="button">Fullscreen</button>
        <button id="download" type="button" disabled>Download</button>
        <div class="volume">
          <button id="mute" type="button">Volume</button>
          <input id="volume" type="range" min="0" max="100" value="85" aria-label="Video volume" />
          <span id="volume-label">85%</span>
        </div>
      </div>
      <div class="meta">
        <strong id="title">Waiting for a request</strong>
        <p class="muted" id="media">Media: idle</p>
      </div>
    </section>
    <aside>
      <section>
        <h2>Test Request</h2>
        <form id="request-form">
          <input id="query" placeholder="Try Big Buck Bunny, Sintel, HLS" />
          <button type="submit">Request</button>
        </form>
        <p class="error" id="error"></p>
      </section>
      <section>
        <h2>Queue</h2>
        <ul id="queue"><li>Queue is empty.</li></ul>
      </section>
      <section>
        <h2>Activity</h2>
        <ul id="events"><li>No events yet.</li></ul>
      </section>
    </aside>
  </main>
  <script src="/activity-lite.js" defer></script>
</body>
</html>`;
}

export async function GET() {
  return new NextResponse(html(process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || ''), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
