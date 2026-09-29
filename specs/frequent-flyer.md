# Frequent Flyer

**Status:** Draft; implementation gated on deployed DBC criterion verification  
**Owner:** WoW Portal  
**Repository:** `wow-portal`

## Current Behavior

The portal does not read AzerothCore’s cumulative travel-spending statistic.

## Outcome

Add a public leaderboard of current characters by cumulative money spent on AzerothCore travel services.

## Definition and Limitation

Use the deployed WotLK achievement-statistic counter whose criteria type is `ACHIEVEMENT_CRITERIA_TYPE_GOLD_SPENT_FOR_TRAVELLING` (core enum value 63). The implementation must validate with a controlled flight-path purchase exactly which travel actions the deployed core increments. The card measures money spent, not distance or number of flights.

The counter has no historical controller flag, so the board is fixed to `population: "all-characters"`, outside the Players/All selector. No account-name, current-session, or event-history bot heuristic is permitted.

Rank positive copper counters descending, then character name/GUID; return 25 current non-deleted characters.

## Criterion Verification and Configuration

Inspect the exact deployed `Achievement_Criteria.dbc`, identify the single canonical criterion ID for enum type 63, and configure required `STATS_TRAVEL_MONEY_CRITERIA_ID`. Document a placeholder in `.env.example`, never a guessed default.

An absent or ambiguous mapping fails this panel closed. Multiple rows must not be summed unless a revised specification documents why their counters are disjoint.

## Data and Query Contract

Read only `guid`, `criteria`, and `counter` from `character_achievement_progress`, filtered by the bound verified ID and positive counter. Join current non-deleted character/auth metadata and apply universal account visibility before rank/limit.

Return current character metadata, exact decimal-string `copper`, and server-formatted `displayMoney`; never convert the database bigint to a JavaScript number or expose account/criterion IDs. No schema/module change is required. Add a documented least-privilege SELECT grant for the required progress columns only if absent.

## HTTP and Service Contract

Add `GET /api/stats/frequent-flyer` with no population query. Return `generatedAt`, `population: "all-characters"`, `coverage.kind: "azerothcore-lifetime-counter"`, count, and no more than 25 entries. Reject supplied population values with 400.

Use the shared 30/minute limiter, 8-second timeout, 60-second visibility/criterion cache partition, `Cache-Control: no-store`, and `Vary: Cookie`. Safe config, database, counter, or integrity failure returns 503 with `{"error":"Frequent Flyer statistics are temporarily unavailable."}`.

## UI, Access, and Privacy

Add the public “Frequent Flyer” card outside event-population control. Show cumulative travel spending and label it “All current characters.” Copy must say this is AzerothCore’s travel-spend counter—not miles traveled or flights taken—and may include activity before portal event collection. Include accessible money text and loading, empty, unavailable, retry, sortable, and mobile states.

## Acceptance and Verification

- Only the DBC-verified type-63 criterion is queried with a bound parameter.
- A controlled paid flight produces the expected counter delta; unrelated spending does not during the check.
- Exact copper survives bigint parsing and formats correctly.
- Hidden/deleted characters are filtered before ranking; cache scopes do not leak.
- Tests cover configuration, SQL binding, bigint formatting, route validation, cache separation, and safe errors.
- Operator verification checks the DBC mapping, least-privilege grant, live travel increment, and `EXPLAIN` plan.

## Non-Goals

Distance traveled, map coverage, flight count, mounts, portals, hearthstones, historical controller splitting, and changing core counters are out of scope.
