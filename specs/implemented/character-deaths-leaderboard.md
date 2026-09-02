# Character Deaths Leaderboard

Status: Implemented; aggregation and coverage copy superseded by `specs/comprehensive-player-deaths.md`
Repository: `wow-portal`  
Depends on: `specs/react-frontend-foundation.md`, `specs/site-navigation.md`, `specs/stats-population-filter.md`  
Data contract owner: sibling `mod-player-statistics`

> This file records the version 1 creature/PvP leaderboard contract. Preserve its API, UI, security, caching, and population behavior, but use `specs/comprehensive-player-deaths.md` for the next aggregation query, cutover semantics, and coverage wording.

## Problem

The portal records gameplay events through `mod-player-statistics` but does not yet query or present historical statistics. Visitors want to see which characters have accumulated the most recorded deaths, with human and Playerbot activity controlled by the page-level population filter.

## User Outcome

The Stats page contains a `Most Deaths` leaderboard showing up to 25 rows with:

- Character
- Race
- Class
- Level
- Account
- Type: Player or Bot
- Deaths

Players only shows human-controlled death events. Players + bots shows both human-controlled and bot-controlled event groups.

## Accepted Scope of “Death”

Version 1 counts the two death categories already represented by the module:

1. Creature-caused deaths from `PLAYER_KILLED_BY_CREATURE`.
2. PvP deaths inferred from the victim target of `PVP_KILL`.

Environmental deaths such as falling, drowning, fatigue, lava, or other deaths without one of these recorded events are not included.

The panel must disclose this scope with supporting copy such as:

```text
Creature and PvP deaths recorded since tracking began.
```

Do not describe this value as every death that has ever occurred. Comprehensive death tracking would require a separate module event and specification.

## Event Interpretation

Creature death row:

```text
subject character GUID = actor_guid
subject bot flag       = actor_is_bot
```

PvP death row:

```text
subject character GUID = target_guid
subject bot flag       = target_is_bot
```

The two event sets are combined with `UNION ALL` and then grouped.

Do not count `PVP_KILL` against the killer. Do not count `CREATURE_KILL` or `CREATURE_KILL_PET` as player deaths.

## Character and Control-Type Grouping

Group by both subject character GUID and event-time bot flag.

This intentionally allows one character to appear twice when it has deaths in both control modes:

```text
Thalgrim | Player | 14
Thalgrim | Bot    | 37
```

This is more accurate than permanently labeling an alt character as human or bot.

Population behavior:

- `players`: include only derived death rows whose subject bot flag is `0` before aggregation.
- `all`: include derived death rows with either bot flag, retaining separate Player and Bot groups.

Historical rows created before reliable bot tagging may have defaulted to human. This leaderboard can only be as accurate as the stored event-time flags.

## Display Metadata

Join each aggregated subject GUID to the current AzerothCore `characters` row.

- Character name, race, class, level, and account association are current values at query time, not historical snapshots from the death event.
- Exclude characters whose current row is absent or whose `deleteDate` is non-null.
- Join the character's current account ID to the authentication database `account.id` and display `account.username`.
- If the character exists but its account row cannot be resolved, include the leaderboard row with `Unknown account` rather than exposing a numeric account ID.
- Translate race and class IDs through the existing `src/domain/wotlk.ts` mappings.
- Unknown numeric race/class values use the domain module's existing fallback labels and do not fail the complete response.

The API and browser must never receive character GUIDs, numeric account IDs, or database names.

## Accepted Public Access Decision

This Stats panel and API remain unauthenticated. Account login names for historical human and bot characters will therefore be visible to anyone who can reach the portal, including when those accounts are offline.

This broader exposure is an explicit owner-approved product decision. It does not authorize exposing email addresses, IP addresses, authentication salts/verifiers, security levels, account IDs, last-login data, or any other authentication-table field. Revisit the decision before broader public deployment or when portal authentication is introduced.

## Database Architecture

Historical aggregates should be read directly from MariaDB rather than executed as worldserver SOAP commands.

Add `mysql2` as a production dependency and use its promise-based connection-pool API. The exact compatible package version should be selected and locked during implementation.

Use one small read-only pool configured by environment variables:

```text
STATS_DB_HOST=
STATS_DB_PORT=3306
STATS_DB_USER=
STATS_DB_PASSWORD=
STATS_CHARACTERS_DATABASE=
STATS_AUTH_DATABASE=
```

