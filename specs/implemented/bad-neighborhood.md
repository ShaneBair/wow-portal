# Bad Neighborhood

**Status:** Implemented locally; deployment verification remains  
**Owner:** WoW Portal  
**Repository:** `wow-portal`

## Current Behavior

The portal reports character death totals but has no zone-level death aggregation.

## Outcome

Add a public server-wide leaderboard of the zones where the most recorded character deaths occur.

## Definition

“Bad Neighborhood” counts canonical `PLAYER_DEATH` events by positive `zone_id`. It intentionally starts at the `canonical_player_death_v1` cutover and does not mix older cause-specific rows into this geographic total.

- The actor is the dead character.
- `population=players` requires `actor_is_bot = 0`; `all` includes both values.
- Hidden accounts’ deaths are excluded before aggregation.
- Rows with `zone_id = 0` are omitted and reported only as `omittedUnknownZoneDeaths` metadata.

Rank by `deaths DESC`, `uniqueVictims DESC`, then zone name and ID ascending. Return 25 zones.

## Data and Query Contract

Read the migration cutoff and post-cutover `PLAYER_DEATH` rows. Validate the canonical v1 contract: `source = 'canonical'`, no target, target bot false, zero values, positive actor identifiers, and event ID greater than the immutable cutoff. Apply visibility against `event.actor_account_id`; no current character join is required. Count unique victims as distinct `(realm_id, actor_guid)`.

Resolve each `zone_id` through a source-controlled WotLK 3.3.5a AreaTable zone catalog. The implementation must document the catalog’s source/revision and include a test for every displayed ID; it must not query an invented world SQL table. An unresolved positive ID is `Unknown zone #<id>` and remains counted. Return `zoneId`, `zoneName`, `deaths`, and `uniqueVictims`.

No database migration or module change is required. The existing event/migration reads are sufficient.

## HTTP and Service Contract

Add `GET /api/stats/bad-neighborhood?population=players|all`, defaulting to players. A successful response contains `generatedAt`, `population`, coverage with `comprehensiveSince` from the canonical migration, `omittedUnknownZoneDeaths`, and `entries`.

Use the shared statistics limiter, 8-second timeout, 60-second cache keyed by population and visibility scope, 25-row maximum, no-store responses, and `Vary: Cookie`. Invalid population is HTTP 400. A missing/ambiguous migration marker, contract mismatch, bad zone catalog, timeout, or database failure is HTTP 503 with `{"error":"Bad Neighborhood statistics are temporarily unavailable."}`.

## UI, Access, and Privacy

Add a “Bad Neighborhood” card to the public Stats grid. Show zone, deaths, and unique victims, plus “Complete locations since <cutover date>.” Do not imply that historical deaths before that date are included. Provide accessible loading, empty, unavailable, retry, and responsive stacked states.

## Acceptance and Verification

- Only canonical rows above the stored cutoff contribute.
- Creature/PvP detail rows do not double count canonical deaths.
- Zero zones are excluded from ranking and accurately summarized.
- Population and account visibility apply before totals and rank.
- Zone-name fallback and deterministic ties work.
- Tests cover cutoff integrity, zone catalog resolution, unknown zones, filters/cache scope, and safe errors.
- Operator verification compares a controlled death’s event zone to the in-game zone, verifies exactly one increment, and runs `EXPLAIN`.

## Non-Goals

Cause-of-death breakdowns, coordinates, heat maps, reconstructing pre-cutover geography, and exposing individual victims are out of scope.
