# Completionist Quest-Completion Leaderboard

Status: Implemented locally; operator verification required  
Repository: `wow-portal`  
Depends on: `specs/react-frontend-foundation.md`, `specs/site-navigation.md`, `specs/stats-population-filter.md`  
Data contract owner: sibling `mod-player-statistics`

## Feasibility Decision

This statistic is implementable entirely in `wow-portal` with the data already recorded by `mod-player-statistics`.

No AzerothCore source change, module change, new event, event-schema migration, worldserver rebuild, or live gameplay hook is required. Depending on its exact current column grants, the statistics database reader may need additional read-only event columns for coverage and contract validation; that is an operator permission adjustment, not a gameplay-server change.

## Problem

The statistics module records quest completion events, but the portal does not aggregate or display them. Players want a visible `Completionist` award showing who has completed the most recorded quests while retaining the Stats page's event-time Playerbot population behavior.

## User Outcome

The Stats page contains a responsive award panel:

```text
📜 Completionist
Most quests completed
```

It highlights the current leader or tied leaders and shows up to 25 highest recorded quest-completion totals with current character metadata.

The page-level population control applies consistently:

- `Players only` counts quest completions recorded while the character was human-controlled.
- `Players + bots` counts both human- and Playerbot-controlled quest completions, retaining separate Player and Bot rows when one character has events in both modes.

## Current Data Contract

The module's default-enabled `PLAYERHOOK_ON_PLAYER_COMPLETE_QUEST` hook writes one `QUEST_COMPLETE` event with:

```text
actor_guid       = completing character GUID
actor_account_id = completing character's account ID at event time
actor_is_bot     = WorldSession::IsBot() at event time
target_type      = Quest (4)
target_entry     = quest ID
target_guid      = 0
value1/value2    = 0
source           = quest
```

The event is emitted when AzerothCore invokes the completion hook. The portal consumes this contract as written and does not infer completion from current quest-log state, achievements, account names, or character type.

## Accepted Meaning of “Most Quests Completed”

Version 1 counts `QUEST_COMPLETE` event rows, not distinct quest IDs.

Consequences:

- Completing a non-repeatable quest normally adds one.
- Completing a repeatable, daily, weekly, seasonal, or otherwise repeatable quest again adds another event and therefore another completion.
- Abandoning or failing a quest adds nothing.
- A quest completed before event tracking began adds nothing.
- A completion performed while event collection was disabled or unavailable cannot be reconstructed by the portal.

This choice matches the requested phrase “most quests completed” and the module's documented quest-completion leaderboard query. It also preserves accurate event-time Player/Bot filtering. Do not label the value as every unique quest the character has ever completed.

Visible supporting copy must say:

```text
Recorded quest completions since tracking began. Repeatable quests count each time.
```

Counting distinct quest IDs or querying current `character_queststatus_rewarded` state is a possible future statistic, but it has different semantics and cannot preserve event-time Human/Bot classification for completions that occurred before event tracking.

## Character and Control-Type Grouping

Group by:

```text
actor_guid, actor_is_bot
```

This deliberately allows one character to appear twice in `population=all`:

```text
Thalgrim | Player | 84
Thalgrim | Bot    | 211
```

Do not permanently classify a character from its account, its latest event, its current online mode, or whether it has ever been controlled as a bot.

Population behavior:

- `players`: filter `actor_is_bot = 0` before aggregation.
- `all`: include both flag values and keep separate control-type groups.

Historical rows with an incorrect/default bot flag remain limited by the stored event data. The portal must not attempt to repair them heuristically.

## Coverage Metadata

Return the earliest `event_time` among all `QUEST_COMPLETE` rows as coverage metadata, independent of the selected population. Call this `firstRecordedAt`, not “tracking enabled at,” because the first recorded completion does not prove there were no configuration gaps before or after it.

When no quest-completion row exists, `firstRecordedAt` is `null` and the leaderboard is empty. The UI shows the empty state without inventing a start date.

Coverage copy must remain honest:

```text
Recorded quest completions from <date> onward. Repeatable quests count each time.
```

The implementation may use “since tracking began” in compact views only when the detailed scope copy remains present in the same panel.

## Display Metadata

Join each aggregated character GUID to the current AzerothCore `characters` row and its current auth account:

