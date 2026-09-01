# Tomeward Bound: Arcane Tome of Displacement Boost

Status: Draft; item contract verified, repeatability policy pending owner approval

Repository: `wow-portal`

Depends on: `specs/portal-account-authentication.md`, `specs/player-boosts.md`, `specs/hole-lotta-storage-boost.md`

## Decision Summary

Add an authenticated Boosts card that mails exactly one `Arcane Tome of Displacement` to the character selected by the existing page-level character selector.

Recommended card name: `Tomeward Bound`

Delivery uses AzerothCore's private `send items` command and in-game mail. It does not send an email to the portal account's email address. The browser supplies only a request UUID and opaque selected-character ID; the item entry, quantity, mail subject, body, and command shape are fixed server constants.

The workflow reuses the established Portable Hole safety model:

- authenticated ownership is rechecked immediately before delivery;
- a durable request record is committed before SOAP execution;
- exact request-ID replay never sends a duplicate mail;
- ambiguous execution is reconciled against mail data and is never automatically retried;
- the shared boost mutation limiter remains in force; and
- a feature-specific kill switch defaults off.

The fixed item is world-database entry `900001`. Separate deliberate requests are proposed, with no portal lifetime or per-character claim lock. Because the deployed item is unique and a character can own only one at a time, that repeatability policy requires owner approval and an in-game duplicate-delivery check before enablement.

## Verified Item Contract

Read-only inspection of the deployed `acore_world.item_template` row on August 31, 2026 confirmed:

- entry: `900001`;
- name: `Arcane Tome of Displacement`;
- quality: epic (`4`);
- binding: bind on pickup (`bonding = 1`);
- ownership/stacking: unique and non-stackable (`maxcount = 1`, `stackable = 1`);
- requirements: no level, class, race, skill, spell, honor, or reputation restriction;
- duration and charges: permanent and non-consumable (`duration = 0`, use charges `0`);
- vendor value: no buy or sell price;
- client display: existing book display ID `1103`;
- use hook: spell `483`, handled as an item-use trigger rather than cast as the tome's effect; and
- custom script: `item_arcane_tome_of_displacement` from deployed module `mod-travel-book`.

The deployed module documentation confirms that right-clicking the tome opens its configured travel menu. Use is refused while the character is dead, already teleporting, on a taxi, in a vehicle, on a moving transport, or participating in a battleground or arena. Combat use is controlled by the module and defaults off. These are use-time rules, not portal delivery restrictions.

The portal contract must use entry `900001` and quantity `1` as source constants. Item `29739` (`Arcane Tome`) is a different standard item and must never be substituted. The portal does not create or modify the world item template, travel destinations, or `mod-travel-book` behavior.

## Product Name and Copy

Recommended card heading:

```text
Tomeward Bound
```

Recommended description:

```text
Mail the selected character a reusable Arcane Tome of Displacement that opens the server's configured travel menu.
```

Recommended restriction note:

```text
Unique: each character can own only one at a time.
```

Recommended primary action:

```text
Send tome
```

Recommended confirmation:

```text
Send one Arcane Tome of Displacement to Thalgrim by in-game mail?
```

Recommended confirmed result:

```text
An Arcane Tome of Displacement was sent to Thalgrim by in-game mail.
```

Recommended mail subject:

```text
Tomeward Bound
```

Recommended fixed mail body prefix:

```text
One Arcane Tome of Displacement requested through the portal. Request ID: <request UUID>
```

The server replaces `<request UUID>` with the canonical request UUID. The body contains no account name, credentials, session material, database IDs, or user-supplied prose.

## Problem

The intended tome is useful enough that the server owner wants friends to obtain it without locating a vendor, using a GM account, or asking an administrator to create and mail it manually. The portal already has a protected character selector and a safe fixed-item mail workflow, so this should be exposed as another narrowly constrained convenience boost.

Item creation is still a privileged, externally visible mutation. A double-click, browser retry, SOAP timeout, or process restart must not create unintended duplicate mail, and the browser must never be able to substitute another item or recipient.

## User Outcome

After logging in, a player opens `/boosts`, selects an owned character, and reviews the `Tomeward Bound` card. After explicit confirmation, the selected character receives one in-game mail containing one verified Arcane Tome of Displacement.

