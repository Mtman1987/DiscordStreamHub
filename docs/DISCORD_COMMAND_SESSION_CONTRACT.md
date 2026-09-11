# Discord command session contract

Discord commands use the identity supplied by the gateway or verified interaction. They do not carry a website SPMT cookie. Internal callers use existing service credentials; browser sessions remain the account UI's identity mechanism.

## Shared media

The voice adapter's `!wr`, `!watch`, `!add`, and `!accept` target HearMeOut's `discord-watch-room`. Music uses `discord-music-room`. Guild/channel IDs must not create separate movie sessions. Activities and website players observe these same shared sessions.

HearMeOut recognizes legacy numeric `guildId-channelId` and `watch-guildId-channelId` IDs as aliases of the shared movie session. Arbitrary private room names remain distinct. Previously, the voice adapter's generated ID was rejected by browser-session middleware before the movie handler ran.

## Actor access

`POST /api/admin/access` accepts DSH's existing service bearer credentials and browser SPMT sessions. Service callers supply `serverId` and `userId`; DSH resolves privileges from its runtime owner ID and stored server/member records. Incoming privilege flags are ignored. Service authentication identifies the calling app, not an administrator: ordinary members return false privilege flags. Browser callers can query only their linked Discord identity.

## Other affected live callbacks

StreamWeaver's Discord card-trade interaction and Lost Signal generation handlers validate their own service credentials and must be reachable before browser-session middleware. Mixed browser/service chat, TTS, Twitch events/clips, private response/finalization, and memory handlers admit a valid internal credential before requiring a browser session. Handler tenant/actor checks remain in place.

The audit also checked SPMT's service routes, Nebula's bot credential path, and SpaceMountain's machine forwarding. This repair needs no new secret or blanket browser login removal.

## Regression checks

Tests execute cookie-free movie middleware paths with current and legacy Discord IDs, verify different guilds select one movie session, exercise owner/member/browser/service admin lookup, and verify authenticated service routing. No live messages or playback changes are made by the checks.
