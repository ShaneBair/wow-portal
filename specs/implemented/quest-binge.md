# Quest Binge

**Status:** Implemented  
**Owner:** WoW Portal  
**Repository:** `wow-portal`

## Outcome

Add a public character leaderboard for the most quests completed during one completed UTC calendar day.

## Definition

Group valid `QUEST_COMPLETE` events by character, recorded control type, and UTC date. Each completion event counts, including repeatable quests completed more than once. For every current character/control-type pair, keep the completed day with the largest count; exclude the current incomplete UTC day.

Rank by `questsCompleted DESC`, `uniqueQuests DESC`, `day ASC`, then character name/GUID. Return 25. The population filter and visibility policy apply before daily grouping.

## Data and Query Contract

Require event type `QUEST_COMPLETE`, quest target type, positive quest `target_entry`, source `quest`, zero target GUID/bot flag, and zero values. Interpret `event_time` in UTC independently of database-host time-zone settings. Join current non-deleted characters on realm/GUID, require event/current account agreement, and calculate `uniqueQuests` as distinct quest entries in the winning day.

Group by `actor_is_bot`, so the all-population view may contain separate Player and Bot rows for one character. Return current character metadata plus `type`, `day` (`YYYY-MM-DD` UTC), `questsCompleted`, and `uniqueQuests`. No migration, world join, or module change is required.

Production-volume verification covered 55,981 quest events within 4.3 million total events. `EXPLAIN ANALYZE` completed in approximately 0.6 seconds for players and 7.5 seconds for all characters. The exact concurrent integrity-plus-history service path completed in approximately 6.0 seconds for players and 6.6 seconds for all characters, below the eight-second timeout. The all-population query uses the existing `idx_bot_event_time` index to avoid the optimizer’s slower character-first plan.

## HTTP and Service Contract

Add `GET /api/stats/quest-binge?population=players|all`, default players. Return `generatedAt`, `population`, `coverage.firstRecordedAt`, `count`, and at most 25 entries.

Use the existing stats population parser, 30/minute limiter, 8-second timeout, 60-second cache keyed by population and visibility scope, no-store browser response, and `Vary: Cookie`. Invalid population is 400. Safe failures return HTTP 503 with `{"error":"Quest Binge statistics are temporarily unavailable."}`.

## UI, Access, and Privacy

Add a “Quest Binge” public Stats card showing character, completions, unique quests, and UTC day. Explain that repeatable completions count and today is withheld until complete. Localize the displayed date but label the bucket UTC. Provide accessible loading, empty, unavailable, retry, sortable, and responsive states.

## Acceptance and Verification

- Repeating one quest increments completions but not unique quests.
- Events across midnight UTC fall on separate days and the current day is excluded.
- One best day per character is selected with deterministic ties.
- Contract, character/account, population, and visibility checks precede grouping.
- Tests freeze the clock and cover UTC boundaries, repeatables, cache separation, invalid data, and route errors.
- Operator verification completes controlled quests over an eligible day fixture and approves the deployed `EXPLAIN` plan.

## Non-Goals

Rolling 24-hour windows, quest-chain completion, difficulty scoring, retroactive quest-log inspection, and current-day live races are out of scope.