The card distinguishes available, confirming, sending, sent, unresolved, disabled, and unavailable states. The player can make another deliberate request using a new UUID, while replaying the same UUID never sends another item.

## Current Behavior

- `/boosts` is authenticated and uses one shared page-level character selector.
- `GET /api/boosts` returns only current non-deleted characters owned by the authenticated account.
- Free Money and Hole Lotta Storage already enforce session, origin, CSRF, ownership, durable request identity, private SOAP, reconciliation, and sanitized errors.
- `Hole Lotta Storage` already proves the deployed `send items` and read-only mail-reconciliation pattern for fixed items.
- The shared mutation limiter applies across existing boost endpoints.
- No deployed item with the exact requested name was found during specification discovery.

## In Scope

- One new card on the existing `/boosts` page.
- Exactly one verified tome per accepted request.
- In-game mail delivery through the compatible `send items` command.
- Current account/character ownership validation.
- Strict fixed server constants for the item and mail contract.
- Durable idempotency and read-only mail reconciliation.
- A dedicated disabled-by-default feature flag.
- A narrowly scoped additive portal-state migration.
- Accessible confirmation and result states.
- Mocked automated verification and explicitly authorized deployed-realm checks.

## Out of Scope

- Sending email to the account's registered email address.
- Letting the browser choose an item, quantity, mail text, recipient name, or account.
- Creating or modifying the requested item template, spell, or supporting AzerothCore module.
- Direct writes to AzerothCore mail, inventory, item-instance, character, auth, or world tables.
- Automatically learning, equipping, consuming, or activating the tome.
- Removing, reclaiming, refunding, or replacing a delivered tome.
- Inspecting character inventory as the primary idempotency mechanism.
- Changing Free Money, Portable Hole delivery, or `mod-player-statistics`.

## Eligibility and Repeatability

A request is eligible only when:

- `BOOST_ARCANE_TOME_ENABLED` is valid and enabled;
- item entry `900001` and count `1` are compiled as server-owned contract constants;
- the request has a valid portal session, allowed origin, and CSRF token;
- the selected non-deleted character currently belongs to the authenticated account;
- the shared per-IP boost mutation limiter accepts the request; and
- portal-state, character-read, SOAP, and reconciliation dependencies are available.

There is no portal-maintained per-character, per-account, daily, or lifetime claim limit. Each deliberate request uses a fresh UUID. The shared burst limiter is operational protection, not a product quota.

This repeatability decision does not override the tome's unique-item rule. The card must state that each character can own only one at a time. Before enablement, operator verification must confirm what happens when a second tome is mailed while the first is owned. If the second attachment cannot be collected, the owner must explicitly accept that behavior or revise this specification to prevent additional claims.

## Boost Overview API

Extend:

```text
GET /api/boosts
```

with:

```json
{
  "arcaneTome": {
    "enabled": false,
    "name": "Tomeward Bound",
    "itemName": "Arcane Tome of Displacement",
    "itemCount": 1,
    "repeatable": true
  }
}
```

Requirements:

- The field is a sibling of `money` and `portableHoles`.
- Metadata comes from fixed server constants.
- Do not expose the item entry, boost key, account ID, character GUID, mail IDs, database table, command, or internal result category.
- Preserve `Cache-Control: no-store` and the protected-query cache behavior.
- Missing or invalid feature configuration reports `enabled: false` or the established safe overview failure behavior; it never enables delivery implicitly.

## Delivery API

Add:

```text
POST /api/boosts/arcane-tome
Content-Type: application/json
X-CSRF-Token: opaque-token
```

Request:

```json
{
  "requestId": "10c2a707-1ef5-4d95-b7fe-750c4bd9bfe9",
  "characterId": "42"
}
```

The server accepts only the two documented properties. It reuses the existing canonical lowercase UUID v4 and bounded opaque character-ID validators. The request must not accept an item entry, name, quantity, mail field, account identifier, character name, boost key, or command fragment.

First confirmed success returns HTTP `201`:

```json
{
  "requestId": "10c2a707-1ef5-4d95-b7fe-750c4bd9bfe9",
  "status": "sent",
  "message": "An Arcane Tome of Displacement was sent to Thalgrim by in-game mail."
}
```