Requirements:

- Add placeholder values and descriptions to `.env.example`; never copy live values.
- Do not assume Dad's MMO Lab container hostnames or database names. They must be supplied by configuration.
- Validate both configured database identifiers against `^[A-Za-z0-9_]+$` before constructing qualified table names. Prepared-statement placeholders cannot bind SQL identifiers.
- Use prepared values for all values that can be bound.
- Keep the pool deliberately small, with a connection limit no greater than four for this portal.
- Configure bounded connection establishment and request behavior supported by the selected driver.
- Do not log credentials, connection strings, or complete driver error objects that may contain configuration.
- Close the pool during test cleanup and any graceful application shutdown path introduced by the implementation.

The dedicated database user requires only `SELECT` access to:

- `<characters database>.mod_player_stats_events`
- `<characters database>.characters`
- `<auth database>.account`

Do not use the existing full-privilege AzerothCore database account. Creating the least-privilege database user is an operator step and must not be performed automatically by portal startup.

Missing or invalid Stats database configuration must not prevent Home, registration, server status, the online roster, or `/health` from running. The deaths API returns its documented unavailable response and logs one concise actionable server-side message.

## Query Shape

Implement the equivalent of this bounded query using validated qualified identifiers:

```sql
WITH recorded_deaths AS (
    SELECT
        e.actor_guid AS character_guid,
        e.actor_is_bot AS is_bot
    FROM mod_player_stats_events e
    WHERE e.event_type = 'PLAYER_KILLED_BY_CREATURE'

    UNION ALL

    SELECT
        e.target_guid AS character_guid,
        e.target_is_bot AS is_bot
    FROM mod_player_stats_events e
    WHERE e.event_type = 'PVP_KILL'
),
death_totals AS (
    SELECT
        character_guid,
        is_bot,
        COUNT(*) AS deaths
    FROM recorded_deaths
    /* Players-only filtering is applied here when requested. */
    GROUP BY character_guid, is_bot
)
SELECT ...
FROM death_totals d
JOIN characters c ON c.guid = d.character_guid
LEFT JOIN account a ON a.id = c.account
WHERE c.deleteDate IS NULL
ORDER BY d.deaths DESC, c.name ASC, d.is_bot ASC
LIMIT 25;
```

Use two fixed query variants or one query with a bound population value. Never concatenate the raw HTTP query value into SQL.

Ordering is part of the contract:

1. Deaths descending.
2. Character name ascending, case-insensitive according to the database/explicit comparison chosen by implementation.
3. Player before Bot for otherwise tied rows.

This server ordering determines which rows qualify for the top 25. Client-side column sorting may reorder only those returned rows; it must never be described as recalculating the leaderboard across all characters. If a future feature requires arbitrary database-wide sorting, filtering, or pagination, add explicit API parameters and implement all related operations server-side together.

The existing event indexes are the starting point. Run `EXPLAIN` against a safe database during operator verification. If performance is inadequate, propose a separate additive module migration with a query-supported index; do not silently mutate the module schema from this portal task.

## Service Design

Add focused server-side modules rather than placing SQL in the HTTP route. A reasonable structure is:

- `src/services/stats-database.ts`: configuration validation and pool ownership.
- `src/services/death-leaderboard.ts`: population-aware query, row validation, mappings, caching, and public result construction.
- `src/routes/stats-deaths.ts`: HTTP validation and response behavior.

Exact filenames may vary if the implementation preserves these responsibilities.

Validate every database row at runtime before returning it. Safely convert `COUNT(*)` values, which drivers may return as strings or large numeric types. Reject non-finite, negative, fractional, or unsafe-integer death totals.

## Cache and Concurrency

- Cache successful results for 60 seconds.
- Maintain independent cache entries for `players` and `all`.
- Concurrent requests for the same population during a refresh share one in-flight database promise.
- Do not allow an `all` response to satisfy a `players` request or vice versa.
- After cached data expires, a failed refresh returns unavailable rather than presenting stale data as current.
- The cache is in-process only and requires no new table.
- Public responses use `Cache-Control: no-store`; the deliberate server-side cache is the only required cache.

## HTTP API

Add:

```text
GET /api/stats/deaths?population=players
GET /api/stats/deaths?population=all
```

Query validation:

- Missing `population` defaults to `players`.
- Exactly `players` and `all` are accepted.
- Any other supplied value returns HTTP `400`.
- Multiple `population` values return HTTP `400`.

Successful response:

```json
{
  "generatedAt": "2026-08-24T16:00:00.000Z",
  "population": "players",
  "count": 1,
  "entries": [
    {
      "characterName": "Thalgrim",
      "race": "Dwarf",
      "class": "Paladin",
      "level": 42,
      "accountLogin": "SHANE",
      "isBot": false,
      "deaths": 14
    }
  ]
}
```

Requirements:

- `generatedAt` is an ISO 8601 UTC timestamp representing successful query generation.
- `population` is the normalized effective filter.
- `count` equals `entries.length` and is at most 25.
- An empty leaderboard is HTTP `200` with `count: 0` and `entries: []`.
- Do not expose SQL, driver messages, internal identifiers, or prohibited database fields.
- Apply a modest per-client rate limit that comfortably permits ordinary navigation and filter switching. Database caching and single-flight behavior remain the primary backend protection.

Invalid-filter response uses HTTP `400` with a concise generic error. Database/configuration/query failure uses HTTP `503`:

```json
{
  "error": "Death statistics are temporarily unavailable."
}
```

Do not translate database failure into an empty leaderboard.

## Stats Page Panel

Add the first Stats data panel below the population filter.

Heading:

```text
Most Deaths
```

Supporting copy:

```text
Creature and PvP deaths recorded since tracking began.
```

Desktop columns, in this order:

```text
Character | Race | Class | Level | Account | Type | Deaths
```

Render `isBot` as:

- `Player` when false.
- `Bot` when true.

Implement the table with React and TanStack Table. Add and lock a current stable `@tanstack/react-table` version compatible with the React foundation.

TanStack Table is headless. The portal remains responsible for semantic HTML, accessible controls, responsive layout, and all visual styling.

Default table behavior:

- Preserve the API's default order: Deaths descending, Character ascending, then Player before Bot.
- Make the visible column headers sortable within the returned result set.
- A sortable header uses a real button inside its `th`.
- Indicate ascending, descending, and unsorted state visually and through accessible text.
- Apply `aria-sort` to the currently sorted column header when applicable.
- Use deterministic secondary comparisons so equal visible values do not jump unpredictably.
- Keep sorting local to the panel. It does not change `population`, refetch the API, or enter the URL in version 1.
- Reset to the documented default sort when a newly mounted panel has no user-selected sort. Retaining the selected column direction while switching population is acceptable if it never displays previous-population rows.
- Do not add per-table text search, column filters, pagination, row selection, or column visibility controls in version 1.

The panel copy must make the bounded result clear, for example:

```text
Showing up to 25 highest recorded death totals. Column sorting reorders these results.
```

Render API-derived values as normal React text children. Do not use `dangerouslySetInnerHTML` for character names, account logins, or any other response value.

Responsive behavior:

- Use a semantic table at wider widths.
- Transform rows into labeled stacked cards at the existing narrow breakpoint.
- Avoid horizontal page scrolling.
- Keep Deaths visually prominent and use tabular numerals.
- Do not rely on color alone to distinguish Player and Bot.

## Browser Behavior

- Read the effective typed population from the shared React contract in `specs/stats-population-filter.md`.
- Use TanStack Query with a query key containing both the resource and population, such as `["stats", "deaths", population]`.
- Select `/api/stats/deaths` data for the normalized population on initial Stats load and whenever it changes; a fresh same-population client cache entry may satisfy the selection.
- Pass the query cancellation signal into `fetch` so obsolete work can be aborted when supported.
- Do not retain or render previous-population rows while a new population is loading.
- Validate the public response fields required by the table before rendering them.
- Use an explicit retry policy; do not repeatedly retry HTTP `400` or `503`. No automatic retry is acceptable for this panel.
- Do not poll automatically in version 1. A reload or population transition selects the appropriate query; a fresh same-population client cache entry may satisfy it, while the server cache remains authoritative for database refresh frequency.
- A failure in this panel must not disable the page-level filter or navigation.

Panel states:

- Loading: `Loading death statistics...`
- Empty: `No recorded deaths for this population yet.`
- Unavailable: `Death statistics are temporarily unavailable.`
- Populated: render the ordered entries.

