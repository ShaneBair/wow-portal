# Flight Risk: Learn All Flight Paths Boost

Status: Implemented locally; deployment remains disabled pending owner approval, migration/grants, and operator verification

Repository: `wow-portal`

Depends on: `specs/implemented/portal-account-authentication.md` and `specs/implemented/player-boosts.md`

## Decision Summary

Add an authenticated Boosts card named `Flight Risk` that permanently teaches the selected character every standard flight-master node usable by that character's faction. Death Knights also receive the valid Death Knight taxi nodes.

This is a portal-only database operation. It requires no AzerothCore source change, custom module, SOAP command, mail, or worldserver rebuild. The selected character must be offline while the portal changes the saved `characters.taximask` value. The portal preserves every currently learned node and adds the verified faction-appropriate nodes with a bitwise OR operation.

The built-in AzerothCore taxi cheat is explicitly not used. In the deployed Playerbots-compatible core, `cheat taxi` only toggles the in-memory `PLAYER_EXTRA_TAXICHEAT` flag. It changes what the connected client can see for that session but does not permanently update the character's learned taxi mask.

The boost is repeatable and has no per-character, account, daily, or lifetime limit. Reapplying it is harmless. This allows a character to receive newly added nodes after a future compatible mask revision or to restore the boost after a faction-change workflow replaces the taxi mask.

## User Outcome

After signing in, a player opens `/boosts`, selects one of their characters, and finds the `Flight Risk` card.

For an offline eligible character, the card explains that it unlocks all standard flight paths for the character's faction and provides a `Learn all flight paths` button. The player confirms the character and faction before applying the boost.

On success, show:

```text
<Character> learned all available <Alliance|Horde> flight paths.
```

If every node in the current boost mask was already known, show:

```text
<Character> already knows all available <Alliance|Horde> flight paths.
```

For an online character, disable submission and show:

```text
Log out of this character before applying Flight Risk.
```

The boost does not grant riding skill, flying skill, a mount, Cold Weather Flying, gold for fares, or the ability to use a flight master that remains unavailable because of normal NPC, phase, map, or interaction restrictions.

## Scope

### In scope

- Authenticated use of the existing Boosts page character selector.
- Fresh ownership and deletion-state validation on every mutation.
- Fresh offline-state validation immediately before the database update.
- Permanent addition of all verified standard faction taxi nodes.
- Addition of valid Death Knight nodes for Death Knights.
- Preservation of all existing taxi-mask bits.
- A source-owned, versioned mask artifact verified against the deployed WotLK DBC/core revision.
- An atomic character update and portal audit record when both schemas share the configured portal database connection.
- Durable request UUID handling, safe replay, reconciliation, feature flag, narrow grants, tests, and operator verification.
- A clear direct-character-write exception in the deployment documentation.

### Out of scope

- Modifying or rebuilding AzerothCore.
- Using `cheat taxi`, a GM session, or a selected in-game player.
- Supporting a character that is currently online.
- Granting opposite-faction-only nodes to an ordinary character.
- Granting flight-master nodes that exist only for scripted or spell-driven taxi travel.
- Teaching riding or flying skills, including Cold Weather Flying.
- Granting mounts, fare money, hearth locations, map exploration, teleports, transport routes, or discovered areas.
- Removing any learned taxi node.
- Guaranteeing that every known node is immediately reachable from every other node.
- Reversing the boost.
- Automatically reapplying the boost after a future faction change or core/DBC upgrade.
- Letting the browser, environment file, or database row supply arbitrary taxi-mask values.

## Verified Core Behavior

Read-only inspection of the deployed Playerbots-compatible AzerothCore source on October 1, 2026 established:

- `PlayerTaxi` stores learned taxi nodes as 14 unsigned 32-bit mask words.
- The words are serialized to and loaded from `characters.taximask` as space-separated unsigned decimal integers.
- `PlayerTaxi::LoadTaxiMask` intersects saved words with `sTaxiNodesMask`, discarding bits that do not represent existing taxi nodes.
- `PlayerTaxi::SetTaximaskNode` permanently adds a learned node to the in-memory mask, which is later serialized with the character.
- `sTaxiNodesMask` contains valid network nodes and excludes sources whose only available paths are spell-driven/scripted taxi paths.
- The core separately builds `sAllianceTaxiNodesMask`, `sHordeTaxiNodesMask`, and `sDeathKnightTaxiNodesMask` from the loaded DBC data.
- the character database prepared statement for persistence updates only `characters.taximask` for a GUID; and
- `cheat taxi` only calls `SetTaxiCheater`, which toggles an in-memory player-extra flag and does not mutate `m_taxi` or `characters.taximask`.

