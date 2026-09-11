# Signal hunt delivery

Signal drops continue to be scheduled by StreamWeaver every 2–5 hours. DSH keeps each new drop available for one hour. Existing drops retain their stored expiry.

The source message retains its role mention and intercept button, with Discord's SUPPRESS_NOTIFICATIONS flag. A separate non-silent Signal Seeker alert in Nebula Arcade links to the source message and shows its expiry. The existing runtime chatTagChannelId identifies Nebula Arcade; an optional per-server servers/{guild}/config/signal-seeker notificationChannelId overrides it. Channel IDs are public configuration and the destination is verified against the guild before posting.

Hunters can intercept repeatedly. Each private response reveals one of six clues, alternating Rocket and Black Hole with increasingly concrete instructions. Progress is stored per Discord member and guild in signalHuntHints, so another hunter cannot consume someone else's clues and a new drop does not reset progress. After six, the two final directions alternate. The canonical Signal claim remains idempotent; title and role grants still use the existing completion pipeline.

The interaction acknowledges immediately before performing SPMT lookups. A failed claim gives a retry message; it does not say a reward was saved. Owner receipts remain enabled and no longer block the private hunter response.

Expiry is persisted in signalDrops. A timer removes the source and updates the Nebula notice to SIGNAL ENDED. The ingress worker also sweeps active drops at startup and every minute, recovering after restart or a failed deletion. A failed alert does not fail an already-posted source and make the scheduler duplicate it; it is logged for the operator.

## Hunter notification guidance

Signals themselves are silent. Set Nebula Arcade to Only @mentions to receive the Signal Seeker alerts, or choose Nothing to hunt quietly using mention badges. Keep other channels configured normally. People choosing All Messages in Nebula will receive its non-silent messages too. These changes apply to Signal hunt messages and the hunt invitation panel; they do not claim that all other ecosystem bot messages have been migrated yet.

## Validation

npm run test:signal-hunt exercises the real drop route with mocked Discord/DB boundaries, one-hour expiry, retryable deletion, non-silent role notices, wrong-server rejection, and progressive clues. npm run typecheck validates integration. The deploy workflow runs the hunt suite before deployment. No live Discord messages are sent by these tests.
