# Punching Up

**Status:** Draft  
**Owner:** WoW Portal  
**Repository:** `wow-portal`

## Current Behavior

The portal does not compare recorded actor and creature levels at a kill.

## Outcome

Add a public leaderboard for the largest recorded level gap overcome in a creature kill.

## Definition

For each current character and recorded control type, find the valid creature-kill event with the largest positive `levelDelta = value1 - actor_level`, where `value1` is the killed creature’s level at that moment. Accept direct and pet kills because both are credited to the owner. Rows with a zero/invalid actor level, invalid creature level, or `levelDelta <= 0` do not qualify.

Choose one personal record per character by greatest delta, then greater creature level, earlier event time, and lower event ID. Rank personal records by delta descending, creature level descending, event time ascending, then character name/GUID. Limit to 25.

## Data and Query Contract

Read valid `CREATURE_KILL`/`direct` and `CREATURE_KILL_PET`/`pet` rows. Require creature target type, positive target entry, zero `value2`, `actor_level BETWEEN 1 AND 80`, and a plausible positive creature level. Join current non-deleted characters by realm/GUID, require account consistency, apply population and account visibility before the window/ranking operation, and resolve the NPC through `creature_template`.

Select personal records by `(realm_id, actor_guid, actor_is_bot)`, matching existing event leaderboards; the all-population view may show separate Player and Bot rows for one character. Return current character metadata plus `type`, `actorLevelAtKill`, `creatureEntry`, `creatureName`, `creatureLevel`, `levelDelta`, `killMethod` (`direct` or `pet`), and `occurredAt`. Missing current NPC metadata uses `Unknown creature #<entry>`.

No schema/module change is needed. Existing stats grants may need the same narrow `creature_template` columns already documented for boss kills.

## HTTP and Service Contract

Add `GET /api/stats/punching-up?population=players|all`, defaulting to players. Return the standard generated time, population, event coverage, count, and entries.

Use the shared 30/minute limiter, 8-second query timeout, 60-second cache partitioned by population and visibility, 25-row cap, `Cache-Control: no-store`, and `Vary: Cookie`. Invalid filters are 400. Safe dependency or integrity failure is HTTP 503 with `{"error":"Punching Up statistics are temporarily unavailable."}`.

## UI, Access, and Privacy

Add a “Punching Up” public Stats card. Present the achievement in plain language, for example “Level 18 defeated Level 23 Example (+5),” and show direct/pet method and date. Clarify that this is a killing blow, not proof of a solo kill. Provide accessible loading, empty, error, retry, table, and stacked mobile states.

## Acceptance and Verification

- Only positive, valid level gaps qualify.
- A later weaker kill cannot replace a character’s stronger record.
- Pet kills count once for their owner and are labeled correctly.
- Visibility/population filters execute before per-character and global ranking.
- Ties, unknown creatures, row parsing, and the 25-row limit are deterministic.
- Tests cover personal-record selection, invalid levels, filters/cache isolation, safe errors, and time serialization.
- Operator verification performs a controlled higher-level kill and uses `EXPLAIN` to validate the event/window query.

## Non-Goals

Solo verification, group size, item-level handicaps, PvP level gaps, damage contribution, and kills from before event collection are out of scope.