These facts must be reconfirmed if the deployed core branch or client data changes materially.

## Grant Mask Contract

The implementation must contain a source-owned artifact representing exactly 14 unsigned 32-bit words for each of:

- Alliance standard taxi nodes;
- Horde standard taxi nodes; and
- Death Knight taxi nodes.

For a non-Death Knight, the grant mask is the character's faction mask. For a Death Knight, it is the bitwise OR of that faction mask and the Death Knight mask.

Faction is derived from the authoritative numeric race loaded from `characters`, never from browser text:

- Alliance: Human, Dwarf, Night Elf, Gnome, Draenei;
- Horde: Orc, Undead, Tauren, Troll, Blood Elf.

An unknown, unsupported, or internally inconsistent race/class value fails closed without a character update.

The masks must be generated or independently verified against the exact deployed WotLK DBC data and the core's `sAllianceTaxiNodesMask`, `sHordeTaxiNodesMask`, and `sDeathKnightTaxiNodesMask` construction rules. Record alongside the constants:

- a stable mask revision such as `wotlk-335a-<short-source-revision>`;
- the compatible AzerothCore/Playerbots source revision;
- the DBC provenance or hash used for verification; and
- the verification date.

Do not use fourteen `4294967295` words. Although the core removes nonexistent bits when loading, that value would also grant valid opposite-faction or special-purpose nodes and would make the portal's behavior dependent on undocumented load-time normalization.

Do not expose the words, mask revision, race IDs, class IDs, schema, or database mutation to the browser. The mask revision is retained only in server code, tests, operational documentation, and the audit row.

### Applying the mask

Parse the current `taximask` using the core-compatible rules: accept zero through 14 unsigned 32-bit decimal words, treat omitted trailing words as zero, and accept a trailing space because the core serializer emits one. This preserves compatibility with an empty/new or older short mask while always writing the current canonical 14-word form. Reject malformed values, more than 14 words, negative values, values above `4294967295`, non-decimal syntax, or otherwise unexpected data rather than replacing it blindly.

The new word at each position is:

```text
newWord = currentWord OR grantWord
```

Serialize the 14 resulting words in the same space-separated decimal representation accepted by the core. Preserve a consistent trailing-space convention in generated values and exact-value comparisons.

If the current mask already contains every grant bit, treat the request as a confirmed `already-known` success and do not issue a character-table update.

## Eligibility

A request is eligible only when:

- `BOOST_FLIGHT_PATHS_ENABLED` is present, valid, and enabled;
- the request has a valid portal session, allowed origin, and CSRF token;
- the selected non-deleted character belongs to the authenticated account;
- the authoritative character row contains a supported race and class;
- `characters.online = 0` in the fresh locked read;
- the stored taxi mask is valid;
- the deployed mask artifact passed startup validation and contains exactly 14 valid words per mask;
- the shared per-IP boost mutation limiter accepts the request; and
- the character and portal-state database dependencies are available.

There is no level requirement and no usage quota. A low-level character may therefore learn high-level-zone flight points. This bypass of normal discovery progression is the intended boost behavior.

## Boost Overview API

Extend:

```text
GET /api/boosts
```

with fixed metadata:

```json
{
  "flightPaths": {
    "enabled": false,
    "name": "Flight Risk",
    "requiresOffline": true
  }
}
```

Extend each boost character's public representation with a boolean `online` value if the shared character selector does not already provide equivalent fresh state. Do not include the taxi mask, account ID, numeric race/class IDs, or raw database values.

Overview state is advisory. The POST endpoint must independently reload ownership, race, class, online status, and taxi mask.

Preserve `Cache-Control: no-store`. A missing or invalid feature setting disables only this card and does not break other boosts.

## React Card

Recommended copy:

```text
Learn every standard flight path available to this character's faction. The character must be logged out.
```

Render:

- heading `Flight Risk`;
- the selected character's name and faction in confirmation text;
- the offline requirement;
- the clarification that this does not teach riding/flying skills or grant a mount; and
- a `Learn all flight paths` button.

Recommended confirmation:

```text
Teach <Character> all available <Alliance|Horde> flight paths? Keep this character logged out until the request finishes.
```

Buttons:

- `Confirm flight paths`
- `Cancel`

Disable submission while pending, when no character is selected, when the feature is disabled, or when overview data says the character is online. If the POST reports that the character came online, refresh boost characters and retain a clear retry-after-logout message.

The card must be keyboard operable, expose pending and result states to assistive technology, retain visible focus, and fit the existing responsive boost-card grid.

