# Vendor Trash Magnate

**Status:** Implemented locally; deployment grant, configuration, and live sale verification remain  
**Owner:** WoW Portal  
**Repository:** `wow-portal`

## Current Behavior

The portal does not read AzerothCore achievement-statistic progress for vendor income.

## Outcome

Add a public leaderboard of current characters by the cumulative money AzerothCore records as earned from selling items to vendors.

## Definition and Limitation

Use the WotLK achievement-statistic counter whose deployed `Achievement_Criteria.dbc` type is `ACHIEVEMENT_CRITERIA_TYPE_MONEY_FROM_VENDORS` (core enum value 59). Despite the playful title, this includes all qualifying vendor sales, not only poor-quality “gray” items.

This counter is cumulative per character and does not retain the controller type of each sale. The board therefore has fixed `population: "all-characters"` and sits outside the Players/All event-population control. It must not infer bot status from account names, account ranges, current sessions, or unrelated event rows.

Rank positive counters descending, then character name/GUID ascending. Return 25 current, non-deleted characters.

## Criterion Verification and Configuration

Before implementation, inspect the exact `Achievement_Criteria.dbc` loaded by the deployed AzerothCore revision and identify the single canonical criterion ID for enum type 59. Record the evidence in the implementation notes and configure the positive integer as `STATS_VENDOR_MONEY_CRITERIA_ID` in `.env.example` with a placeholder only. Never guess or silently default the ID.

If the deployed DBC contains no criterion, or multiple rows whose counter semantics cannot be proven nonduplicative, stop and revise this specification. Misconfiguration must fail this panel closed with a safe unavailable response.

## Data and Query Contract

Read current character/auth metadata plus only `guid`, `criteria`, and `counter` from `STATS_CHARACTERS_DATABASE.character_achievement_progress`. Filter by the bound configured criterion ID, `counter > 0`, live non-deleted characters, and account visibility before ordering/limiting.

Treat the unsigned counter as copper. Never coerce it through a JavaScript `number`; validate and return `copper` as a base-10 string, plus a server-produced `displayMoney` in gold/silver/copper. Return current character name, race, class, level, and account name. Do not return account IDs or criterion IDs.

No schema or module change is required. Add a least-privilege column-scoped SELECT grant for the progress table if absent; document it in the deployment README/migration helper without altering live data.

## HTTP and Service Contract

Add `GET /api/stats/vendor-trash-magnate` with no population parameter. Return `generatedAt`, `population: "all-characters"`, `coverage: {"kind":"azerothcore-lifetime-counter"}`, `count`, and at most 25 entries. Reject a supplied `population` query with 400.

Use the shared 30/minute limiter, 8-second timeout, 60-second cache keyed by visibility scope and verified criterion ID, `Cache-Control: no-store`, and `Vary: Cookie`. Safe configuration, database, counter, or integrity failure is 503 with `{"error":"Vendor Trash Magnate statistics are temporarily unavailable."}`.

## UI, Access, and Privacy

Add the public “Vendor Trash Magnate” card outside the event population filter. Label it “All current characters” and explain that it uses AzerothCore’s cumulative vendor-sales counter and may include activity from before portal event collection. Provide accessible money text, loading, empty, unavailable, retry, sortable, and responsive states.

## Acceptance and Verification

- Only the DBC-verified type-59 criterion is queried with a bound parameter.
- Large counters retain exact copper precision and format correctly at gold/silver boundaries.
- Deleted and hidden-account characters are excluded before rank/limit.
- No actor-type claim or event-history coverage date is shown.
- Tests cover config parsing, SQL binding, bigint validation/formatting, cache visibility, empty rows, and safe errors.
- Operator verification grants only required columns, sells a known-price item to a vendor, confirms the counter delta, and runs `EXPLAIN`.

## Non-Goals

Gray-item-only totals, purchase spending, auction income, per-item sales, bot/human historical splitting, and changing achievement counters are out of scope.

## Implementation Notes

Criterion verification was completed against the DBC loaded by the local deployed worldserver on
2026-09-29. `Achievement_Criteria.dbc` is a WDBC file with 7,655 records, 31 fields, and 124-byte
records. It contains two enum-type-59 rows:

- criterion `3361`, parent achievement `921`, description and parent title “Gold from vendors”;
- criterion `4091`, parent achievement `328` (“Total gold acquired”), description “Money from
  vendors”.

The matching AzerothCore vendor-sale path calls the type-59 update once with the sale price, and the
achievement manager applies that same accumulated delta to every criterion of the type. An
identifier-free deployed-data check found 33 rows for each criterion, the same observed range of
22 through 2,094,739 copper, and zero differing counters among matching character rows. The two
rows are therefore duplicate representations of the same vendor income rather than additive
sources. Criterion `3361` is the canonical portal choice because it is the dedicated vendor-income
statistic; `4091` is the duplicated component beneath the aggregate “Total gold acquired” statistic.
The runtime setting remains mandatory so a different deployment cannot inherit this conclusion
silently.