- Character name, race, class, level, and account association are current values at query time.
- Exclude characters whose current row is absent or whose deletion marker is populated.
- Display `Unknown account` when the current account row cannot be resolved; never expose the numeric account ID.
- Translate race and class IDs through the existing `src/domain/wotlk.ts` mappings.
- Keep unknown numeric race/class values using the existing friendly fallback instead of failing the full response.

The API and browser never receive character GUID, numeric account ID, quest IDs, database names, raw bot flags, or event IDs.

## Query Contract

Implement the equivalent of this bounded query using validated qualified database identifiers and bound event/source values:

```sql
WITH quest_contract AS (
    SELECT
        MIN(event_time) AS first_recorded_at,
        MAX(
            target_type <> 4
            OR target_entry = 0
            OR target_guid <> 0
            OR target_is_bot <> 0
            OR value1 <> 0
            OR value2 <> 0
            OR source <> 'quest'
            OR actor_guid = 0
            OR actor_is_bot NOT IN (0, 1)
        ) AS has_invalid_event
    FROM mod_player_stats_events
    WHERE event_type = 'QUEST_COMPLETE'
),
quest_totals AS (
    SELECT
        e.actor_guid,
        e.actor_is_bot,
        COUNT(*) AS quest_completions
    FROM mod_player_stats_events e
    WHERE e.event_type = 'QUEST_COMPLETE'
      /* Add e.actor_is_bot = 0 for population=players. */
    GROUP BY e.actor_guid, e.actor_is_bot
),
eligible_totals AS (
    SELECT
        q.actor_guid,
        q.actor_is_bot,
        q.quest_completions,
        c.name AS character_name,
        c.race AS race_id,
        c.class AS class_id,
        c.level,
        a.username AS account_login
    FROM quest_totals q
    JOIN characters c ON c.guid = q.actor_guid
    LEFT JOIN account a ON a.id = c.account
    WHERE c.deleteDate IS NULL
    ORDER BY
        q.quest_completions DESC,
        c.name ASC,
        q.actor_is_bot ASC
    LIMIT 25
)
SELECT ...
FROM quest_contract qc
LEFT JOIN eligible_totals e ON TRUE;
```

The implementation may vary the SQL shape to handle the empty metadata row cleanly, but it must preserve the contract, ordering, and bounded result.

Query rules:

- Use one fixed query variant per accepted population or bind a normalized internal population value. Never interpolate a raw query parameter.
- Calculate coverage across the complete quest event type, not only the selected population.
- Apply population filtering before grouping.
- Join current character/account metadata before `LIMIT` so deleted/missing characters do not consume leaderboard slots.
- Safely convert `COUNT(*)`, which the driver may return as a string or large numeric type.
- Reject negative, fractional, non-finite, or unsafe-integer totals.

Ordering is part of the contract:

1. Quest completions descending.
2. Character name ascending using the accepted case-insensitive database comparison.
3. Player before Bot for an otherwise identical row.

## Contract-Integrity Checks

If any `QUEST_COMPLETE` row violates the documented target, numeric, source, actor, or bot-flag contract, fail the complete response with HTTP `503` and log one concise contract-integrity category. Do not silently exclude malformed rows and present a plausible but incomplete leaderboard.

Extra future columns are ignored. A versioned intentional change to `QUEST_COMPLETE` payload semantics requires coordinated module and portal specifications rather than weakening this check silently.

An empty event set is valid and is not a contract-integrity failure.

## Database and Performance

Reuse the existing read-only statistics connection and validated auth/characters database identifiers. This feature requires only narrowly scoped reads from:

- `<characters database>.mod_player_stats_events`;
- `<characters database>.characters`;
- `<auth database>.account`.

At minimum, the event grant must cover `event_time`, `event_type`, `actor_guid`, `actor_is_bot`, `target_type`, `target_entry`, `target_guid`, `target_is_bot`, `value1`, `value2`, and `source`. If the deployed reader lacks any of them, add only the missing column-level `SELECT` privileges as an explicit operator step.

No world database, new table, database write, migration, backfill, or portal-state database is required. Portal startup must not alter grants automatically.