## Mutation API

Add:

```text
POST /api/boosts/flight-paths
Content-Type: application/json
X-CSRF-Token: opaque-token
```

Request:

```json
{
  "requestId": "2fd0d335-dc3c-4c15-ab46-25c9c10b2b82",
  "characterId": "42"
}
```

Accept exactly these two properties. Reuse the canonical lowercase UUID v4 and bounded opaque character-ID validators. Do not accept a character name, account ID, faction, race, class, online state, taxi mask, mask revision, node list, or command from the browser.

First confirmed application returns HTTP `201`:

```json
{
  "requestId": "2fd0d335-dc3c-4c15-ab46-25c9c10b2b82",
  "status": "applied",
  "result": "learned",
  "message": "Thalgrim learned all available Alliance flight paths."
}
```

An accepted request for an already-complete mask also returns `201` with `result: "already-known"`. An exact replay returns HTTP `200` with the stored public result and performs no character mutation.

Public failures:

- `400`: invalid media type, JSON shape, UUID, or character ID;
- `401`: missing or expired session;
- `403`: invalid origin/CSRF or character not owned by the authenticated account;
- `409`: character is online, request-ID payload conflict, or the same request is processing;
- `429`: shared boost mutation limit exceeded; and
- `503`: feature disabled, invalid server mask, malformed stored taxi data, database unavailable, or result cannot be confirmed.

Ownership failures remain nondisclosing. Responses never include the taxi mask, internal IDs, raw SQL/database errors, or grant details.

## Database Mutation and Concurrency

Use the configured portal database connection and parameterized SQL with validated schema identifiers. The portal-state and character schemas are expected to reside on the same MySQL/MariaDB server so one transaction can cover both.

For a new request:

1. Validate authentication, body, origin, CSRF, feature state, and rate limit.
2. Begin one database transaction.
3. Reserve the request UUID or load its existing row.
4. Lock the authoritative character row with `SELECT ... FOR UPDATE`, scoped by GUID, authenticated account ID, and non-deleted state.
5. Read canonical name, race, class, `online`, and `taximask` from that row.
6. Require `online = 0`.
7. Parse the current mask and calculate the faction/class grant mask and OR result.
8. If bits need adding, issue one parameterized update equivalent to:

   ```sql
   UPDATE characters
   SET taximask = :newMask
   WHERE guid = :guid
     AND account = :accountId
     AND deleteInfos_Name IS NULL
     AND online = 0
     AND taximask = :oldMask;
   ```

9. Require exactly one affected row for a changed mask. A zero-row compare failure is a conflict and must not be reported as success.
10. Mark the portal request `applied` with `learned` or `already-known`, the mask revision, and bounded audit metadata.
11. Commit once. Do not report success until the commit is confirmed.

If the configured schemas cannot participate in the same transaction, fail startup/feature initialization closed. Do not emulate this contract with two independently committed writes.

The transaction and optimistic predicates narrow but cannot completely eliminate a login race. The worldserver does not participate in the portal transaction: a login that begins at the same boundary could load stale taxi data and later overwrite the database. The UI tells the player to remain logged out, the POST rejects a freshly online character, and the transaction keeps the exposure brief. This residual race is accepted for this friends-only portal. If it proves material, the feature must move to a worldserver-aware module/command rather than claim database locking solves it.

## Durable Request State

Add the next additive portal-state migration, expected to be:

```text
006_create_flight_path_boost_requests.sql
```

If migration number `006` is taken before implementation, use the next available sequence number without renumbering an applied migration.

Create a dedicated table named:

```text
flight_path_boost_requests
```

Record:

- canonical request UUID primary key;
- fixed boost key `flight-paths-v1`;
- authenticated account-ID snapshot;
- character GUID and canonical-name snapshot;
- faction result `alliance` or `horde`;
- class snapshot sufficient to distinguish Death Knight behavior;
- source mask revision;
- result `learned` or `already-known` when applied;
- status `pending`, `applied`, or `failed`;
- bounded internal result category; and
- created, updated, and completed UTC timestamps.

Do not store the complete old/new taxi masks, credentials, session/cookie material, CSRF values, IP addresses, request bodies, SQL, or raw database errors.

Because the character update and request row share one transaction, a confirmed commit contains both or neither. On an ambiguous commit result, reconnect and look up the same request UUID:

- an `applied` row proves the atomic character update/no-op and audit commit succeeded;
- no row means the transaction did not commit, and retrying the same request is safe because mask OR is idempotent; and
- an unexpected `pending` row is an internal contract failure that must be reconciled without blindly mutating again.

