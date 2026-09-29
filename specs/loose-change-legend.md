# Loose Change Legend

**Status:** Draft; implementation gated on deployed DBC criterion verification  
**Owner:** WoW Portal  
**Repository:** `wow-portal`

## Current Behavior

The portal does not read AzerothCore’s cumulative money-looted statistic.

## Outcome

Add a public leaderboard of current characters by cumulative money looted from the world.

## Definition and Limitation

Use the deployed WotLK achievement-statistic criterion whose type is `ACHIEVEMENT_CRITERIA_TYPE_LOOT_MONEY` (core enum value 67). This is AzerothCore’s counter definition; it is not current wallet balance, quest rewards, vendor sales, mail, trade, or auction income.

The cumulative character counter cannot be separated by historical human/bot controller. This panel is fixed to `population: "all-characters"`, outside the event population selector, and must not use heuristic bot classification.

Rank positive copper counters descending, then character name/GUID; return 25 live characters.

## Criterion Verification and Configuration

Verify the exact canonical criterion ID against the `Achievement_Criteria.dbc` loaded by the deployed core. Expose it as required positive integer `STATS_LOOT_MONEY_CRITERIA_ID`; put only a placeholder and explanation in `.env.example`. There is no default.

If criterion mapping is absent or ambiguous, the feature remains unavailable until this specification is revised; never sum multiple apparent rows without proving their semantics.

## Data and Query Contract

Query the configured criterion in `character_achievement_progress` and join current non-deleted `characters` plus auth account metadata. Apply universal account visibility before ordering and limit. Read only `guid`, `criteria`, and `counter` from the progress table.

Return current character metadata, exact base-10 string `copper`, and server-formatted `displayMoney`. Parse the unsigned database counter without JavaScript precision loss. Do not expose criterion/account IDs. No migration or module change is needed; add only a documented column-scoped SELECT grant if the portal database user lacks it.

## HTTP and Service Contract

Add `GET /api/stats/loose-change-legend` without a population parameter. The success envelope includes `generatedAt`, `population: "all-characters"`, `coverage.kind: "azerothcore-lifetime-counter"`, count, and up to 25 entries. Supplying `population` is HTTP 400.

Use the shared limiter, 8-second timeout, 60-second visibility-and-criterion-keyed cache, no-store response, and `Vary: Cookie`. Configuration, query, malformed counter, or integrity failures are HTTP 503 with `{"error":"Loose Change Legend statistics are temporarily unavailable."}`.

## UI, Access, and Privacy

Add “Loose Change Legend” to the public Stats grid outside population-controlled panels. Label it “All current characters” and describe it as AzerothCore’s cumulative money-looted statistic, potentially predating portal event collection. Money must have readable visible and screen-reader text; include loading, empty, unavailable, retry, sortable, and responsive states.

## Acceptance and Verification

- Only the verified type-67 criterion is queried through a parameter.
- Wallet balance and other income sources are not presented as loot.
- Copper stays exact beyond JavaScript’s safe integer range and formats correctly.
- Visibility and deleted-character filtering occur before rank/limit.
- Tests cover required configuration, bigint parsing/formatting, SQL binding, cache scope, and safe failures.
- Operator verification loots a known coin amount, confirms the counter delta, checks least-privilege grants, and runs `EXPLAIN`.

## Non-Goals

Current wealth, item value, money-source breakdowns, event-based deltas, historical controller type, and retroactive reconstruction are out of scope.
