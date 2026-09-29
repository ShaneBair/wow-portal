# Ding Dong Dash

**Status:** Draft  
**Owner:** WoW Portal  
**Repository:** `wow-portal`

## Current Behavior

The portal records level changes but does not calculate intervals between ordinary dings.

## Outcome

Add a public character leaderboard for the shortest recorded time between two consecutive, ordinary one-level gains.

## Definition

Order `LEVEL_CHANGE` events by `(event_time, id)` within each `(realm_id, actor_guid)`. A candidate interval consists of two immediately adjacent events when both are single-level gains (`value2 = value1 + 1`), have the same `actor_is_bot` value, and the first event’s new level equals the second event’s old level. Its duration is from the first event time to the second.

This intentionally excludes level boosts/jumps, decreases, repeated levels, broken chains, and a character’s first observed ding. Offline time is wall-clock time and remains part of an interval. For each current character keep the shortest candidate; rank by `durationMilliseconds ASC`, later `toLevel DESC`, earlier end time, then character name/GUID. Return 25.

## Data and Query Contract

Validate `LEVEL_CHANGE`, source `level`, no target, zero target bot flag, levels between 1 and 80, and nondecreasing event IDs/times. Build adjacency over the complete valid per-character event stream first. Then require both events to satisfy the requested population (`players`: both `actor_is_bot = 0`; `all`: either flag) so filtering cannot skip an intervening event and create a false pair.

Keep personal records by `(realm_id, actor_guid, actor_is_bot)`, so the all view may show separate Player and Bot rows for one character. Join the winning record to a current non-deleted character by realm/GUID, require account consistency for both events, and apply account exclusions before global rank. Return current metadata, `type`, `fromLevel` (first event’s new level), `toLevel` (second event’s new level), `startedAt`, `endedAt`, and exact integer `durationMilliseconds`.

No migration or module change is required. The window query must pass `EXPLAIN` and the 8-second production-size budget; otherwise an additive index/rollup needs its own specification.

## HTTP and Service Contract

Add `GET /api/stats/ding-dong-dash?population=players|all`, default players. Return the standard generated time, population, event coverage, count, and at most 25 entries.

Use the shared limiter, 8-second timeout, 60-second population/visibility cache partition, `Cache-Control: no-store`, and `Vary: Cookie`. Invalid population is 400. Contract, row, database, or timeout failures return 503 with `{"error":"Ding Dong Dash statistics are temporarily unavailable."}`.

## UI, Access, and Privacy

Add “Ding Dong Dash” to the public Stats grid. Show character, level span, compact duration, and completion date. Explain “Fastest wall-clock time between consecutive recorded one-level gains; boosts excluded.” Preserve an exact accessible text duration and provide loading, empty, error, retry, sortable, and responsive states.

## Acceptance and Verification

- A `10→11` followed by `11→12` creates a level-11-to-12 interval.
- A `12→20` boost, decrease, discontinuity, or filtered intervening event cannot create or bridge a candidate.
- Millisecond precision and deterministic ties are preserved.
- Both endpoints obey population, account, visibility, and character integrity rules.
- Tests cover adjacency, identical timestamps, boosts, gaps, control-type transitions, cache scope, and safe errors.
- Operator verification performs two controlled normal dings and one multi-level administrative/portal change, then checks results and `EXPLAIN`.

## Non-Goals

Played-time duration, speed from character creation, current in-progress levels, XP rates, or reconstructing levels before event collection are out of scope.