An exact confirmed replay returns HTTP `200` with the same public result and does not call SOAP again.

Public failures follow the established boost contract:

- `400`: invalid media type, JSON shape, request UUID, or character ID;
- `401`: missing or expired session;
- `403`: invalid origin/CSRF or character not owned by the authenticated account;
- `409`: request-ID conflict or the same request is still processing;
- `429`: shared boost mutation limit exceeded;
- `503`: feature disabled, item contract unavailable, dependency unavailable, proven delivery failure, or delivery cannot be confirmed.

Ownership errors remain nondisclosing. No response reveals whether another account owns a supplied character ID.

## AzerothCore Command Contract

After all validation, ownership resolution, and durable reservation, construct one command equivalent to:

```text
send items Thalgrim "Tomeward Bound" "One Arcane Tome of Displacement requested through the portal. Request ID: 10c2a707-1ef5-4d95-b7fe-750c4bd9bfe9" 900001:1
```

Only these values vary:

- canonical character name loaded from the authoritative characters database; and
- canonical request UUID embedded in the fixed body.

Item entry `900001`, `:1` quantity, subject, and body prefix are source constants. Validate the database-derived character name against the existing compatible command-parser allowlist. Never concatenate browser-supplied command or item text.

Reuse the existing narrow `RBAC_PERM_COMMAND_SEND_ITEMS` permission. Do not grant a broader console role. Confirm the deployed core's exact success and known rejection output for the verified item; unknown output is ambiguous, not success.

## Durable Request Record

Add an additive portal-state migration for a dedicated table:

```text
arcane_tome_boost_requests
```

Portal startup must not create or alter schemas. The table records:

- canonical request UUID primary key;
- fixed boost key `arcane-tome-displacement-v1`;
- authenticated account-ID snapshot;
- selected character GUID and canonical-name snapshot;
- verified item-entry snapshot;
- fixed item count `1`;
- status `pending`, `sent`, `failed`, or `unknown`;
- bounded internal result category;
- created, updated, and completed UTC timestamps.

It must not contain credentials, cookies, CSRF values, passwords, email addresses, IP addresses, raw commands, or raw SOAP bodies.

The implementation may extract shared fixed-item boost helpers from Portable Hole code, but it must preserve existing Portable Hole behavior and existing request rows. Do not rename, repurpose, or migrate `portable_hole_boost_requests` as part of this feature.

### Idempotent workflow

1. Recheck current ownership and canonical character name.
2. Acquire the bounded per-request lock and transactionally inspect the UUID.
3. Insert and commit a new `pending` record before SOAP execution.
4. Execute exactly one fixed `send items` command.
5. Mark a proven success `sent`.
6. Mark only a proven pre-delivery rejection `failed`.
7. Reconcile an ambiguous result; mark it `sent` only on one exact mail match, otherwise `unknown`.
8. Exact `sent` replay returns the stored success without SOAP.
9. Exact `pending`, `failed`, or `unknown` replay never invokes SOAP automatically.
10. A UUID reused with a different account, character, boost key, item entry, or count is a conflict.
11. A new UUID is an independent deliberate request.

Retain audit rows for at least 90 days and retain every row still needed to investigate pending or unknown delivery.

## Mail Reconciliation

For timeouts, connection loss, unknown output, or stale `pending`, query AzerothCore character-mail data read-only.

One exact match requires:

- receiver GUID equals the selected character;
- subject equals `Tomeward Bound`;
- body equals the fixed text plus the exact UUID;
- mail contains exactly one attachment;
- that attachment resolves to the verified item entry with count `1`; and
- mail contains no money or unexpected attachment.

One exact match may transition the request to `sent`. Zero matches is not proof of failure because SOAP completion and player mail actions can race reconciliation. Partial or multiple matches remain `unknown`. The same UUID is never resent automatically.

Reuse only the already documented read-only `mail`, `mail_items`, and `item_instance` reconciliation columns. No AzerothCore write permission is added.

## React Card Behavior

Place `Tomeward Bound` in the existing boost-card grid and keep the page-level selector as its recipient source.

The card contains:

- heading `Tomeward Bound`;
- the exact verified item name and quantity;
- `Send tome` action;
- explicit character-named confirmation with Confirm and Cancel;
- a polite live-region result; and
- the verified unique-item warning; and
- an optional concise note that the reusable tome opens the server's travel menu.