On population-query failure, show the unavailable state for that population rather than presenting cached rows from a different population. A cached successful result for the same population may be reused according to an explicit TanStack Query freshness setting that does not exceed the server's 60-second cache lifetime.

## Security and Privacy

- The accepted account-login exposure is limited to `account.username`.
- Never select or return password material, email, IP address, last login, account security, or numeric IDs.
- Use the dedicated read-only database user and private Docker network.
- Do not expose the database port publicly as part of this feature.
- Never return raw database errors to browsers.
- Do not log leaderboard rows during normal operation.
- Treat database configuration as secret except for non-sensitive placeholder names in `.env.example`.

## Out of Scope

- Environmental or otherwise unrecorded deaths.
- Changing or backfilling module events.
- A new module schema or index unless separately specified after measurement.
- Date-range filtering, pagination, configurable limits, per-table text search, or database-wide client-selected ordering.
- Character profiles or links.
- Death-cause breakdowns, killers, locations, timestamps, or trend charts.
- Bots-only mode.
- Deleted-character statistics.
- Authentication or authorization.
- World-database access.

## Acceptance Criteria

- The Stats page displays the Most Deaths panel below the shared population filter.
- Creature deaths count the event actor; PvP deaths count the event target.
- No kill event is incorrectly counted against its killer.
- Players only includes only event-time human-controlled death groups.
- Players + bots includes Player and Bot groups and may show the same character once per control type.
- Human and bot groups for the same character have independent totals.
- Current character race, class, level, and account login display correctly.
- Deleted or missing characters do not appear.
- The API selects at most 25 rows in the documented stable leaderboard order.
- The initial table order matches the API's leaderboard order.
- Sortable semantic column headers clearly expose their state and reorder only the returned rows.
- The UI discloses that sorting applies to the bounded top-25 result set.
- Missing population defaults to Players only; invalid or multiple values return HTTP `400`.
- Empty data returns HTTP `200`; database failure returns HTTP `503` and the unavailable UI state.
- No prohibited database or account fields appear in API responses or normal logs.
- Concurrent same-filter requests share one query and successful results cache for 60 seconds.
- Changing the page filter aborts/invalidates obsolete browser work and never displays the wrong population.
- Players and all-population requests use separate TanStack Query keys and cached results.
- Home, registration, server status, online roster, navigation, and `/health` continue to work without Stats database availability.
- `npm run build` and `npm test` pass.

## Automated Verification

Use injected/fake database execution for tests; automated tests must not require or mutate the live AzerothCore databases.

Cover:

- missing, valid, invalid, and repeated population query values;
- creature actor and PvP target interpretation;
- Players-only exclusion of bot-controlled death rows;
- separate Player/Bot grouping for one character;
- stable ordering and the 25-row limit;
- current character/account mapping and unknown-account fallback;
- deleted/missing character exclusion;
- count conversion and invalid database row rejection;
- independent caches for both populations;
- same-population request coalescing;
- expired-cache query failure returning unavailable rather than stale data;
- API `200`, `400`, and `503` contracts;
- stripping all integration-only identifiers;
- existing route regression tests.

Frontend component tests cover:

- loading, empty, unavailable, and populated panel states;
- normalized population in the request and query key;
- population transitions that never display previous-population rows;
- response validation failure producing the unavailable state;
- default server order and sortable column interactions;
- deterministic sorting for tied visible values;
- sortable-button names and `aria-sort` behavior;
- Player and Bot text labels;
- responsive data labels required by the stacked presentation;
- rendering character and account strings as text rather than HTML.

Update the explicit `npm test` command so every new compiled test file is executed.

## Operator Verification

1. Create a dedicated database user with only the documented `SELECT` grants.
2. Configure placeholder-derived Stats environment variables without exposing their values.
3. Confirm the portal container reaches MariaDB only over the existing private network.
4. Run the query with `EXPLAIN` and inspect event-table access and temporary/grouping behavior.
5. Compare a small set of creature and PvP event rows with the API totals.
6. Verify one human-only character, one bot-only character, and—if available—one character with both control modes.
7. Switch the page filter repeatedly and confirm the displayed type/totals match.
8. Temporarily make the Stats database unavailable and verify Home remains operational while the panel shows unavailable.
9. Inspect desktop and mobile layouts.
10. Inspect API responses and application logs for prohibited fields and raw database errors.
