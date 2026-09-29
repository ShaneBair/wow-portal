# The Real Raid Boss

**Status:** Implemented locally; deployment verification remains  
**Owner:** WoW Portal  
**Repository:** `wow-portal`

## Current Behavior

The portal has no NPC-kills-character route, service, or Stats card.

## Outcome

Add a public statistics card ranking the NPCs that have killed the most characters: the mobs that are the server’s real raid bosses.

## Definition

Count valid `PLAYER_KILLED_BY_CREATURE` events and group them by the killer’s creature `target_entry`.

- The event actor is the dead character; the target is the killing creature.
- Environmental, fatigue, falling, drowning, PvP, and unknown-cause deaths do not count.
- This is a creature-death-detail board, not the canonical total-deaths board.
- `population=players` filters dead actors to `actor_is_bot = 0`; `all` includes both.
- Hidden victim accounts contribute nothing under standard visibility.

Rank by `characterKills DESC`, `uniqueVictims DESC`, then creature name and entry ascending. Return 25 rows.

## Data and Query Contract

Read `mod_player_stats_events` and resolve `target_entry` through the configured world database’s `creature_template`. Validate event type, creature target type, positive target entry, source `creature`, positive creature level in `value1`, and zero `value2` before accepting a row.

Apply visibility to `event.actor_account_id` before aggregation; do not require a current character row. Compute `uniqueVictims` as distinct `(realm_id, actor_guid)`. Missing world metadata is displayed as `Unknown creature #<entry>` rather than dropping valid history.

The response row is `creatureEntry`, `creatureName`, `characterKills`, and `uniqueVictims`. No migration or module change is required. Reuse the event and world reads needed by existing statistics, adding only narrowly scoped columns if the deployed grant lacks the creature name.

## HTTP and Service Contract

Add `GET /api/stats/real-raid-boss?population=players|all`, defaulting to `players`. Use existing statistics population validation, 30/minute limiter, 8-second timeout, 60-second cache keyed by population plus visibility scope, maximum 25 rows, `Cache-Control: no-store`, and `Vary: Cookie`.

Successful responses contain `generatedAt`, `population`, `coverage.firstRecordedAt`, and `entries`. Invalid population is HTTP 400. All unavailable, malformed, timeout, or contract-integrity cases are HTTP 503 with `{"error":"Real Raid Boss statistics are temporarily unavailable."}`; log only a safe error category.

## UI, Access, and Privacy

Add “The Real Raid Boss” to the responsive Stats grid. Show NPC name, character kills, and unique victims, with copy explaining that only recorded creature killing blows are included. The card is public; optional authentication only affects configured account visibility. Implement accessible loading, empty, error, and retry states, with a non-color-only rank indicator.

## Acceptance and Verification

- Two deaths to different spawns of one creature entry aggregate together.
- Canonical `PLAYER_DEATH` rows are not added and PvP/environmental deaths are not implied.
- Population and hidden-account rules filter victims before grouping and ranking.
- Missing NPC metadata has a safe fallback.
- Deterministic ties and the 25-row cap are enforced server-side.
- Automated tests cover contract rejection, visibility/cache isolation, unknown metadata, route errors, and row parsing.
- Operator verification runs `EXPLAIN`, performs a controlled creature death, confirms exactly one increment, and checks standard versus privileged visibility.

## Non-Goals

Total deaths, encounter wipes, damage dealt, assists, raid membership, and reconstructing deaths before module collection are out of scope.
