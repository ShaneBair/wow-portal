# Public Enemy #1

**Status:** Draft  
**Owner:** WoW Portal  
**Repository:** `wow-portal`

## Current Behavior

The portal has no creature-popularity route, service, or Stats card.

## Outcome

Add a public statistics card that ranks creature types by how often portal-visible characters have killed them. A user can switch between player-controlled kills and all recorded kills with the existing Stats population control.

## Definition

“Public Enemy #1” is the creature template with the greatest number of recorded `CREATURE_KILL` plus `CREATURE_KILL_PET` events.

- A pet kill is credited once to its owner and is not a second copy of a direct kill.
- Group participation, assists, and damage without the recorded killing blow do not count.
- Different spawns of the same `target_entry` are one creature type.
- `population=players` accepts only `actor_is_bot = 0`; `population=all` accepts either value.
- Events belonging to accounts excluded by the current visibility scope do not contribute at all.

Rank by `kills DESC`, then resolved creature name and entry ascending. Return at most 25 rows.

## Data and Query Contract

Read `mod_player_stats_events` from `STATS_CHARACTERS_DATABASE` and `creature_template` from `STATS_WORLD_DATABASE`. Accepted rows must satisfy the module contract for the two event types, creature target type, positive target entry, expected source (`direct` or `pet`), and zero `value2`.

Aggregate directly by `target_entry`; do not require a surviving character row. Account exclusions must therefore be applied to `event.actor_account_id` before grouping. Extend the visibility-clause builder with an allowlisted event account column instead of interpolating arbitrary SQL. Resolve the current creature name from `creature_template`; use `Unknown creature #<entry>` if a formerly valid entry no longer resolves.

The result includes `creatureEntry`, `creatureName`, `kills`, `directKills`, and `petKills`. Numeric counts must be validated as non-negative safe integers.

No database migration or module change is required. The portal database user needs only the existing event-table read plus column-scoped world access to `creature_template.entry` and its locale-appropriate name column.

## HTTP and Service Contract

Add `GET /api/stats/public-enemy?population=players|all`; default to `players`, reject other values with HTTP 400, and return:

```json
{
  "generatedAt": "2026-09-29T18:00:00.000Z",
  "population": "players",
  "coverage": { "firstRecordedAt": "2026-08-01T12:00:00.000Z" },
  "entries": [
    { "creatureEntry": 123, "creatureName": "Example", "kills": 42, "directKills": 30, "petKills": 12 }
  ]
}
```

Use the shared 30/minute statistics limiter, 8-second query timeout, 60-second service cache keyed by population and account-visibility scope, `Cache-Control: no-store`, and `Vary: Cookie`. Dependency, contract, or row-validation failure returns HTTP 503 with `{"error":"Public Enemy statistics are temporarily unavailable."}` without database details.

## UI, Access, and Privacy

Place a “Public Enemy #1” card in the Stats grid. It is public like the existing statistics page; an optional authenticated session only changes account-visibility scope. Show creature, total kills, and the direct/pet split. Explain “Recorded killing blows since <date>.” Provide loading, empty, unavailable, and retry states. On narrow screens use stacked labeled rows; table headers and sort controls must be keyboard and screen-reader accessible.

## Acceptance and Verification

- Direct and pet fixtures aggregate to one creature row without double counting.
- Population and account-visibility filtering happen before ranking and limiting.
- A deleted character’s event can still count while its account remains visible.
- Unknown creature metadata receives the safe fallback label.
- Contract mismatch fails closed; an empty valid dataset returns 200 with `entries: []`.
- Automated tests cover query construction, tie order, cache separation, route validation, limiting, and safe errors.
- Operator verification runs `EXPLAIN`, confirms the event-type index is used, compares a controlled direct kill and pet kill, and confirms both privileged and standard visibility.

## Non-Goals

Lifetime kills from before event collection, assists, loot, encounter participation, spawn-specific rankings, and changing module event semantics are out of scope.