States:

- `available`: one selected character and no active request;
- `confirming`: name the selected character and one tome;
- `submitting`: disable repeat actions and show `Sending tome...`;
- `sent`: announce the confirmed result and permit a new deliberate request;
- `pending`: report that the UUID is processing and do not replay it;
- `unknown`: report that delivery may already have occurred, instruct the user to check in-game mail, and display the request ID;
- `disabled`: show `This boost is currently unavailable.`;
- character-loading, empty-character, dependency-error, and session-expired states follow the parent Boosts behavior.

Changing the selected character cancels only an unsubmitted confirmation. It must not erase a submitted pending/unknown warning in a way that encourages replay. Logout, account change, and passive session expiry clear protected boost state.

## Accessibility and Responsive Design

- Use semantic headings, descriptions, status regions, and real buttons.
- Confirmation must be keyboard operable and return focus sensibly when cancelled.
- Communicate recipient, quantity, item restrictions, disabled state, progress, and result in text rather than icon or color alone.
- Preserve visible focus and existing mobile card behavior without horizontal scrolling.
- Do not auto-focus a destructive or mutating confirmation action.

## Configuration

Add one server-only setting:

```text
BOOST_ARCANE_TOME_ENABLED=false
```

Requirements:

- missing or invalid values fail this boost closed;
- the default is disabled;
- `.env.example` documents only the disabled placeholder;
- the item entry is not an environment variable; and
- enablement occurs only after exact item and delivery verification.

The fixed item entry belongs in source after authoritative verification. Keeping it out of environment configuration prevents accidental arbitrary-item delivery and avoids a new command-injection surface.

## Database and RBAC Permissions

The portal database account needs only:

- `SELECT`, `INSERT`, and `UPDATE` on `arcane_tome_boost_requests`; and
- its already-established read-only ownership and mail-reconciliation columns.

The SOAP account reuses only `RBAC_PERM_COMMAND_SEND_ITEMS`. No new world-database runtime read is needed after the item contract is verified. The portal receives no write access to AzerothCore auth, characters, world, mail, inventory, or item-instance tables.

## Security, Privacy, and Logging

- Reuse authenticated principal, strict origin/CSRF enforcement, JSON limits, and the shared mutation limiter.
- Resolve ownership and current character name on every POST.
- Mark overview and mutation responses `Cache-Control: no-store`.
- Never expose the item entry, account ID, GUID, command, SOAP response, internal mail IDs, or request-table state beyond the public request ID/status contract.
- Never log credentials, cookies, CSRF tokens, raw SOAP XML, raw request bodies, complete commands, or raw database errors.
- Operational logs may include the request UUID, fixed boost key, coarse result category, and non-secret internal ownership IDs only when useful.
- Keep databases and SOAP private; the browser uses only same-origin portal APIs.

## Failure and Race Behavior

- Feature disabled or fixed item contract unavailable: no reservation and no SOAP call.
- Character deleted/transferred before POST: ownership fails before reservation.
- Character renamed after overview load: POST uses the current safe canonical name.
- Same UUID submitted concurrently: at most one command path.
- Different UUIDs for the same character: independent deliberate requests.
- Exact success replay: stored success, no second mail.
- UUID payload conflict: `409`, no command.
- SOAP timeout after possible execution: reconcile or retain durable `unknown`.
- Portal restart with stale `pending`: reconcile before treating the request as resolved.
- Mail already collected before reconciliation: absence is not proof of failure; remain `unknown`.
- Item missing after a core/data update: command rejection fails safely and the operator disables the feature.
- Configuration disabled after page load: POST rechecks current configuration and sends nothing.
- Unique-item restriction prevents mail collection: do not report collection success; disable and revise policy if operator verification did not already catch it.

## Migration and Deployment

1. Compile item entry `900001` and count `1` as fixed source constants.
2. Add and review the additive `arcane_tome_boost_requests` migration.
3. Grant only the table permissions described above; retain existing ownership/reconciliation reads and `send items` RBAC.
4. Deploy with `BOOST_ARCANE_TOME_ENABLED=false`.
5. Run automated tests without live dependencies.
6. On an explicitly authorized test character, verify offline delivery, exact attachment, no money, mail retrieval, right-click travel-menu behavior, and use-time restrictions.
7. While that character still owns the tome, send a second deliberate request and document mail delivery and attachment-retrieval behavior.
8. Replay the exact UUID and confirm there is no additional mail.
9. Confirm or revise the repeatability policy based on the duplicate test, then enable the feature only after owner review.