A UUID reused with a different account or character is a conflict. A different UUID may safely request the same boost again.

## Configuration

Add one server-only setting:

```text
BOOST_FLIGHT_PATHS_ENABLED=false
```

Missing or invalid values fail this card closed. The grant masks, boost key, node count, supported races/classes, and mask revision are source-owned constants, not environment variables.

Deploy disabled until mask provenance, migration, grants, offline behavior, login-race wording, replay, and a real flight-master smoke test are verified.

## Least-Privilege Grants

The portal database user requires:

```sql
GRANT SELECT, INSERT, UPDATE
ON `PORTAL_STATE_DATABASE`.`flight_path_boost_requests`
TO 'portal-user'@'portal-host';

GRANT SELECT (`guid`, `account`, `name`, `race`, `class`, `online`, `taximask`, `deleteInfos_Name`)
ON `PORTAL_CHARACTERS_DATABASE`.`characters`
TO 'portal-user'@'portal-host';

GRANT UPDATE (`taximask`)
ON `PORTAL_CHARACTERS_DATABASE`.`characters`
TO 'portal-user'@'portal-host';
```

Substitute the deployed schema, user, and host values. Reuse the portal account's exact existing host scope. Where column-level reads already exist, grant only the missing columns rather than broadening unnecessarily.

Do not grant `UPDATE` on the entire `characters` table or on `online`, account ownership, race, class, level, position, inventory, spells, skills, achievements, or any auth/world/mail table. No SOAP RBAC permission is required.

Update `migrations/README.md` and the main deployment documentation to identify this column-scoped `taximask` write as a deliberate exception to the portal's otherwise read-only AzerothCore character access.

## Security and Privacy

- Recheck ownership and deletion state in the same locked row used for mutation.
- Treat overview `online` state as advisory and recheck it in the transaction.
- Derive faction and Death Knight handling only from authoritative database values.
- Keep mask values fixed in trusted server code and prohibit browser/config overrides.
- Use parameterized queries and validated database/schema identifiers.
- Keep all databases private to the deployment network.
- Mark overview and mutation responses `Cache-Control: no-store`.
- Never log masks, SQL, raw database errors, cookies, CSRF tokens, or request bodies.
- Operational logs may contain request UUID, boost key, mask revision, coarse outcome, and non-secret internal character/account identifiers when needed for support.
- Apply the universal account-visibility policy only to public/statistics displays; it does not alter whether an authenticated owner may boost their own character.

## Failure and Edge-Case Behavior

- Character is online at POST: return `409`; do not reserve an applied request or update the mask.
- Character logs in near the transaction boundary: accepted residual race; tell the player to remain logged out and allow a later safe reapplication.
- Character changes faction after the boost: AzerothCore may replace/recalculate its taxi mask; the owner can apply Flight Risk again while offline.
- Character is renamed: use the fresh canonical name only for display/audit; mutation remains GUID- and ownership-scoped.
- Character is deleted/transferred: fail ownership/non-deleted resolution without disclosing another account's data.
- Existing mask has extra valid bits: preserve them.
- Existing mask is malformed: fail closed and require administrator investigation; do not normalize by guessing.
- Mask artifact is the wrong length or contains invalid values: disable only this boost.
- Database commit is ambiguous: reconcile by request UUID before deciding whether a retry is needed.
- Core/DBC upgrade adds nodes: keep the boost disabled until the checked-in masks and revision metadata are regenerated and verified; a later user request can add the new bits.
- Feature is disabled after page load: POST rechecks configuration and performs no mutation.

## Migration and Deployment

1. Reconfirm the deployed core's 14-word mask size, serialization, taxi-cheat behavior, and faction/DK mask construction.
2. Produce and peer-review the source-owned mask artifact against the exact deployed DBC/core revision.
3. Add the portal-state migration and update migration documentation.
4. Add `BOOST_FLIGHT_PATHS_ENABLED=false` to `.env.example` and the production environment.
5. Apply the migration while connected to `PORTAL_STATE_DATABASE`.
6. Apply only the documented portal-state grants, missing character reads, and column-scoped `UPDATE(taximask)` grant.
7. Deploy with the feature disabled.
8. Run automated tests and inspect the generated SQL shape without live mutation.
9. Back up the test characters' original `taximask` values through an operator-controlled process.
10. Test dedicated offline Alliance, Horde, and Death Knight characters at real flight masters.
11. Exercise online rejection, replay, already-known behavior, malformed test data, and an ambiguous-commit simulation.
12. Enable after owner review and retain the mask provenance record.

