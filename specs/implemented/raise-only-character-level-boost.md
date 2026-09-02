# Level Up, Buttercup: Portal-Only Character Level Boost

Status: Draft; portal-only approach accepted for owner review

Repository: `wow-portal`

Depends on: `specs/portal-account-authentication.md` and `specs/player-boosts.md`

## Decision Summary

Add an authenticated Boosts card that lets a player raise the selected character from its currently displayed level to a chosen target no higher than level 80.

Recommended card name: `Level Up, Buttercup`

Use a native range slider whose minimum is the selected character's current level plus one, maximum is 80, and selected target is always displayed in text. Level 80 characters see a completed state and cannot submit through the normal interface.

This is a portal-only feature. It uses the deployed Playerbots-compatible AzerothCore command:

```text
character level <character> <target>
```

No AzerothCore source change, custom module, gameplay migration, or new command implementation is required. The command works for offline characters.

The portal UI prevents ordinary level decreases. The portal API also performs a fresh ownership/current-level read and rejects a submitted target that is not higher than that reading. The existing AzerothCore command does not independently enforce raise-only behavior, so a small check-to-command race remains: a character could gain levels after the portal's final read and before command execution, allowing the absolute target to become lower than the character's newest level. The owner explicitly accepts this residual edge case in exchange for avoiding a game-server change.

Client-side constraints are never the only protection against a crafted request. The accepted relaxation applies to atomic enforcement inside AzerothCore, not to ordinary portal request validation or character ownership checks.

## Verified Deployed-Core Behavior

Read-only inspection of the deployed Playerbots-compatible AzerothCore revision on September 1, 2026 confirmed:

- `character level <character> <target>` is console-enabled;
- its argument is an absolute target level despite ambiguous command-help wording;
- it can target online or offline characters;
- it accepts targets below the current level and can therefore lower a character;
- for a connected character, the core calls `GiveLevel`, initializes talents for the level, and resets XP to zero;
- for an offline character, it updates `characters.level`, resets XP to zero, updates level-achievement criteria, and refreshes the character cache;
- remaining dependent values for an offline character are recalculated at the next login;
- its permission is `RBAC_PERM_COMMAND_CHARACTER_LEVEL` (`283`); and
- the deployed result text is `You changed level of <character> to <level>.`

The top-level `levelup` implementation is unavailable to console execution in this core revision and is not used.

## User Outcome

After logging in, a player opens `/boosts`, selects one of their owned characters, and reviews the `Level Up, Buttercup` card.

For a character below level 80, the card shows:

- the current level;
- a slider from current level plus one through 80;
- the chosen target level in text;
- a warning that current XP progress resets; and
- a `Raise level` button.

After explicit confirmation, the portal asks AzerothCore to set the character to that target. The character does not need to be online. An offline character receives the persistent level/XP update immediately and completes remaining dependent-value initialization on next login.

For a level 80 character, show:

```text
This character is already at the maximum level.
```

and no enabled level action.

## Scope

### In scope

- Authenticated use of the existing page-level character selector.
- Current-level display from authoritative character data.
- Whole target levels from displayed current level plus one through 80.
- Portal API revalidation of ownership, current level, and target.
- Explicit confirmation naming the character, current level, and target level.
- Existing AzerothCore `character level` command through private SOAP.
- Online and offline character support.
- Durable portal request state, idempotency, and post-command level reconciliation.
- Feature flag, narrow database grants, command RBAC grant, tests, and operator verification.

### Out of scope

- An AzerothCore source or module change.
- Atomic raise-only enforcement within the worldserver command.
- Intentionally offering level decreases in the UI or API.
- Levels above 80.
- Relative “add N levels” browser requests.
- Automatically granting gear, gold, bags, spells, mounts, riding, weapon skills, professions, reputations, quests, or flight paths.
- Automatically choosing or allocating talents.
- Preserving partial XP progress; a successful command resets XP to zero.
- Direct portal writes to AzerothCore character, achievement, cache, inventory, or spell data.

## Accepted Residual Risk

The portal performs this sequence:

1. Read current ownership, canonical name, and level from `characters`.
2. Require `currentLevel < targetLevel <= 80`.
3. Commit durable request state.
4. Execute the absolute-target command.

There is no transaction shared between the portal's database read and the worldserver command. If gameplay changes the level between steps 2 and 4, the target can become stale.

Example accepted race:

```text
Portal validates current 39 -> target 40.
Character reaches 41 before SOAP executes.
AzerothCore sets the character to 40.
```

This is not presented as impossible. Mitigations are deliberately limited to:

- a fresh current-level read immediately before reservation/command;
- short, bounded processing with no queue or scheduled delay;
- UI and portal API rejection of known non-increasing targets;
- confirmation that repeats the observed current and requested target;
- post-command authoritative-level refresh with short bounded retries for the core's asynchronous offline database update; and
- durable audit records for investigation.

The feature must be reconsidered or moved to a monotonic custom command if actual use shows this race is not acceptably rare.

## Eligibility and Level Rules

A request is eligible only when:

- `BOOST_CHARACTER_LEVEL_ENABLED` is valid and enabled;
- the request has a valid portal session, allowed origin, and CSRF token;
- the selected non-deleted character belongs to the authenticated account;
- the freshly read current level is between 1 and 79;
- `targetLevel` is a JSON integer between 2 and 80;
- `targetLevel` is strictly greater than the freshly read current level;
- the shared per-IP boost mutation limiter accepts the request; and
- portal-state, character-read, and SOAP dependencies are available.

A player may make later deliberate requests to higher targets until reaching 80. There is no lifetime or daily claim limit. The shared burst limiter remains operational protection.

## Boost Overview API

Extend the authenticated endpoint:

```text
GET /api/boosts
```

with:

```json
{
  "characterLevel": {
    "enabled": false,
    "name": "Level Up, Buttercup",
    "maximumLevel": 80,
    "xpWillReset": true
  }
}
```

The existing character entries supply their current `level`.

Requirements:

- Metadata comes from fixed server constants.
- The maximum level is fixed at 80 for this WotLK portal, not browser-controlled.
- Never expose the command, permission ID, account ID, character GUID semantics, database identifiers, or internal request state.
- Preserve `Cache-Control: no-store` and protected-query clearing on logout/account change.
- Missing or invalid feature configuration disables only this card.
- The browser may derive slider bounds for presentation, but the server independently validates the submitted target.

## React Card

Recommended description:

```text
Raise this character to any level up to 80, even while they are offline.
```

Recommended XP warning:

```text
Your current experience progress will reset when the level changes.
```

For an eligible character, render:

- heading `Level Up, Buttercup`;
- `Current level: 39`;
- a labeled native range input with `min=40`, `max=80`, and `step=1`;
- `Target level: 40` as text;
- the XP-reset warning; and
- `Raise level`.

Default the target to current level plus one. Changing the selected character resets the target to that character's current level plus one and clears unsubmitted confirmation state.

Recommended confirmation:

```text
Raise Thalgrim from level 39 to level 60? Current experience progress will reset.
```

Buttons:

- `Confirm level boost`
- `Cancel`

Recommended success:

```text
Thalgrim is now level 60.
```

The slider is disabled while submitting and absent or disabled at level 80. Current and target levels must appear in text rather than position or color alone. Preserve native keyboard behavior and visible focus.

## Mutation API

Add:

```text
POST /api/boosts/character-level
Content-Type: application/json
X-CSRF-Token: opaque-token
```

Request:

```json
{
  "requestId": "77ab8034-1429-4fd5-8ee1-a1220628724a",
  "characterId": "42",
  "targetLevel": 60
}
```

Accept exactly these properties. Reuse the canonical lowercase UUID v4 and bounded opaque character-ID validators. Do not accept a current level, account identifier, character name, relative delta, maximum level, command, or permission from the browser.

Before reservation and SOAP, resolve current ownership, canonical character name, and level again. Reject the request if target is no longer above that observed level.

First confirmed success returns HTTP `201`:

```json
{
  "requestId": "77ab8034-1429-4fd5-8ee1-a1220628724a",
  "status": "applied",
  "character": {
    "id": "42",
    "name": "Thalgrim",
    "level": 60
  },
  "message": "Thalgrim is now level 60."
}
```

An exact confirmed replay returns HTTP `200` with the stored public result and does not invoke SOAP again.

Public failures:

- `400`: invalid media type, JSON shape, UUID, character ID, or target outside 2–80;
- `401`: missing or expired session;
- `403`: invalid origin/CSRF or character not owned by the authenticated account;
- `409`: target is not above the freshly read current level, request-ID conflict, or the same request is processing;
- `429`: shared boost mutation limit exceeded;
- `503`: feature disabled, database/SOAP unavailable, or the result cannot be confirmed.

Ownership failures remain nondisclosing.

## AzerothCore Command Contract

After validation, ownership resolution, and durable reservation, construct exactly one command equivalent to:

```text
character level Thalgrim 60
```

Only these values vary:

- the canonical character name loaded from the authoritative characters database; and
- the validated target integer formatted by server code.