Rollback first sets `BOOST_ARCANE_TOME_ENABLED=false`, then restores the prior portal build if needed. Retain request rows required for reconciliation. Rollback does not remove delivered items or modify the item template.

## Acceptance Criteria

- A signed-in user can select only an owned, current non-deleted character.
- One accepted request sends exactly one in-game mail with exactly one verified Arcane Tome of Displacement and no money or extra attachment.
- All delivery and reconciliation paths use fixed item entry `900001` and count `1`.
- The ordinary `Arcane Tome` (`29739`) is never substituted.
- The browser cannot select or override the item, quantity, account, character name, mail text, boost key, or command.
- Exact request replay never sends a duplicate; conflicting replay is rejected.
- Ambiguous completion never automatically retries and displays a check-mail warning with the request ID.
- New UUIDs remain deliberate independent requests, subject to verified core item restrictions.
- The feature flag defaults off and blocks database reservation and SOAP execution.
- Free Money, Portable Holes, public pages, and unrelated protected features continue to work when this boost is disabled or unavailable.
- The card is accessible and responsive in every documented state.
- No direct AzerothCore data write is introduced.
- `npm run build` and `npm test` pass using mocked SOAP/database boundaries.

## Automated Verification

Server tests cover:

- strict overview metadata and request parsing;
- rejection of browser item/count/mail/command fields;
- disabled, auth, origin, CSRF, ownership, and shared-rate-limit failures before reservation/SOAP;
- fixed command construction using the verified entry and count `1`;
- exact known command outputs and unknown-output handling;
- new request, same-UUID concurrency, confirmed replay, payload conflict, and different-UUID behavior;
- database rollback and request-state transitions;
- exact, absent, partial, multiple, collected, and stale mail reconciliation fixtures;
- safe responses and redacted logs;
- no regression to Portable Hole or Free Money workflows.

Frontend tests cover:

- card name, item name, quantity, verified restriction copy, and disabled state;
- confirmation, cancel, focus, progress, and double-click prevention;
- sent, pending, unknown, dependency-error, empty-character, and expired-session states;
- selector changes and protected cache clearing;
- a second deliberate request receiving a new UUID;
- keyboard and narrow-layout behavior.

Automated tests never contact the live realm or create real mail/items.

## Operator Verification

1. Confirm exact `send items <character> <subject> <body> 900001:1` output on the deployed core.
2. Confirm disabled POST cannot reserve or invoke SOAP.
3. Send once to an offline dedicated test character.
4. Confirm one mail, one entry-`900001` attachment, zero money, and the exact subject/body request marker.
5. Retrieve the tome and confirm that right-click opens the configured travel menu.
6. Verify bind-on-pickup, permanent/non-consumable behavior, use-time restrictions, deletion, and uniqueness.
7. Replay the exact request and confirm no duplicate mail.
8. Submit a fresh UUID while the tome is still owned; document second-mail and attachment-retrieval behavior before approving repeatability.
9. Exercise cross-account character IDs, malformed fields, CSRF failure, burst limiting, timeout, unknown output, and restart reconciliation.
10. Inspect responses, logs, grants, and state rows for prohibited data before enablement.

## Owner Decisions

1. Approve or replace the recommended card/mail name `Tomeward Bound`.
2. Approve the fixed mail body and visible request UUID.
3. Confirm repeatable requests with no lifetime claim lock after reviewing the unique-item duplicate-delivery test.
4. Approve the recommended travel-menu description and unique-item warning.

## Primary References

- Deployed `acore_world.item_template` row for entry `900001`, read-only verified on August 31, 2026.
- Deployed `mod-travel-book` README, feature specification, SQL, and item-script registration for `item_arcane_tome_of_displacement`.
- Compatible AzerothCore `send items` implementation and existing verified Portable Hole workflow.
- AzerothCore GM command reference: <https://www.azerothcore.org/wiki/gm-commands>