Rollback first sets `BOOST_FLIGHT_PATHS_ENABLED=false` and then restores the prior portal build if necessary. Keep audit rows required for reconciliation. Rollback does not remove learned flight paths or write old taxi masks back to characters.

## Acceptance Criteria

- Only authenticated users can see or invoke Flight Risk.
- A user can target only a currently owned, non-deleted character.
- An online character is rejected by the API even if the browser state was stale or tampered with.
- An eligible offline Alliance character receives all and only the verified Alliance grant bits, while existing bits remain set.
- An eligible offline Horde character receives all and only the verified Horde grant bits, while existing bits remain set.
- A Death Knight also receives the verified Death Knight bits.
- Repeating the boost is safe and reports `already-known` when no bits need adding.
- The portal never writes all-one words, browser-supplied masks, or opposite-faction grant masks.
- The character update and applied audit record commit atomically.
- Exact request replay never performs a second character update.
- No AzerothCore code, module, SOAP command, RBAC permission, mail, inventory, skill, or mount change is required.
- The production account has only the documented column-scoped character write.
- Other boost cards remain usable when Flight Risk is disabled or unavailable.
- UI states are accessible, responsive, and clear about the offline requirement and non-included flying skills.
- `npm test`, `npm run build`, and `docker compose config` pass.

## Automated Verification

Server tests cover:

- exact 14-word grant-artifact validation and canonical result serialization, including short/empty current masks, unsigned boundaries, and trailing-space handling;
- authoritative race-to-faction and Death Knight selection;
- bitwise OR behavior, preservation of existing bits, and `already-known` detection;
- mask revision/startup validation;
- strict request JSON and UUID/character-ID parsing;
- authentication, ownership, deleted-character, origin, CSRF, disabled, rate-limit, online, and dependency failures;
- transaction boundaries, row locking, optimistic predicates, affected-row contracts, and rollback;
- first request, exact replay, payload conflict, concurrent same-character requests, and ambiguous-commit lookup;
- response/log redaction and no regression to existing boosts.

Frontend tests cover:

- enabled, disabled, no-selection, online, offline, pending, learned, already-known, conflict, expired-session, and dependency-failure states;
- confirmation text using canonical character and faction display data;
- character changes clearing confirmation/result state;
- no raw mask or internal metadata appearing in the DOM;
- keyboard/focus/live-region behavior; and
- narrow-layout placement in the boost-card grid.

Automated tests use fabricated masks and injected database dependencies. They never mutate a live character.

## Operator Verification

1. Confirm the feature is disabled before migration/grants are complete.
2. Review mask provenance and independently compare several known node IDs per faction and the Death Knight special nodes.
3. Inspect effective grants and confirm the sole new AzerothCore write is `UPDATE(taximask)`.
4. Use a dedicated offline Alliance character with only its starting nodes; apply the boost and test routes from multiple continents.
5. Repeat with a dedicated offline Horde character.
6. Repeat with a Death Knight and verify its special flight network remains usable.
7. Confirm opposite-faction-only points were not granted to the ordinary faction test characters.
8. Repeat the same request UUID and then a new UUID; verify no mask bits are removed and the latter reports already known.
9. Keep a test character online and confirm POST returns the safe offline-required conflict without changing its mask.
10. Simulate a database failure before commit and an ambiguous commit response; verify reconciliation and no partial audit/character state.
11. Log in after success, open several flight masters, take representative routes, log out, and confirm the mask persists.
12. Inspect browser responses, logs, and audit rows for prohibited raw masks or database details.

## Owner Decisions

1. Approve or replace the recommended name `Flight Risk`.
2. Confirm that all faction-valid standard nodes should be granted regardless of character level or normal discovery progression.
3. Accept the offline-only flow and documented residual login race for the portal-only implementation.
4. Approve the narrow direct `UPDATE(taximask)` exception for the portal database account.

## Primary References

- Deployed `PlayerTaxi.cpp`: `InitTaxiNodesForLevel`, `LoadTaxiMask`, `AppendTaximaskTo`, and taxi-mask serialization.
- Deployed `PlayerTaxi.h`: `SetTaximaskNode` and the stored `TaxiMask`.
- Deployed `DBCStores.cpp`: construction of global, Alliance, Horde, and Death Knight taxi-node masks.
- Deployed `DBCStructure.h`: `TaxiMaskSize = 14`.
- Deployed `cs_cheat.cpp` and `Player.h`: session-only taxi-cheat flag behavior.
- Deployed `CharacterDatabase.cpp`: prepared `UPDATE characters SET taximask = ? WHERE guid = ?` statement.
