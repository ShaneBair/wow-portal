# Comprehensive Deaths Leaderboard Migration

Status: Implemented locally; deployment requires provider verification  
Repository: `wow-portal`  
Depends on: `mod-player-statistics/specs/comprehensive-player-deaths.md`  
Modifies: `specs/character-deaths-leaderboard.md`  
Provider contract: `PLAYER_DEATH`, migration key `canonical_player_death_v1`

## Problem

The implemented Most Deaths query counts only:

- `PLAYER_KILLED_BY_CREATURE`, using the event actor as the dead character;
- `PVP_KILL`, using the event target as the dead character.

It omits falling, drowning, fatigue, lava, fire, void, scripted, and other deaths that do not create either specialized event. Simply adding the new canonical `PLAYER_DEATH` rows to the existing union would double-count every future creature and PvP death.

## User Outcome

The existing unauthenticated Most Deaths API and panel continue to show the highest death totals while gaining comprehensive coverage from the module cutover onward.

- Known legacy creature and PvP deaths remain counted.
- Every canonical death after cutover is counted once, including environmental deaths.
- Specialized events after cutover are not added to canonical totals.
- The UI clearly states when comprehensive tracking began.
- Player/Bot filtering continues to use event-time control flags.

Historical environmental deaths remain unknown and are not fabricated.

## Current Behavior

- `src/services/death-leaderboard.ts` unions legacy creature deaths and PvP victim rows for all time.
- The API returns `generatedAt`, `population`, `count`, and up to 25 entries.
- The panel says that creature and PvP deaths recorded since tracking began are included.
- Characters with zero qualifying rows do not appear.
- Successful results are cached separately for `players` and `all` for 60 seconds.
- The statistics database user reads the characters and auth schemas.

The original implementation remains the source of truth until the module provider contract is deployed and verified.

## Provider Preconditions

Do not implement or deploy the new query against a live realm until all are true:

1. `mod_player_stats_migrations` exists in the configured characters database.
2. It contains exactly one `canonical_player_death_v1` row.
3. The row was captured while worldserver event writes were stopped.
4. The deployed module emits exactly one `PLAYER_DEATH` per tested real death.
5. New canonical event IDs are greater than the recorded cutoff.
6. The provider's human/bot flags have been checked on controlled deaths.

If any precondition fails, retain the old portal version. The portal must never guess a cutoff from the first canonical event or current wall-clock time.

## Accepted Hybrid Aggregation

Read one immutable cutover record:

```text
migration_key   = canonical_player_death_v1
cutoff_event_id = final event ID before canonical module deployment
applied_at      = UTC cutover timestamp
```

Construct the death fact stream as:

```text
Legacy portion:
  PLAYER_KILLED_BY_CREATURE rows with id <= cutoff
  PVP_KILL victim rows with id <= cutoff

Comprehensive portion:
  PLAYER_DEATH actor rows with id > cutoff
```

Then group by subject character GUID and subject event-time bot flag as before.

Never include specialized `PLAYER_KILLED_BY_CREATURE` or `PVP_KILL` rows whose IDs are greater than the cutoff in total deaths. They coexist with `PLAYER_DEATH` only as cause/killer detail facts.

Never include a `PLAYER_DEATH` row whose ID is at or below the cutoff. Such a row indicates a broken or manually altered cutover and should be investigated rather than silently counted.

## Query Shape

Implement the equivalent of this bounded query using validated qualified identifiers and bound event/migration values:

```sql
WITH cutover AS (
    SELECT cutoff_event_id, applied_at
    FROM mod_player_stats_migrations
    WHERE migration_key = 'canonical_player_death_v1'
),
recorded_deaths AS (
    SELECT
        e.actor_guid AS character_guid,
        e.actor_is_bot AS is_bot
    FROM mod_player_stats_events e
    CROSS JOIN cutover x
    WHERE e.event_type = 'PLAYER_KILLED_BY_CREATURE'
      AND e.id <= x.cutoff_event_id

    UNION ALL

    SELECT
        e.target_guid AS character_guid,
        e.target_is_bot AS is_bot
    FROM mod_player_stats_events e
    CROSS JOIN cutover x
    WHERE e.event_type = 'PVP_KILL'
      AND e.id <= x.cutoff_event_id

    UNION ALL

    SELECT
        e.actor_guid AS character_guid,
        e.actor_is_bot AS is_bot
    FROM mod_player_stats_events e
    CROSS JOIN cutover x
    WHERE e.event_type = 'PLAYER_DEATH'
      AND e.id > x.cutoff_event_id
),
death_totals AS (
    SELECT character_guid, is_bot, COUNT(*) AS deaths
    FROM recorded_deaths
    /* Apply players-only filtering here when requested. */
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

Implementation requirements:

- Keep the query in the focused service layer.
- Validate configured database identifiers exactly as the current implementation does.
- Bind event type and migration-key values where the driver permits.
- Require exactly one valid cutover row.
- Validate `cutoff_event_id` as a nonnegative safe integer representation.
- Validate `applied_at` as a real database timestamp and convert it to ISO 8601 UTC.
- Preserve the current eight-second query timeout, 25-row limit, stable ordering, runtime row validation, cache, and request coalescing.
- Run `EXPLAIN` with representative human and bot event volume before proposing an index.

## Contract-Integrity Checks

Before returning a successful response, the service must be able to distinguish invalid provider state from an empty leaderboard.

Treat these as unavailable (`503`), with sanitized server logging:

- metadata table missing;
- cutover row missing or duplicated;
- invalid cutoff ID or applied timestamp;
- database access denied to the metadata table;
- query failure or malformed rows.

At startup or first request, also perform or incorporate a bounded integrity check that detects any `PLAYER_DEATH` row with `id <= cutoff_event_id`. If present, fail closed and log a concise contract-integrity error without row contents.

Do not require at least one canonical row after cutover; a newly deployed realm may legitimately have had no deaths yet.

## Population Semantics

Preserve event-time grouping:

- Legacy creature deaths use `actor_is_bot`.
- Legacy PvP deaths use `target_is_bot`.
- Canonical deaths use `actor_is_bot`.
- `players` excludes bot rows before aggregation.
- `all` includes both and retains separate Player and Bot groups for the same character.

Do not relabel history using the character's current control mode or account naming.

## Display Metadata

Preserve current joins and public fields:

- current character name, race, class, level, and account association;
- current `account.username` only;
- deleted or missing characters excluded;
- missing account row shown as `Unknown account`;
- no GUIDs, numeric account IDs, cutoff IDs, database names, or migration keys in the browser response.

Characters with zero known/canonical death rows still do not appear. This remains a leaderboard, not a complete character directory.

## HTTP API

Keep the existing routes and population validation:

```text
GET /api/stats/deaths?population=players
GET /api/stats/deaths?population=all
```

Extend the successful response additively with coverage:

```json
{
  "generatedAt": "2026-08-25T16:00:00.000Z",
  "population": "players",
  "coverage": {
    "comprehensiveSince": "2026-08-25T14:30:00.000Z"
  },
  "count": 1,
  "entries": [
    {
      "characterName": "Thalgrim",
      "race": "Dwarf",
      "class": "Paladin",
      "level": 42,
      "accountLogin": "SHANE",
      "isBot": false,
      "deaths": 15
    }
  ]
}
```

Coverage meaning:

- Before `comprehensiveSince`, totals contain only known creature and PvP deaths.
- At and after `comprehensiveSince`, totals use canonical all-cause death rows.
- The timestamp does not claim historical environmental completeness.

The browser validates the new object and ISO timestamp. A malformed coverage object is an unavailable response, not silently ignored.

Keep current `200`, `400`, `429`, and `503` behavior and public error wording. Do not expose provider-integrity details to the browser.

## Panel Copy

Replace the old supporting copy with coverage-aware wording. Use the API timestamp and render a concise localized date, with the exact ISO value available to assistive technology or a semantic `time` element.

Required meaning:

```text
Known creature and PvP deaths before <date>; all recorded deaths since then, including environmental deaths.
```

Also retain or combine the bounded-result disclosure:

```text
Showing up to 25 highest recorded death totals. Column sorting reorders these results.
```

Do not claim that historical environmental deaths are included. Do not claim to distinguish falling, drowning, lava, or other exact causes in version 1.

All existing loading, empty, unavailable, responsive, sorting, and population-transition behavior remains unchanged except for the validated coverage field and updated copy.

## Cache Behavior

- Keep independent `players` and `all` cache entries.
- Coverage is part of the cached response.
- A cache entry built under the legacy query must not survive deployment of the new process; the in-process cache naturally resets on restart.
- Do not cache metadata separately beyond the successful 60-second response unless implementation proves a need.
- Provider-integrity or query failures do not return stale data.

## Database Permissions

The statistics reader now requires `SELECT` on:

- `<characters database>.mod_player_stats_events`
- `<characters database>.mod_player_stats_migrations`
- `<characters database>.characters`
- `<auth database>.account`

A schema-wide read grant on the characters database already covers the new metadata table. Installations using narrow table grants must add this one table explicitly. No write permission is required.

## Deployment and Rollback

Deployment order:

1. Complete and verify the module cutover procedure.
2. Confirm portal database permissions include migration metadata.
3. Run the new query manually or through a safe diagnostic and compare legacy totals at the cutoff.
4. Deploy/restart only the portal with the new query and UI.
5. Verify `players` and `all` responses and coverage copy.

The old portal query safely ignores new `PLAYER_DEATH` rows, so module-first deployment is backward compatible for a short verification window. Do not leave the old portal deployed long term because it will continue omitting environmental deaths.

Rolling the portal back temporarily restores the incomplete legacy calculation but does not corrupt data. Rolling the module back after the cutover creates gaps in comprehensive totals and is not a valid steady state; redeploy the canonical module or explicitly plan a new migration boundary.

## Security and Privacy

- Continue using the dedicated read-only database account.
- Do not expose cutoff IDs, migration names, event IDs, GUIDs, account IDs, or raw database errors.
- `comprehensiveSince` is public operational metadata and contains no secret.
- Do not log event rows, character lists, database configuration, or credentials while checking integrity.
- Preserve the private Docker network and existing portal loopback publication.

## Out of Scope

- Reconstructing historical environmental deaths.
- Backfilling or mutating module event rows.
- Exact death-cause labels or breakdowns.
- Killer, spell, damage, location, or timestamp display per death.
- Showing zero-death characters.
- Changing table sorting, pagination, population options, or access policy.
- Changing module hook behavior from the portal repository.

## Acceptance Criteria

- Pre-cutover creature and PvP victim totals remain equal to the current known totals.
- Post-cutover creature deaths add exactly one canonical total despite specialized detail rows.
- Post-cutover PvP deaths add exactly one canonical total despite `PVP_KILL` detail rows.
- Post-cutover environmental deaths add exactly one total.
- Specialized events after cutoff are never added to total deaths.
- Human and bot control modes group correctly across both legacy and canonical portions.
- Missing/invalid metadata or contract corruption returns sanitized `503`, not incomplete `200` data.
- A realm with valid metadata but no canonical death yet can return legacy totals successfully.
- API coverage reports the cutover timestamp without exposing cutoff IDs.
- Panel copy accurately distinguishes incomplete legacy coverage from comprehensive future coverage.
- Existing table, population filter, cache, responsive behavior, privacy constraints, and API limits continue to work.
- `npm run build` and `npm test` pass.

## Automated Verification

Use fake/injected database execution; tests must not mutate live databases.

Cover:

- valid cutoff zero and nonzero;
- missing, duplicate, malformed, and inaccessible metadata;
- legacy creature actor inclusion only at/below cutoff;
- legacy PvP target inclusion only at/below cutoff;
- canonical actor inclusion only above cutoff;
- exclusion of post-cutoff specialized detail rows;
- detection of pre-/at-cutoff canonical rows;
- no double count when one death has canonical plus specialized rows;
- environmental canonical event inclusion;
- players-only and all-population bot semantics for all three branches;
- one character with both human and bot death groups;
- stable ordering and 25-row limit;
- current character/account metadata joins and deletion behavior;
- coverage timestamp conversion and runtime validation;
- independent caches and request coalescing;
- API success, empty, invalid-filter, rate-limit, and unavailable states;
- frontend coverage copy, `time` semantics, and malformed-response handling;
- all existing leaderboard and route regression tests.

## Operator Verification

1. Record the current portal results for `players` and `all` before cutover.
2. Complete the stopped-worldserver module migration and deployment.
3. Confirm the metadata row and new canonical IDs without exposing raw event details.
4. Cause one creature, PvP, and environmental death for controlled test characters.
5. Compare the hybrid query against known pre-cutover totals plus the three new deaths.
6. Verify none of the accompanying specialized rows add a second total.
7. Verify a human and a bot death under both population modes.
8. Inspect `EXPLAIN` and query duration with the live event volume.
9. Verify the API coverage timestamp and UI wording.
10. Temporarily remove metadata-table access in a safe test context and confirm sanitized unavailable behavior.
11. Inspect API responses and logs for internal IDs and database details.

## Follow-Up

Exact environmental cause labels require a separately approved provider contract. When available, a cause breakdown may consume versioned fields from `PLAYER_DEATH`; it must not change the rule that each canonical row counts as exactly one total death.
