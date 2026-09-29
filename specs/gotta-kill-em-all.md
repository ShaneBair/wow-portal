# Gotta Kill ’Em All

**Status:** Draft  
**Owner:** WoW Portal  
**Repository:** `wow-portal`

## Current Behavior

The portal does not aggregate distinct creature types killed per character.

## Outcome

Add a public character leaderboard for the widest variety of creature types killed.

## Definition

For each current, non-deleted character and recorded control type, count distinct positive `target_entry` values across valid `CREATURE_KILL` and `CREATURE_KILL_PET` events. Direct and pet kills are both credited to the character; repeatedly killing the same creature template increases `totalKills` but not `uniqueCreatures`.

Apply the existing population meaning from each event (`players` means `actor_is_bot = 0`; `all` accepts both) and exclude hidden accounts before grouping. Rank by `uniqueCreatures DESC`, `totalKills DESC`, then character name and GUID ascending. Limit to 25.

## Data and Query Contract

Read the module event table, current `characters` metadata, `auth.account.username`, and no world metadata. Accept only rows matching the documented kill contracts: creature target, positive entry, direct/pet source paired with its event type, and zero `value2`.

Join events on `(realm_id, actor_guid)` to a live, non-deleted character and require `event.actor_account_id = characters.account`. Group by character and `actor_is_bot`, matching the existing event-leaderboard convention; the `all` view may therefore show separate Player and Bot rows for one character. Apply `buildAccountExclusionClause` to `characters.account` before rank/limit. Return `characterName`, current `race`, `class`, `level`, uppercase `accountName`, `type` (`Player` or `Bot`), `uniqueCreatures`, and `totalKills`.

No migration or module change is required; current statistics reads are sufficient.

## HTTP and Service Contract

Add `GET /api/stats/gotta-kill-em-all?population=players|all`, defaulting to `players`. Return the standard `generatedAt`, `population`, `coverage.firstRecordedAt`, `count`, and `entries` envelope.

Use the shared statistics limiter, 8-second timeout, 60-second cache partitioned by population and visibility, 25-row maximum, no-store browser caching, and `Vary: Cookie`. Reject invalid filters with HTTP 400. Return HTTP 503 and `{"error":"Creature variety statistics are temporarily unavailable."}` for safe dependency/contract failures.

## UI, Access, and Privacy

Add a “Gotta Kill ’Em All” card to the public Stats grid. Show character, unique creature types, total recorded kills, and existing character metadata. Explain that “type” means creature template, not individual spawn. Reuse sortable, responsive, keyboard-accessible leaderboard behavior and explicit loading, empty, error, and retry states.

## Acceptance and Verification

- Repeated kills of one entry produce one unique creature; a second entry produces two.
- Pet and direct events are accepted only under their exact source contract.
- Deleted characters, mismatched account joins, and excluded accounts cannot affect rank.
- The all-population view keeps a character’s Player and Bot histories in separate labeled rows.
- Ties are stable and no more than 25 rows are returned.
- Tests cover distinct aggregation, mixed control type, filters, cache keys, validation, and safe errors.
- Operator verification uses controlled kills of two NPC types and runs `EXPLAIN` against the deployed data volume.

## Non-Goals

Tracking individual spawn GUIDs, retroactive lifetime variety, achievements/criteria, kill assists, and a collectible checklist are out of scope.