Validate the database-derived name against the existing compatible command-parser allowlist. Never concatenate a browser-provided character name or raw target string.

Recognize only the deployed exact success form corresponding to:

```text
You changed level of Thalgrim to 60.
```

SOAP HTTP success alone is not command success. Unknown output, SOAP fault, malformed XML, timeout, connection loss, missing character, or syntax failure must be reconciled or reported as unconfirmed.

Grant the SOAP account `RBAC_PERM_COMMAND_CHARACTER_LEVEL` (`283`) and no broader character-command group or console-administrator role. This permission can set levels both upward and downward when used directly; that elevated operational capability is an accepted consequence of the portal-only design. SOAP credentials and the private SOAP endpoint must remain inaccessible to browsers and public networks.

## Durable Request State

Add an additive portal-state migration for:

```text
character_level_boost_requests
```

Record:

- canonical request UUID primary key;
- fixed boost key `character-level-raise-v1`;
- authenticated account-ID snapshot;
- character GUID and canonical-name snapshot;
- observed starting level;
- requested target level;
- confirmed resulting level when known;
- status `pending`, `applied`, `failed`, or `unknown`;
- bounded internal result category; and
- created, updated, and completed UTC timestamps.

Constraints enforce starting level 1–79 and target level 2–80. The table contains no credentials, session/cookie material, CSRF values, IP addresses, raw commands, SOAP bodies, or raw errors.

The portal database account receives only `SELECT`, `INSERT`, and `UPDATE` on this table. Portal startup never creates or alters schemas. It retains existing column-level read access to character ownership/name/level and receives no AzerothCore write grant.

### Idempotent workflow

1. Validate auth, body, origin, CSRF, and burst limit.
2. Resolve current ownership, canonical name, and level.
3. Require observed current level below target and target no higher than 80.
4. Acquire the request lock and commit a new `pending` row before SOAP.
5. Execute one fixed `character level` command.
6. On exact success output, re-read the authoritative level and require it to equal the target before marking `applied`. Because the offline core path queues its database update asynchronously, retry that read on a short bounded backoff before declaring a mismatch.
7. Mark only proven pre-mutation rejection `failed`.
8. On ambiguous execution, re-read the level. Equality with target proves the requested outcome; any other level remains `unknown` because gameplay or the accepted race may also have changed it.
9. Exact `applied` replay returns stored success without SOAP.
10. Exact `pending` or `unknown` replay never automatically sends the command again.
11. A UUID reused with different account, character, or target is a conflict.

A new UUID may request a later higher target after a fresh current-level read.

## Race and Failure Behavior

- Character levels between overview and POST: POST uses the fresh level and may reject/refetch stale slider state.
- Character levels after final portal validation but before SOAP: accepted residual risk; the absolute command may lower the newest level.
- Character logs in or out during execution: the existing command chooses its connected or offline path.
- Character renamed/transferred/deleted: current resolution fails before reservation where possible; command errors remain safe and nondisclosing.
- Same UUID concurrently: at most one command path.
- Different concurrent targets: serialize requests for the same character through a bounded character-scoped portal lock. This reduces portal-created races but cannot coordinate with gameplay leveling.
- SOAP timeout after possible execution: reconcile level using the same bounded read backoff; otherwise retain `unknown` and never resend automatically.
- Portal restart with stale `pending`: reconcile before returning request state.
- Feature disabled after page load: POST rechecks configuration and sends nothing.
- Post-command level differs from target: never report confirmed success; log a coarse mismatch category and retain `unknown` for review.

## Configuration

Add one server-only setting:

```text
BOOST_CHARACTER_LEVEL_ENABLED=false
```

Missing or invalid values fail this card closed. Maximum level 80, boost key, command prefix, and success classifier are fixed source constants.

Keep the feature disabled until migration, grants, permission, exact output, online/offline behavior, XP reset, idempotency, and accepted race behavior are verified.

## Security and Logging

- Recheck ownership immediately before reservation.
- Treat UI bounds as presentation and repeat them in portal API validation.
- Validate canonical character names and construct the integer target from validated server data.
- Never accept a negative delta or a target outside 2–80.
- Keep SOAP and databases private.
- Mark overview and mutation responses `Cache-Control: no-store`.
- Never expose account IDs, GUID semantics, permission IDs, commands, schemas, raw SOAP, or request-table state.
- Never log credentials, cookies, CSRF tokens, full bodies, full commands, raw SOAP XML, or raw database errors.
- Operational logs may include request UUID, boost key, target/result level, coarse result, and non-secret internal ownership IDs when useful.

## Migration and Deployment

