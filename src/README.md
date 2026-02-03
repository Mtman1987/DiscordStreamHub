# Streamer's Hub - A Firebase Studio Project

This is a Next.js application designed to be a central management hub for a streaming community, integrating with Discord and eventually Twitch. It features a robust backend powered by Firebase and Genkit for AI and server-side logic.

## 🚀 Getting Started & Configuration

To run and develop this application, you must first configure your environment variables.

1.  **Rename `.env.example` to `.env`**: If it doesn't exist, create a new file named `.env` in the root of the project.
2.  **Populate the Variables**: You will need to get credentials from the Discord developer portal.

```
# .env

# --- Discord Bot ---
# From your bot's General Information page.
DISCORD_APP_ID="YOUR_DISCORD_APPLICATION_ID"

# From your bot's General Information page. This is used to verify incoming webhooks.
DISCORD_PUBLIC_KEY="YOUR_DISCORD_PUBLIC_KEY"

# From your bot's "Bot" page (click Reset Token).
# This is essential for the bot to authenticate with Discord's API for actions.
DISCORD_BOT_TOKEN="YOUR_DISCORD_BOT_TOKEN_HERE"


# --- Twitch Integration (for future development) ---
# Create an application in the Twitch Developer Console to get these.
# Required for listening to chat, follows, subs, and other events.
TWITCH_CLIENT_ID="YOUR_TWITCH_CLIENT_ID_HERE"
TWITCH_CLIENT_SECRET="YOUR_TWITCH_CLIENT_SECRET_HERE"

# --- Internal Points Service ---
POINTS_SERVICE_SECRET="CHANGE_ME"
POINTS_SERVER_ID="YOUR_DISCORD_SERVER_ID"
# POINTS_API_URL="http://localhost:3000/api/points/update"

```

### Initial Data Sync

After configuring your `.env` file, the first thing you must do is run the database sync.

1.  Start the application (`npm run dev`).
2.  Navigate to the `/settings` page in your browser.
3.  Enter your Discord Server ID and click the **"Sync with Discord"** button.

This will populate your Firestore database with your server's members, roles, and channels, which is required for all other features to work.

---

## Twitch Points Worker

The `startup.ts` script boots a lightweight worker that authenticates with Twitch and forwards events to `/api/points/update`.

```
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
POINTS_SERVER_ID=...
POINTS_SERVICE_SECRET=...
POINTS_API_URL=http://localhost:3000/api/points/update

# Optional: emit fake events every 15s for local testing
MOCK_TWITCH_EVENTS=1
MOCK_TWITCH_USER_IDS=alice,bob
```

Run via `npx tsx startup.ts` (or your preferred runner). Pass `--event '{"userId":"alice","eventType":"follow"}'` for single-shot updates.

---

## 🛠️ Project Status & Feature Breakdown

### 1. Discord Bot & Interaction API

*   **Current State:** The application has a powerful API endpoint at `/api/discord` ready to receive all interactions from a Discord bot (slash commands, button clicks, modal submissions). It successfully verifies requests using the required `DISCORD_PUBLIC_KEY`.
*   **Slash Commands:**
    *   `/calendar`: This command will post a dynamic, auto-updating embed that shows both the event calendar and the community leaderboard. It includes buttons for users to add their own events or "Captain's Logs".
    *   `/delete_calendars`: A utility command to remove all calendar embeds posted by the bot in the server.
*   **Permissions:** The bot will need permissions to `Read Messages/View Channels`, `Send Messages`, `Manage Messages` (to delete the calendar), and `Manage Webhooks` (for forwarding/replying).

### 2. Dynamic Image Generation Engine

*   **Current State:** The application uses a sophisticated server-side image generation system powered by **Genkit** and the **`puppeteer`** library.
    *   `src/ai/flows/generate-calendar-image.ts`: This flow successfully queries Firestore for events and user logs, then programmatically draws a high-fidelity calendar image.
    *   `src/ai/flows/generate-leaderboard-image.ts`: This flow queries Firestore for the top users and generates a rich leaderboard image, complete with avatars and point totals.
*   **Unified Workflow:** Both the web app and Discord bot are designed to use these generated images as the **single source of truth** for visual data. The Discord interaction handler calls these image generation flows and uses the resulting base64 data URL to `PATCH` (update) the deferred message.

### 3. Community-Wide Points & Twitch Integration

*   **Current State:** The foundation is laid.
    *   The `LeaderboardSettings` entity and configuration card on the `/leaderboard` page allow the server owner to define point values for community actions.
    *   Placeholder credentials for the Twitch API are in the `.env` file, and `tmi.js` is included as a dependency.
    *   A secure backend endpoint now exists at `/api/points/update`. It uses the configured `POINTS_SERVICE_SECRET` to validate incoming updates and applies your leaderboard weights within Firestore.
    *   The root `twitch-service.ts`/`startup.ts` scripts provide a starter service: authenticate with Twitch, forward real events, or emit mock events during local development.
*   **Vision & Future Plans:**
    *   **Unified Economy:** The goal is to create a single point system that spans both Discord and Twitch, making Firestore the master record for a user's total points.
    *   **Twitch Event Listener:** Build on `twitch-service.ts` to hook into Twitch EventSub (webhook or WebSocket) or a chat client (`tmi.js`) and push events through `handleEvent`.
    *   **Decentralized Earning:** This service will listen for events (follows, subs, bits, active chatting) in the channels of **all community members** (not just the server owner).
    *   **Secure API Endpoint:** Use `/api/points/update` to apply point changes. Set `MOCK_TWITCH_EVENTS=1` with `MOCK_TWITCH_USER_IDS` when you need to exercise the integration without live Twitch traffic.
