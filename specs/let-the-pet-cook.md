# Let the Pet Cook

**Status:** Draft  
**Owner:** WoW Portal  
**Repository:** `wow-portal`

## Current Behavior

The portal does not expose pet-attributed creature kills.

## Outcome

Add a public character leaderboard celebrating owners whose pets land the most recorded creature killing blows.

## Definition

For each current character and recorded control type, count valid `CREATURE_KILL_PET` events as `petKills` and valid `CREATURE_KILL` events as `directKills`. Calculate `petKillPercent = petKills / (petKills + directKills) * 100` for display, but rank by `petKills DESC`, then percentage descending, total kills descending, and character name/GUID ascending.

There is no minimum-kill threshold because the primary rank is a count rather than a potentially misleading percentage. `population=players` includes only human-controlled event rows; `all` includes both actor flags. Account exclusions occur before aggregation.

## Data and Query Contract

Use the event, character, and auth tables already used by character leaderboards. Validate creature target type, positive target entry, event/source pairing (`CREATURE_KILL_PET`/`pet`, `CREATURE_KILL`/`direct`), and zero `value2`. Join `(realm_id, actor_guid)`, require the recorded/current account IDs to match, and exclude deleted characters.

Group by character and `actor_is_bot`, so the all-population view can show separate Player and Bot rows for one character. Return current character metadata plus `type`, `petKills`, `directKills`, `totalKills`, and `petKillPercent` rounded to one decimal place. The server should calculate the percentage from integer totals and emit a finite number between 0 and 100.

No migration, world-database grant, or module change is required.

## HTTP and Service Contract

Add `GET /api/stats/pet-kills?population=players|all`; default `players`. Use the standard statistics envelope, limiter, 8-second timeout, 60-second cache keyed by population and visibility, 25-row limit, `Cache-Control: no-store`, and `Vary: Cookie`.

Invalid population returns 400. Any database, timeout, contract, or row-validation failure returns 503 with `{"error":"Pet kill statistics are temporarily unavailable."}` and no internal details.

## UI, Access, and Privacy

The “Let the Pet Cook” public Stats card shows character, pet kills, direct kills, and pet share. Include text clarifying that it measures killing blows credited by the module, not pet damage or assists. Use an accessible text percentage in addition to any visual meter; provide loading, empty, unavailable, and retry states and a stacked small-screen layout.

## Acceptance and Verification

- A pet kill changes `petKills` and total once; a direct kill changes only `directKills` and total.
- A character with only pet kills displays 100%; division by zero cannot occur because ranked rows require a pet kill.
- Population, account visibility, deleted-character, and account-match checks precede ranking.
- Percentages and ties are deterministic and 25 rows maximum are returned.
- Tests cover aggregation, separate actor-flag rows, percentage rounding, cache separation, invalid rows, and safe route errors.
- Operator verification produces one controlled direct and one pet killing blow and confirms query performance with `EXPLAIN`.

## Non-Goals

Pet identity/name, pet species rankings, damage meters, guardians not represented by the module hook, and historical pre-module kills are out of scope.
