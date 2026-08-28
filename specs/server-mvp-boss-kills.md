# Server MVP Boss-Kill Leaderboard

Status: Deployed; production reader/configuration and live query plans verified, with controlled in-game kill scenarios pending
Repository: `wow-portal`  
Depends on: `specs/react-frontend-foundation.md`, `specs/site-navigation.md`, `specs/stats-population-filter.md`  
Data contract owner: sibling `mod-player-statistics`  
World metadata owner: deployed compatible AzerothCore world database

## Feasibility Decision

This statistic is implementable in `wow-portal` without changing AzerothCore or `mod-player-statistics`.

The existing module already records direct and pet creature killing blows with a creature entry ID. The existing world database already identifies encounter-credit creatures and boss-marked creature templates. The portal can combine those existing read-only sources.

One operator permission/configuration change is required: the dedicated statistics database reader needs narrowly scoped `SELECT` access to two existing world tables, and the portal needs the validated world schema name. This is not a gameplay-server code change, module rebuild, schema migration, event change, or database data mutation.

## Problem

The portal records creature kills but cannot currently distinguish a boss from an ordinary creature. Players want a `Server MVP` award showing who has the most recorded boss killing blows, with the same event-time Human/Playerbot population behavior used by the rest of Stats.

## User Outcome

The Stats page contains a responsive award panel:

```text
🏆 Server MVP
Most boss kills
```

It highlights the current leader or tied leaders and shows up to 25 highest recorded boss-kill totals with current character metadata.

The page-level population control applies consistently:

- `Players only` counts boss kills recorded while the killing character was human-controlled.
- `Players + bots` counts both human- and Playerbot-controlled boss kills, retaining separate Player and Bot rows for a character used in both modes.

## Existing Kill Event Contract

The module records two default-enabled event types:

```text
CREATURE_KILL
  actor_guid       = player landing the direct creature killing blow
  actor_is_bot     = actor's control mode at event time
  target_type      = Creature (2)
  target_entry     = killed creature template entry
  target_guid      = killed creature spawn GUID counter
  source           = direct

CREATURE_KILL_PET
  actor_guid       = pet owner
  actor_is_bot     = owner's control mode at event time
  target_type      = Creature (2)
  target_entry     = killed creature template entry
  target_guid      = killed creature spawn GUID counter
  source           = pet
```

Both event types store the killed creature's level in `value1` and `0` in `value2`. The portal includes both so pet classes receive owner credit instead of losing pet killing blows.

## Accepted Meaning of “Boss Kill”

Version 1 counts a recorded creature killing blow when its `target_entry` appears in a deduplicated boss-entry set derived from the compatible world database.

A creature entry is a recognized boss when at least one is true:

1. It is a kill-creature encounter credit in `instance_encounters` (`creditType = 0`). The compatible core uses these entries to apply its runtime dungeon-boss flag.
2. Its `creature_template.rank` is `3` (`CREATURE_ELITE_WORLDBOSS`).
3. Its `creature_template.type_flags` contains bit `0x00000004` (`CREATURE_TYPE_FLAG_BOSS_MOB`), which the compatible core's `isWorldBoss()` predicate uses.

Use named server-side constants for these values and compatibility tests tied to the deployed core revision. Do not query the runtime-only `CREATURE_FLAG_EXTRA_DUNGEON_BOSS` bit from `creature_template.flags_extra`: the core sets that bit dynamically from encounter metadata and explicitly does not store it in the database.

Build the boss set with `UNION`, not `UNION ALL`, so a creature matching multiple rules is counted once per kill event.

## Important Scope Limitation: Killing Blows

The existing events identify the direct killer or pet owner. They do not record every party/raid member who participated in an encounter or received lockout/loot credit.

Therefore the metric means:

```text
Most recorded boss killing blows
```

It does not mean:

- most boss encounters attended;
- most raid lockouts completed;
- most boss loot received;
- group-wide encounter credit;
- achievement-based boss completion.

Keep the requested visible subtitle `Most boss kills`, but show supporting copy:

```text
Recorded boss killing blows since creature tracking began. Pet kills credit the owner.
```

If the desired award is group participation instead, it is not portal-only with the current events and requires a new server/module contract.

