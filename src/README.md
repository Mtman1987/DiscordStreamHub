# Discord Stream Hub Source Notes

This app is a cloud-hosted Next.js application deployed on Fly.io.

Runtime state is stored in the volume-backed SQLite database configured by `DB_FILE`, defaulting to `/data/app.db` in production. Generated media and clip assets are stored on the Fly volume under `STORAGE_PATH`, defaulting to `/data/clips`.

The active client compatibility layer is `src/lib/data-shim.ts`; it talks to the app's `/api/db` route and should be treated as an app database shim.

Secrets belong in Fly secrets or environment variables. Public runtime config belongs in the volume-backed `runtime-config.json`.
