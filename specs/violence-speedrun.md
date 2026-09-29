# Violence Speedrun

**Status:** Draft  
**Owner:** WoW Portal  
**Repository:** `wow-portal`

## Current Behavior

The portal has no time-bucketed creature-kill records.

## Outcome

Add a public character leaderboard for the greatest number of recorded creature killing blows within one completed clock hour.

## Definition

Bucket valid direct and pet creature-kill events into fixed UTC hours (`HH:00:00` through just before the next hour). For each current character and recorded control type, retain the completed hour with the highest total. The current, incomplete UTC hour is excluded so every record had the same opportunity.

Rank personal records by `kills DESC`, `bucketStart ASC`, then character name/GUID. A bucket is not a rolling 60-minute window; the UI must say “UTC clock hour.” Population and account-exclusion filters apply to events before hourly grouping.

## Data and Query Contract

Accept only valid `CREATURE_KILL`/`direct` and `CREATURE_KILL_PET`/`pet` rows with creature targets, positive entries, and zero `value2`. Treat `event_time` as UTC and force the database session/time expression to UTC; do not inherit a host-local SQL time zone. Join current non-deleted characters by realm/GUID, require account consistency, then group by character and UTC hour.

Group by `actor_is_bot`, matching existing event leaderboards; the all view can show separate Player and Bot records for one character. Return current character metadata plus `type`, `bucketStart`, `bucketEnd`, `kills`, `directKills`, and `petKills`. No schema or module change is required.

Because this query groups history, implementation must run `EXPLAIN` against production-scale data. If it cannot finish within the 8-second budget with existing indexes, stop and propose an additive index or rollup migration in a separate reviewed specification; do not ship an unbounded slow query.

## HTTP and Service Contract

Add `GET /api/stats/violence-speedrun?population=players|all`, default players. Return the standard generated time, population, event-history coverage, count, and no more than 25 entries.

Use the shared 30/minute limiter, 8-second timeout, 60-second cache partitioned by population and visibility, `Cache-Control: no-store`, and `Vary: Cookie`. Invalid population is 400. Return HTTP 503 with `{"error":"Violence Speedrun statistics are temporarily unavailable."}` for safe dependency, integrity, or performance failures.

## UI, Access, and Privacy

Add “Violence Speedrun” to the public Stats grid. Show character, kill count, UTC hour/date, and direct/pet split. Explain the fixed-hour rule and recorded-killing-blow limitation. Use accessible loading, empty, unavailable, retry, sortable table, and mobile stacked states; render dates in the user’s locale while retaining an explicit UTC indicator.

## Acceptance and Verification

- Events at `12:59:59` and `13:00:00` enter different buckets.
- The active UTC hour is excluded.
- One best hour per character is ranked, with stable ties.
- Pet/direct events count once and invalid contracts fail closed.
- Filters, visibility, account consistency, and deleted-character checks precede grouping.
- Tests freeze time and cover UTC boundaries, DST independence, winning-bucket selection, cache isolation, and errors.
- Operator verification generates a small controlled burst, advances beyond the hour for validation, and confirms the approved `EXPLAIN` plan.

## Non-Goals

Rolling windows, damage-per-second, PvP kills, assists, instance-only filters, and historical kills before module collection are out of scope.