## Encounter Coverage Limitation

Some rows in `instance_encounters` use spell credit (`creditType = 1`) rather than a killed creature entry. A spell-credit ID cannot be joined safely to `CREATURE_KILL.target_entry`.

Version 1 behavior:

- include such an encounter only if its killed creature independently matches the world-boss rank or boss-mob type flag;
- otherwise exclude it;
- never guess a creature entry from spell names, scripts, map, proximity, or hard-coded folklore.

Supporting scope copy or help text must disclose that the leaderboard covers recognized creature-credit and world-boss entries. A future exact encounter-completion award requires a server-side encounter event or a versioned curated mapping maintained against the precise world content revision.

## Character and Control-Type Grouping

Group by:

```text
actor_guid, actor_is_bot
```

Population behavior:

- `players`: filter `actor_is_bot = 0` before aggregation.
- `all`: include both control modes and keep separate Player and Bot groups.

One character may appear twice in the combined population. Do not permanently classify characters from account naming, current session mode, latest event, or any bot account range.

## Coverage Metadata

Return the earliest event time among all `CREATURE_KILL` and `CREATURE_KILL_PET` rows as `firstRecordedAt`, independent of the selected population and whether the first creature happened to be a boss.

This represents the first available creature-kill event, not proof of continuous tracking. The module settings for direct or pet creature kills may have changed later, and the portal cannot reconstruct gaps.

If no creature-kill event exists, `firstRecordedAt` is `null` and the leaderboard is empty.

## Display Metadata

Join each aggregated actor GUID to the current AzerothCore `characters` and auth account rows:

- Character name, race, class, level, and account association are current at query time.
- Exclude absent or deleted characters.
- Use `Unknown account` if the current account cannot be resolved.
- Map race/class through the existing WotLK domain helpers with existing unknown-ID fallbacks.

The public API does not need boss names or boss-entry breakdowns for this award. It never returns character GUIDs, numeric account IDs, creature entries/GUIDs, world metadata flags, or database names.

## Database Configuration and Permissions

Extend the existing statistics database configuration with:

```text
STATS_WORLD_DATABASE=
```

Requirements:

- Document a placeholder in `.env.example`; never add a live value to tracked files.
- Validate it with the same strict database-identifier allowlist as the auth and characters schema names.
- Missing/invalid world configuration affects this API only and must not prevent the portal, Home, auth, Boosts, other Stats panels, or `/health` from starting.
- Reuse the small read-only statistics pool because the schemas share the configured MariaDB server. Do not add a second privileged world connection.

The statistics database user needs only these additional grants:

- `SELECT (event_time, event_type, actor_guid, actor_is_bot, target_type, target_entry, target_guid, target_is_bot, value1, value2, source)` as needed on `<characters database>.mod_player_stats_events` if its existing column grants lack them;
- `SELECT (entry, rank, type_flags)` on `<world database>.creature_template`;
- `SELECT (creditType, creditEntry)` on `<world database>.instance_encounters`.

It retains the existing narrow reads for actor event fields, current characters, and account username. It must receive no write, create, alter, drop, execute, file, or grant privileges on any AzerothCore schema.

Creating the grant is an explicit operator step. Portal startup must not mutate grants or world data.

## Query Contract

Implement the equivalent of this bounded query using validated qualified identifiers and bound event/source values:

```sql
WITH boss_entries AS (
    SELECT creditEntry AS entry
    FROM world_database.instance_encounters
    WHERE creditType = 0
      AND creditEntry <> 0

    UNION

    SELECT entry
    FROM world_database.creature_template
    WHERE `rank` = 3
       OR (type_flags & 4) <> 0
),
kill_contract AS (
    SELECT
        MIN(event_time) AS first_recorded_at,
        MAX(
            target_type <> 2
            OR target_entry = 0
            OR target_guid = 0
            OR target_is_bot <> 0
            OR actor_guid = 0
            OR actor_is_bot NOT IN (0, 1)
            OR value2 <> 0
            OR (
                event_type = 'CREATURE_KILL'
                AND source <> 'direct'
            )
            OR (
                event_type = 'CREATURE_KILL_PET'
                AND source <> 'pet'
            )
        ) AS has_invalid_event
    FROM mod_player_stats_events
    WHERE event_type IN ('CREATURE_KILL', 'CREATURE_KILL_PET')
),
boss_totals AS (
    SELECT
        e.actor_guid,
        e.actor_is_bot,
        COUNT(*) AS boss_kills
    FROM mod_player_stats_events e
    JOIN boss_entries b ON b.entry = e.target_entry
    WHERE e.event_type IN ('CREATURE_KILL', 'CREATURE_KILL_PET')
      /* Add e.actor_is_bot = 0 for population=players. */
    GROUP BY e.actor_guid, e.actor_is_bot
),
eligible_totals AS (
    SELECT
        b.actor_guid,
        b.actor_is_bot,
        b.boss_kills,
        c.name AS character_name,
        c.race AS race_id,
        c.class AS class_id,
        c.level,
        a.username AS account_login
    FROM boss_totals b
    JOIN characters c ON c.guid = b.actor_guid
    LEFT JOIN account a ON a.id = c.account
    WHERE c.deleteDate IS NULL
    ORDER BY
        b.boss_kills DESC,
        c.name ASC,
        b.actor_is_bot ASC
    LIMIT 25
)
SELECT ...
FROM kill_contract kc
LEFT JOIN eligible_totals e ON TRUE;
```

The SQL may be reorganized to produce one clean metadata row for an empty leaderboard, but must preserve the same set, filters, ordering, and limit.

Query rules:

- Define the numeric classification constants once in the service with names matching the compatible core.
- Use fixed population query variants or bound normalized values; never concatenate raw query input.
- Deduplicate the boss-entry set before joining events.
- Calculate coverage from all creature-kill events, not only bosses or the selected population.
- Apply population filtering before aggregation.
- Join current character eligibility before `LIMIT`.
- Safely validate and convert count/timestamp fields at runtime.

Ordering is part of the contract:

1. Boss kills descending.
2. Character name ascending using the accepted case-insensitive comparison.
3. Player before Bot for an otherwise identical row.

## Contract and Compatibility Checks

Fail the complete response when any direct/pet creature event violates its documented target/source/numeric/actor/bot contract. Do not silently remove malformed facts from a plausible leaderboard.

At implementation and after a core/world database upgrade, verify:

- `ENCOUNTER_CREDIT_KILL_CREATURE = 0`;
- `CREATURE_ELITE_WORLDBOSS = 3`;
- `CREATURE_TYPE_FLAG_BOSS_MOB = 0x00000004`;
- the core still derives the runtime dungeon-boss flag from kill-creature rows in `instance_encounters`;
- the relevant world columns retain their compatible meanings.

A mismatch is a provider compatibility failure, not an invitation to guess. Keep non-secret fixtures covering an encounter-credit boss, rank-based world boss, type-flag boss, overlapping classification, ordinary creature, and spell-credit-only encounter.

## Performance

Build the boss-entry set from relatively small/indexed world metadata and join it to the indexed event stream. Run `EXPLAIN` against the compatible database using both population variants.

The existing `idx_target_event_time (target_entry, event_type, event_time)` and event-type indexes are the starting point. Do not add an event-table index before measuring the final query. If performance becomes inadequate, propose an additive query-supported index, portal cache/rollup, or precomputed boss catalog in a separate specification; never introduce an unbounded scan or mutate world data.

## Service and Cache Design

Follow the existing Stats architecture:

- a boss-kill service owns classification SQL, validation, mapping, caching, and response construction;
- a thin route owns query/rate-limit/public-error behavior;
- a typed browser API module validates response fields;
- the React panel owns presentation and local sorting only.

Cache requirements:

- successful results cached for 60 seconds;
- separate cache/in-flight entries for `players` and `all`;
- concurrent same-population requests coalesced;
- expired refresh failures return unavailable rather than indefinite stale data;
- no persistent cache or new table;
- public `Cache-Control: no-store`.

## HTTP API

Add:

```text
GET /api/stats/boss-kills?population=players
GET /api/stats/boss-kills?population=all
```

Use the shared population rules: missing defaults to players, exactly one accepted value is required when supplied, and invalid/repeated values return HTTP `400`.

Successful response:

```json
{
  "generatedAt": "2026-08-26T20:30:00.000Z",
  "population": "players",
  "coverage": {
    "firstRecordedAt": "2026-08-19T19:37:22.256Z"
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
      "bossKills": 12
    }
  ]
}
```

An empty valid result returns `firstRecordedAt` as either the first general creature-kill timestamp or `null` when no creature-kill rows exist, plus `count: 0` and `entries: []`.

Unavailable response, HTTP `503`:

```json
{
  "error": "Boss kill statistics are temporarily unavailable."
}
```

World configuration/permission failures, malformed metadata, database failure, and contract-integrity failure return unavailable rather than a false empty leaderboard. Apply the shared modest Stats read rate limit.

## React Panel

Add the panel to a responsive `Server Awards` region. It may sit beside Completionist on desktop and stack on narrow screens. Each award loads and fails independently.

Panel content:

- decorative trophy emoji hidden from assistive technology;
- accessible heading `Server MVP`;
- subtitle `Most boss kills`;
- scope copy explaining killing-blow, pet-owner, and tracking coverage;
- winner or co-winner summary;
- up to 25 server-ranked rows.

Suggested table columns:

- Character
- Race
- Class
- Level
- Account
- Type
- Boss kills

The highest server-ranked total is the winning value. Every returned row tied at that value is a co-winner. The winner does not change when the user locally sorts another column.

States:

- loading: `Loading boss kill statistics...`;
- empty: `No recorded boss kills for this population yet.`;
- unavailable: `Boss kill statistics are temporarily unavailable.`;
- populated: winner summary, scope copy, and leaderboard.

Use a query key such as:

```text
["stats", "boss-kills", population]
```

Pass cancellation to `fetch`, use a 60-second stale time, disable automatic retry/polling, and never retain prior-population rows during a transition.

## Accessibility and Responsive Behavior

- Use a semantic labeled section and table.
- Hide the emoji from assistive technology so the heading has a clean accessible name.
- Express ties and Player/Bot mode in text, not color alone.
- Reuse visible keyboard focus and sortable header behavior.
- Make scope copy available without hover-only interaction.
- Use the established stacked mobile table presentation without horizontal page scrolling.
- Do not abbreviate totals in a way that makes exact ties unclear.

## Public Access, Privacy, and Security

This panel/API remains unauthenticated under the existing public Stats decision. It may expose current character name, race, class, level, account login, event-time Player/Bot label, and aggregate boss-kill total.

Do not expose:

- character/creature GUIDs or entries;
- numeric account IDs;
- world classification fields or encounter IDs;
- emails, IPs, bans, security levels, credentials, verifier/session data;
- database/schema names, SQL, raw rows, or stack traces.

Use the dedicated read-only statistics user, validated identifiers, parameterized values, bounded queries, redacted logs, and private database network. The new world grants must remain read-only and column-scoped.

## Failure Behavior

- World configuration/grant missing: Server MVP alone is unavailable.
- No creature events: valid empty response with null coverage.
- Creature events exist but no recognized boss matches: valid empty response with non-null creature coverage.
- Creature event settings later disabled: historical totals remain; scope copy continues to say recorded kills.
- Spell-credit-only encounter: excluded unless independently boss-marked.
- Deleted/missing character: excluded before top-25 selection.
- Missing account: `Unknown account`.
- Unknown race/class: existing fallback.
- Malformed event/world/query row: fail complete response.
- Another Stats panel fails: Server MVP remains independent, and vice versa.

## Out of Scope

- Group/raid encounter participation or lockout credit.
- Boss attempts, wipes, fastest kills, first kills, difficulty, raid size, or per-boss breakdown.
- Mapping spell-credit encounters to creatures.
- Hard-coded boss-entry lists in browser or route code.
- Creature names in this version's public response.
- Historical kills before event tracking.
- Account-level aggregation across characters.
- Bots-only, date-range, realm, raid, map, or boss filters.
- AzerothCore/module/schema changes or database writes.

## Acceptance Criteria

