# DiscordStreamHub Production Readiness Checklist

This app is intended to run as a Fly.io cloud app with a mounted volume. It should not depend on Firebase or Electron.

## Validation Gates

Run these before every staging or production deploy:

```bash
npm run lint
npm run typecheck
npm run build
```

If local Docker commands print a config permission warning, point Docker at an
accessible config directory before building or deploying:

```bash
DOCKER_CONFIG=.docker-cli-config
```

Expected current state:

- `lint` passes.
- `typecheck` passes.
- `build` passes.
- Build may still show non-fatal dynamic dependency warnings from Genkit/OpenTelemetry and `fluent-ffmpeg`.

## Staging Safety

Use a separate Fly app, separate volume, separate Discord application/bot, and separate Twitch OAuth app for staging.

Start from these examples:

- `fly.staging.toml.example`
- `runtime-config.staging.example.json`

Set this in staging until you are ready to test live side effects:

```bash
DISABLE_STARTUP_SERVICES=true
```

With that flag enabled:

- Container startup will not auto-call `/api/startup`.
- `POST /api/startup` will not start Twitch polling.
- `POST /api/startup` will not run Discord orphan cleanup.

Do not point staging at production Discord channels, production bot token, production Twitch callbacks, or the production mounted volume.

## Runtime Config

Production values are centralized in `src/lib/runtime-config.ts` and the persisted volume file:

```text
/data/runtime-config.json
```

For staging, create a separate volume-backed `runtime-config.json` with staging values for:

- `publicUrls.appUrl`
- `publicUrls.baseUrl`
- `publicUrls.chatTagApiBase`
- `publicUrls.chatTagBotUrl`
- `publicUrls.hearmeoutUrl`
- `publicUrls.streamweaverUrl`
- `publicUrls.clipWorkerUrl`
- `publicIds.twitchClientId`
- `publicIds.discordClientId`
- `publicIds.discordActivityApplicationId`
- `publicIds.hardcodedGuildId`
- `publicIds.hardcodedAdminDiscordId`
- `publicIds.hardcodedAdminTwitchId`
- `publicIds.chatTagChannelId`
- `publicIds.discordShoutoutChannelId`
- `publicIds.gifStorageChannelId`

`NEXT_PUBLIC_*` build args in `fly.toml` also need staging-specific values if a separate staging Fly config is created.

The staging runtime config example should be copied into the staging volume as:

```text
/data/runtime-config.json
```

## External Side Effects

Verify these manually in staging before production:

- `/api/startup` starts polling only when intended.
- Twitch polling posts to the correct test Discord channels.
- Discord orphan cleanup does not delete wanted production messages.
- OAuth callbacks use the staging app URL.
- Twitch embeds use the current hostname as the `parent`.
- GIF/media URLs use the current app URL.

## Duplicate Active Paths To Resolve Later

Do not delete these until each owner path is confirmed:

- `src/lib/calendar-discord-service.ts` and `src/lib/calendar-discord-service-new.ts`
- `src/app/api/discord/interactions/route.ts` is canonical; `/api/interactions`
  remains as a telemetry-emitting compatibility alias until its production
  traffic reaches an observed zero window.
- Clip/media services: clip management, clip rotation, GIF rotation, seeding, Discord GIF storage, VIP spotlight
- Twitch wrappers: `src/lib/twitch-api-service.ts`, `src/lib/twitch-service.ts`, root `twitch-service.ts`
- Discord send wrappers: `discord-sync-service`, `discord-bot-service`, direct Discord route fetches

## Production Deploy Rule

Do not deploy this branch to production until a staging app has passed:

- Build validation
- Login/session restore
- Runtime config check
- Dashboard navigation
- Calendar generation/refresh
- Leaderboard display/post
- Partner schedule post/refresh
- Twitch OAuth flow
- Discord OAuth flow
- Manual Discord send test
- Twitch polling dry run or private-channel live test
- Media/GIF generation test
