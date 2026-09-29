# Bot Wrangler

**Status:** Draft  
**Owner:** WoW Portal  
**Repository:** `wow-portal`

## Current Behavior

The portal records PvP bot flags but has no human-versus-bot leaderboard.

## Outcome

Add a public leaderboard for human-controlled characters that defeat Playerbot-controlled characters in PvP.

## Definition

Count valid `PVP_KILL` events where `actor_is_bot = 0` and `target_is_bot = 1`. Group by the human killer and show both total `botKills` and distinct bot victim GUIDs. Rank by bot kills descending, unique bot victims descending, then killer name/GUID ascending. Return 25.

This board has fixed human-versus-bot semantics and is not controlled by the Stats page’s Players/All population selector. The panel must visibly say “Human killers • Bot victims.”

## Data and Query Contract

Require PVP event type, player target type, positive actor and target GUIDs, source `player`, positive victim level in `value1`, positive victim account ID in `value2`, and `target_entry = 0`. Join the killer to a current non-deleted character by realm/GUID and require `actor_account_id = characters.account`.

Universal visibility applies to both sides: under standard scope, omit an event if either the killer account (`actor_account_id`) or victim account (`value2`) is excluded. Extend the account-exclusion helper with explicitly allowlisted event columns/expressions; do not accept arbitrary SQL identifiers. A privileged viewer’s full scope may include those events. Do not expose bot victim names, GUIDs, or account IDs.

Return current killer metadata, `botKills`, `uniqueBotVictims`, and `lastBotKillAt`. No schema, module, or world-database change is required.

## HTTP and Service Contract

Add `GET /api/stats/bot-wrangler` with no population parameter; reject unexpected `population` values with HTTP 400 rather than silently ignoring them. Return `generatedAt`, fixed `population: "human-vs-bot"`, `coverage.firstRecordedAt`, `count`, and entries.

Use the shared 30/minute limiter, 8-second timeout, 60-second cache keyed by account-visibility scope, 25-row cap, `Cache-Control: no-store`, and `Vary: Cookie`. Safe dependency or integrity failure is HTTP 503 with `{"error":"Bot Wrangler statistics are temporarily unavailable."}`.

## UI, Access, and Privacy

Add “Bot Wrangler” to the public Stats grid outside the population selector’s controlled panels. Show killer, bot kills, distinct bot victims, and latest recorded kill. Explain that bot status is the module’s authoritative session flag, so a character only counts as a bot victim when bot-controlled for that death. Provide accessible loading, empty, error, retry, table, and mobile states.

## Acceptance and Verification

- Human-to-bot PvP increments the board; human-to-human, bot-to-human, and bot-to-bot do not.
- Repeated kills of one bot affect total but not distinct-victim count.
- Either side being a hidden account removes the event from standard results before ranking.
- Victim identifiers never reach the browser.
- Tests cover all actor/target flag combinations, both visibility sides, cache scope, contract rejection, limiting, and safe errors.
- Operator verification performs a controlled human-versus-bot PvP kill, confirms one increment, checks both visibility scopes, and runs `EXPLAIN`.

## Non-Goals

PvE bot kills, bot deaths without a PvP event, current bot status, victim name lists, PvP ratings, and a configurable definition of bot identity are out of scope.