- The Stats page displays `Server MVP` with subtitle `Most boss kills`.
- The server counts existing direct and pet creature events only when their target entry matches the documented deduplicated boss set.
- Pet killing blows credit the owner exactly once.
- The panel clearly says the metric is recorded killing blows, not group participation.
- Kill-creature encounter credits, rank-3 world bosses, and boss-mob type flags are included; ordinary creatures and unmappable spell-credit-only encounters are excluded.
- Players-only and Players + bots use event-time `actor_is_bot` with separate query/cache entries.
- One character can have distinct Player and Bot rows.
- Tied highest totals are co-winners.
- Coverage is based on the first general creature-kill event and does not claim continuous tracking.
- Deleted/missing characters do not consume top-25 slots.
- Missing world permissions/configuration returns `503`, not a false empty result, and does not break other portal features.
- Public responses contain none of the prohibited internal identifiers or world metadata.
- No AzerothCore/module rebuild or event migration is required.
- `npm run build` and `npm test` pass.

## Automated Verification

Server/service tests cover:

- boss set from encounter credit, rank, type flag, and overlapping rules;
- ordinary and spell-credit-only exclusions;
- direct and pet kill inclusion without duplicate join amplification;
- players/all variants and separate control-mode groups;
- deterministic ordering, top-25 bounding after eligibility, and tied winners;
- coverage with populated, no-boss, and no-creature-event datasets;
- contract-integrity and unsafe-count rejection;
- validated world database identifier and missing configuration;
- cache separation, expiry, and concurrent coalescing;
- API population/rate-limit/success/empty/`503` behavior;
- public-field privacy.

Frontend tests cover:

- title/subtitle and exact killing-blow/pet scope copy;
- loading, empty, unavailable, populated, and tied-winner states;
- population query key/request and transition behavior;
- response validation and no leaked internal fields;
- sorting without changing the winner summary;
- accessible emoji/heading, keyboard behavior, and narrow layout;
- independent failure alongside Completionist and deaths.

Use fabricated database rows and mocked fetches. Automated tests must not query the live world/characters databases or invoke worldserver.

## Operator Verification

1. Confirm the three named boss-classification constants against the deployed compatible core revision.
2. Add only the documented event/world column grants to the existing statistics reader.
3. Configure `STATS_WORLD_DATABASE` with the real schema name without committing it.
4. Run both final population queries and `EXPLAIN` through the statistics reader.
5. Kill one ordinary creature and confirm Server MVP does not change.
6. Land a direct killing blow on a recognized test boss and confirm the correct Player/Bot group increases after cache expiry.
7. Land a recognized boss killing blow with a pet and confirm exactly one owner credit.
8. Verify a non-killing party member receives no credit and confirm the UI wording makes that limitation clear.
9. Exercise tied-winner, empty, missing-world-grant, desktop, mobile, and keyboard states.
10. Inspect browser responses and logs for creature entries, database details, or other prohibited fields.

Progress recorded on August 28, 2026:

- Completed: compatible-core constant and runtime-flag confirmation; exact column-scoped event, character, account, migration, encounter, and creature-template grants; real world-schema configuration; both population queries and `EXPLAIN` through the restricted production reader; automated tests and production build; successful Stats page and API responses; public-field inspection; and historical verification that ordinary/unrecognized creature kills are excluded while direct and pet-owner boss kills are recognized.
- Still recommended as controlled in-game follow-up: observe one new ordinary kill, direct boss kill, pet boss kill, and non-killing party member across cache expiry; then exercise the remaining manual responsive, keyboard, unavailable-grant, and tie-state checks.

## Implemented Product Decisions

1. `Server MVP` means boss killing blows rather than encounter participation for every group member.
2. Version 1 omits spell-credit encounters without an independent boss marker.

## Compatibility Evidence

The deployed compatible source currently defines:

- `ENCOUNTER_CREDIT_KILL_CREATURE = 0` in `src/server/game/Maps/Map.h`;
- `CREATURE_ELITE_WORLDBOSS = 3` in `src/server/shared/SharedDefines.h`;
- `CREATURE_TYPE_FLAG_BOSS_MOB = 0x00000004` and uses it in `Creature::isWorldBoss()`;
- `CREATURE_FLAG_EXTRA_DUNGEON_BOSS` as a runtime-only flag populated from kill-creature rows in `instance_encounters`.

These observations support the portal-only query but are not a permanent promise across future core revisions; retain compatibility tests and repeat operator verification after upgrades.
