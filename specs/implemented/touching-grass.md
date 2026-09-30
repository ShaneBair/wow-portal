# Touching Grass

**Status:** Implemented locally; deployment verification remains
**Owner:** WoW Portal  
**Repository:** `wow-portal`

## Current Behavior

The portal does not aggregate distinct zones containing recorded character activity.

## Outcome

Add a public character leaderboard for the widest recorded geographic activity across Azeroth and Outland.

## Definition

For each current character and recorded control type, count distinct positive `zone_id` values on valid default event streams: `CREATURE_KILL`, `CREATURE_KILL_PET`, `PLAYER_DEATH`, `PLAYER_KILLED_BY_CREATURE`, `PVP_KILL`, `LEVEL_CHANGE`, `QUEST_COMPLETE`, and `ACHIEVEMENT`. Multiple events in a zone count once. Optional high-volume events are deliberately excluded so enabling them cannot change the definition.

Rank by `zonesVisited DESC`, `mapsVisited DESC`, `lastRecordedAt ASC`, then character name/GUID. Population and visibility filters apply before distinct counting. This measures recorded activity footprint, not literal movement or complete exploration.

## Data and Query Contract

Validate each accepted event against its documented type/source/target/value contract. Use `zone_id > 0` for zone count and positive `map_id` where valid for map count. Canonical and cause-detail events may describe the same death, but `COUNT(DISTINCT zone_id)` prevents duplication from inflating the metric.

Join current non-deleted characters by realm/GUID, require account agreement, and group by `actor_is_bot`; the all view can show separate Player and Bot rows for one character. Return character metadata, `type`, `zonesVisited`, `mapsVisited`, `firstRecordedAt`, and `lastRecordedAt`. Resolve zone names only for optional detail UI through the same versioned WotLK 3.3.5a AreaTable catalog defined for Bad Neighborhood; the leaderboard itself does not need to return a full zone list.

No schema/module change is required. This all-history distinct query must pass `EXPLAIN` and an 8-second live-volume check; otherwise specify an index or rollup separately.

## HTTP and Service Contract

Add `GET /api/stats/touching-grass?population=players|all`, default players. Return the standard generated time, population, event coverage, count, and at most 25 entries.

Use the shared limiter, timeout, 60-second population/visibility cache partition, `Cache-Control: no-store`, and `Vary: Cookie`. Reject invalid population with 400. Contract ambiguity, malformed rows, database failure, or timeout is 503 with `{"error":"Touching Grass statistics are temporarily unavailable."}`.

## UI, Access, and Privacy

Add a “Touching Grass” public Stats card showing character, distinct recorded zones/maps, and activity span. Copy must say “zones with recorded activity” and must not call this the Explorer achievement or distance traveled. Provide accessible loading, empty, error, retry, sortable, and responsive states.

## Acceptance and Verification

- Repeated/multiple event types in one zone count once.
- Optional loot/XP/money events never change the result.
- Zero/unknown locations do not count.
- Population, visibility, character/account integrity, and deletion checks precede aggregation.
- Tests cover the event allowlist, distinct behavior, separate actor-flag rows, cache scope, malformed contracts, and safe errors.
- Operator verification records valid activity in two zones and approves the deployed query plan.

## Non-Goals

Distance traveled, exploration-achievement criteria, coordinates, paths, heat maps, a zone checklist, and activity before event collection are out of scope.