The existing event indexes are the starting point. Run `EXPLAIN` against the safe/live-compatible query before deployment. Current event volume is suitable for direct bounded aggregation with the existing 60-second server cache. If measured performance becomes inadequate, propose a query-supported additive index or rollup in a separate specification; do not mutate the module schema as part of this portal feature.

## Service and Cache Design

Use focused server modules consistent with the deaths leaderboard:

- a quest-completion leaderboard service owns SQL, row validation, mapping, caching, and response construction;
- a thin route owns query validation and public errors;
- a typed browser API module validates the response;
- a visual panel owns only presentation and client sorting of returned rows.

Cache requirements:

- cache successful results for 60 seconds;
- maintain independent `players` and `all` entries;
- coalesce concurrent refreshes for the same population;
- never use an `all` cache entry for `players` or vice versa;
- return unavailable after an expired-cache refresh failure rather than indefinitely serving stale results;
- keep the cache in process with no new persistence;
- set public response `Cache-Control: no-store`.

## HTTP API

Add:

```text
GET /api/stats/quest-completions?population=players
GET /api/stats/quest-completions?population=all
```

Use the shared population convention:

- missing defaults to `players`;
- exactly one `players` or `all` value is accepted;
- invalid or repeated values return HTTP `400`;
- server validation is independent of browser URL normalization.

Successful response:

```json
{
  "generatedAt": "2026-08-26T20:30:00.000Z",
  "population": "players",
  "coverage": {
    "firstRecordedAt": "2026-08-19T19:37:55.990Z"
  },
  "count": 1,
  "entries": [
    {
      "characterName": "Thalgrim",
      "race": "Dwarf",
      "class": "Paladin",
      "level": 80,
      "accountLogin": "SHANE",
      "isBot": false,
      "questCompletions": 84
    }
  ]
}
```

For an empty valid result, `coverage.firstRecordedAt` is `null`, `count` is `0`, and `entries` is `[]`.

Unavailable response, HTTP `503`:

```json
{
  "error": "Quest completion statistics are temporarily unavailable."
}
```

Apply the same modest per-client read rate limit used by other Stats endpoints. Database/configuration/contract failures never become a false empty result.

## React Panel

Add the panel to a responsive `Server Awards` region on the Stats page. When the Server MVP panel is also implemented, the two panels may share a two-column desktop grid and stack on narrow screens. Neither panel's failure may hide or disable the other.

Panel content:

- decorative scroll emoji hidden from assistive technology;
- accessible heading `Completionist`;
- visible subtitle `Most quests completed`;
- coverage/repeatable-quest scope copy;
- winner summary when at least one row exists;
- a table of up to 25 server-ranked results.

The highest returned total is the winning value. Every returned entry with that same total is a co-winner. Do not arbitrarily crown only the alphabetically first tied row.

Suggested table columns:

- Character
- Race
- Class
- Level
- Account
- Type
- Quest completions

Reuse the accessible table/sort behavior established by `DeathLeaderboardPanel`. Client sorting reorders only the returned top 25 and must not be described as recalculating the full server leaderboard. The winner summary remains based on the server-ranked result, not the current client sort.

States:

- loading: `Loading quest completion statistics...`;
- empty: `No recorded quest completions for this population yet.`;
- unavailable: `Quest completion statistics are temporarily unavailable.`;
- populated: winner summary, scope copy, and leaderboard.

Use a TanStack Query key such as:

```text
["stats", "quest-completions", population]
```

Pass its abort signal to `fetch`, use a 60-second stale time, disable polling/retries, and never show the previous population's rows beneath a newly selected filter.

## Accessibility and Responsive Behavior

- Use a semantic section with an associated heading.
- Keep the emoji decorative; the accessible name comes from text.
- Announce initial loading/error/empty changes appropriately without repeatedly announcing cached refreshes.
- Mark tied winners in text, not color alone.
- Preserve visible keyboard focus and existing sortable-header semantics.
- Transform rows into the established stacked mobile table layout without horizontal page scrolling.
- Maintain readable number formatting without converting totals into ambiguous abbreviations.

## Public Access, Privacy, and Errors

This panel remains unauthenticated, matching the accepted Stats access decision. It may expose current character name, race, class, level, account login, event-time Player/Bot label, and aggregate completion count.