1. Confirm the deployed `character level` syntax, offline support, result text, and permission `283` again immediately before implementation.
2. Add and review the portal-state migration.
3. Grant the portal database user only `SELECT`, `INSERT`, and `UPDATE` on the new request table; preserve read-only AzerothCore access.
4. Grant the SOAP account permission `283` without a broader command group.
5. Deploy with `BOOST_CHARACTER_LEVEL_ENABLED=false`.
6. Run automated tests without live character mutations.
7. Test dedicated characters online and offline, including partial XP, stale overview data, replay, timeout, and concurrent portal requests.
8. Explicitly accept the remaining gameplay-level race after observing test behavior.
9. Enable only after owner review.

Rollback first disables the portal feature and then restores the prior portal build if required. Keep audit rows needed for reconciliation. Rollback never attempts to reverse a completed level change.

## Acceptance Criteria

- A signed-in user sees only owned, non-deleted characters.
- A character below 80 can select every whole target from displayed current level plus one through 80.
- A level 80 character cannot submit through the normal UI.
- Portal request validation rejects a known target at/below the fresh level or above 80.
- Browser-supplied ownership, name, current-level, delta, maximum, or command fields are never trusted.
- The existing command works for online and offline selected characters.
- Current XP reset is disclosed before confirmation.
- Exact request replay never executes a second command.
- Ambiguous execution never becomes false success or automatic resend.
- No direct portal write to AzerothCore character data is introduced.
- The accepted check-to-command race is documented rather than claimed impossible.
- Other boost cards remain available when this feature is disabled or unavailable.
- UI states are accessible and responsive.
- `npm run build` and `npm test` pass with mocked database/SOAP boundaries.

## Automated Verification

Server tests cover:

- fixed metadata and strict body parsing;
- target 2–80 validation and rejection against freshly observed level;
- ownership/current-name/current-level recheck before reservation;
- safe exact command construction;
- exact success and known/unknown output classification;
- disabled/auth/origin/CSRF/rate/dependency failures;
- first request, exact replay, payload conflict, concurrent replay, and character-scoped locking;
- post-command level equality, delayed offline-update confirmation, and ambiguous reconciliation;
- database state transitions and redacted logs;
- no regression to existing boosts.

Frontend tests cover:

- current-level display and slider bounds;
- level 79 and 80 states;
- character changes resetting the target;
- visible target and XP-reset warning;
- confirmation, cancel, keyboard, progress, success, stale-level, unknown, disabled, and expired-session states;
- protected cache clearing and narrow layouts.

Automated tests never change a live character.

## Operator Verification

1. Confirm command syntax, permission `283`, exact output, and private SOAP boundary.
2. Confirm the SOAP account has permission `283` without a broad character-command/admin role.
3. With the feature disabled, confirm POST cannot reserve or call SOAP.
4. Use a dedicated offline character with partial XP; raise one level and verify level, zero XP, achievements/cache, and next-login state.
5. Raise an offline character several levels.
6. Repeat with an online character.
7. Attempt target values below/equal to the current level, above 80, fractional, formatted, and browser-tampered; confirm portal rejection.
8. Replay the same request and confirm no second command.
9. Simulate an ambiguous response and verify authoritative-level reconciliation.
10. Exercise another account's character ID, UUID conflicts, CSRF failure, rate limiting, and concurrent targets.
11. Inspect browser responses, logs, grants, and audit rows for prohibited data.
12. Test keyboard, mobile, session-expiry, logout, and dependency-failure behavior.

## Owner Decisions

1. Approve or replace the recommended name `Level Up, Buttercup`.
2. Approve the slider and current-level-plus-one default.
3. Approve the XP-reset and offline next-login wording.
4. Confirm repeated higher-target requests without daily/lifetime quotas.
5. Confirm permission `283` on the private SOAP account is acceptable given that direct use of that credential could lower levels.

## Primary References

- Deployed command help for `character level`, inspected September 1, 2026.
- Deployed Playerbots-compatible `cs_character.cpp`, including `HandleCharacterLevelCommand`, `HandleCharacterLevel`, and the console-disabled `HandleLevelUpCommand`.
- Deployed `CharacterDatabase.cpp` prepared statement `CHAR_UPD_LEVEL`: `UPDATE characters SET level = ?, xp = 0 WHERE guid = ?`.
- Deployed `Language.h` result identifier `LANG_YOU_CHANGE_LVL = 127` and world string `You changed level of {} to {}.`
- Deployed `RBAC.h` permission `RBAC_PERM_COMMAND_CHARACTER_LEVEL = 283`.
