# Professional Procrastinator

**Status:** Draft  
**Owner:** WoW Portal  
**Repository:** `wow-portal`

## Current Behavior

The portal records level changes but does not rank completed wall-clock leveling intervals.

## Outcome

Add a public character leaderboard for the longest recorded wall-clock wait between consecutive, ordinary one-level gains.

## Definition

Use the same valid adjacent `LEVEL_CHANGE` pair contract as Ding Dong Dash, but keep each character/control-type pair’s longest interval and rank durations descending. Both events must be single-level gains, share the same `actor_is_bot` value, form a continuous level chain, and be immediately adjacent in that character’s complete valid level-event history.

Offline time deliberately counts: this is a playful procrastination statistic, not a measure of active played time. Only completed intervals qualify; elapsed time since a character’s latest ding never counts. Multi-level boosts, decreases, duplicates, and broken chains are excluded.

Personal-record ties choose the earlier ending interval, then lower event ID. Global ties use earlier end time, character name, and GUID. Return 25.

## Data and Query Contract

Validate the `LEVEL_CHANGE`/`level` contract, empty target fields, level range 1–80, and ordered timestamps/IDs. Establish adjacency before population filtering; then require both endpoints to match `players` or accept either for `all`. Require matching realm, actor GUID, and actor account across both rows.

Join current non-deleted character/auth metadata, apply visibility before rank, and return `fromLevel`, `toLevel`, `startedAt`, `endedAt`, integer `durationMilliseconds`, and Player/Bot type. The all view may show one row of each type for one character. Reject negative or unsafe durations rather than coercing them.

No schema/module change is required. Approve the window query with `EXPLAIN` and an 8-second live-volume measurement; specify any needed index/rollup separately.

## HTTP and Service Contract

Add `GET /api/stats/professional-procrastinator?population=players|all`, default players. Return the normal generated time, population, event coverage, count, and entries envelope.

Use the shared statistics limiter, query timeout, 60-second population/visibility cache, 25-row cap, no-store response, and `Vary: Cookie`. Invalid population is 400. Safe service failures are 503 with `{"error":"Professional Procrastinator statistics are temporarily unavailable."}`.

## UI, Access, and Privacy

Add “Professional Procrastinator” to the public Stats grid. Show character, level span, human-friendly duration, and end date. Copy must state that logged-out time counts and only time between completed normal dings is measured. Use an exact screen-reader duration and accessible loading, empty, unavailable, retry, sortable, and mobile states.

## Acceptance and Verification

- The longest valid completed interval per character wins.
- Current time after the last event is never used.
- Boosts, decreases, broken chains, and population-filter bridges are rejected.
- Visibility/account integrity occurs before ranking; ties are stable.
- Tests cover multi-day intervals, adjacency, control-type transitions, malformed/negative time, cache separation, and route errors.
- Operator verification uses controlled dated fixtures or natural dings and approves `EXPLAIN` on deployed data volume.

## Non-Goals

Active `/played` time between levels, account inactivity, character age, shaming notifications, and pre-module history are out of scope.