It must not expose:

- character GUID or numeric account ID;
- quest IDs or names;
- email, IP, security level, ban state, login/session data, salts, or verifiers;
- event IDs/timestamps beyond aggregate coverage;
- database/schema names, SQL, stack traces, or raw driver errors.

Log only a concise error category. Never log query result rows during normal operation.

## Failure Behavior

- Stats database unavailable or misconfigured: this panel returns/shows unavailable; other portal features continue.
- No `QUEST_COMPLETE` rows: valid empty response.
- Event setting disabled after prior data: existing totals remain, but the portal cannot detect the gap; scope copy continues to say recorded completions.
- Deleted character: excluded.
- Missing current account row: show `Unknown account`.
- Unknown race/class: show the existing fallback.
- Invalid event contract or database row: fail the complete response.
- Population changes during a request: abort/ignore the obsolete response and never mix populations.

## Out of Scope

- Unique quest IDs completed.
- Counting current rewarded-quest state from `character_queststatus_rewarded`.
- Quest names, zones, chains, categories, recent quest feed, or per-quest drill-down.
- Distinguishing daily, weekly, repeatable, seasonal, dungeon, raid, or story quests.
- Reconstructing completions from before module tracking.
- Account-level aggregation across multiple characters.
- Bots-only, time-range, realm, faction, or character filters.
- Module/schema/config changes or live database writes.

## Acceptance Criteria

- The Stats page displays `Completionist` with subtitle `Most quests completed`.
- The server counts existing `QUEST_COMPLETE` rows according to the module contract.
- Repeatable completions count each time and the panel says so.
- Players-only and Players + bots use `actor_is_bot` at event time and distinct query/cache keys.
- One character can appear separately as Player and Bot in the combined population.
- Tied highest totals are presented as co-winners.
- Deleted/missing characters do not consume top-25 slots.
- Coverage reports the earliest recorded quest event or `null` for an empty result without claiming continuous collection.
- API/browser responses contain none of the prohibited internal identifiers or quest details.
- Database/configuration/contract failures return `503`, not a false empty result.
- The panel is independently accessible, responsive, and failure-isolated.
- No AzerothCore/module/schema change is required.
- `npm run build` and `npm test` pass.

## Automated Verification

Server/service tests cover:

- players and all query variants;
- direct raw event counting, including repeated quest IDs counting repeatedly;
- separate Player/Bot groups for one character;
- deterministic ordering and top-25 bounding after current-character eligibility;
- tied winners in returned order;
- coverage timestamp and valid empty metadata row;
- deleted character, missing account, and unknown race/class behavior;
- malformed event contract and malformed/unsafe count rejection;
- 60-second cache separation, expiry, and concurrent request coalescing;
- API default/valid/invalid/repeated population cases, rate limit, and `503` behavior;
- response-field privacy.

Frontend tests cover:

- loading, empty, unavailable, populated, and tied-winner states;
- exact title/subtitle and repeatable-completion scope copy;
- population-specific query key/request and transition behavior;
- response runtime validation;
- table sorting without changing the server-defined winner;
- keyboard, screen-reader, and narrow-layout behavior;
- independent rendering when another award panel fails.

Use mocked database/fetch boundaries. Automated tests must not contact the live database or worldserver.

## Operator Verification

1. Confirm `PlayerStatistics.Events.QuestCompletions` is enabled in the deployed module configuration without printing unrelated configuration values.
2. Run the final query and `EXPLAIN` with the least-privilege statistics reader.
3. Complete one ordinary quest on a human-controlled test character and confirm its Players-only total increases after cache expiry.
4. Complete a repeatable quest twice and confirm both completions count.
5. Complete a quest while a test character is Playerbot-controlled and confirm it appears only in Players + bots under a Bot row.
6. Verify a character used in both modes produces separate groups.
7. Check tied-winner, empty, database-unavailable, desktop, mobile, and keyboard behavior.
8. Inspect browser responses and logs for prohibited identifiers or database details.

## Implemented Product Decision

Repeatable quests increase the Completionist total each time, matching the implemented `COUNT(*)` event-row contract. A future change to “most unique quest IDs recorded” requires a separate coordinated specification and `COUNT(DISTINCT target_entry)` semantics.
