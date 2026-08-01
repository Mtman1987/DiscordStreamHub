# StreamWeaver Integration Handoff

Implemented in DiscordStreamHub:

- `POST /api/points/tenant-balances`
- `POST /api/discord/activity/tenant-summary`
- `POST /api/leaderboard/render`
- Native `sw_dsh_rank:<serverId>` interaction handling
- Forwarding for all `sw_pokemon_*` component interactions to StreamWeaver

The forwarding target comes from the public runtime config key `streamweaverUrl`.
Authentication uses the existing DSH client/service secret.

Implemented in the paired StreamWeaver patch:

- `sw_pokemon_collection:mine`
- `sw_pokemon_deck:mine`
- Existing trade-card, offer, accept, and decline handlers remain supported.

Deployment order:

1. Deploy StreamWeaver with the paired patch.
2. Deploy DiscordStreamHub with this repository.
3. Confirm both apps share a matching service credential.
4. Test `!leaderboard`, `Check My Rank`, `!collection`, `Open My Cards`,
   `Build Deck`, and the complete two-person trade flow.
