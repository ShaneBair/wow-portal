# Hole Lotta Storage: Portable Hole Bag Boost

Status: Deployed; delivery and request-id replay verified, with remaining in-game/manual abuse checks noted below  
Repository: `wow-portal`  
Depends on: `specs/portal-account-authentication.md`, `specs/player-boosts.md`

## Decision Summary

Add a second authenticated Boosts card named `Hole Lotta Storage`. A player selects one of their characters using the existing page-level selector and can request a bundle containing exactly four `Portable Hole` bags. AzerothCore delivers the bags as four attachments in one in-game mail.

The boost is deliberately repeatable. There is no per-character, per-account, daily, or lifetime bundle limit. Each deliberate submission receives a new request ID, while idempotency ensures that retrying the same request ID cannot accidentally send the same bundle twice. The item entry, quantity, mail copy, and command shape are server-owned constants; the browser cannot choose or override them.

## Item Choice

Use `Portable Hole`, item entry `51809`.

The deployed WotLK world database defines it as:

| Property | Value |
| --- | --- |
| Name | `Portable Hole` |
| Item entry | `51809` |
| Quality | Epic |
| Inventory type | Bag |
| Container slots | `24` |
| Bag family | General-purpose |
| Binding | Bind on Equip |
| Required level | None |
| Maximum owned count | None |
| Stack size | `1` |

`Portable Hole` is the largest general-purpose Bind on Equip bag in this server's WotLK item catalog. The larger 36-slot `Foror's Crate of Endless Resist Gear Storage` is not Bind on Equip and is not an eligible player-facing alternative. The 22-slot `"Gigantique" Bag` and `Glacial Bag` are smaller.

Four Portable Holes correspond to the four character bag-equipment slots beyond the fixed backpack. Delivery does not equip them, replace existing bags, or move existing bag contents; the player handles those actions in game.

## Product Name and Copy

Recommended card name: `Hole Lotta Storage`

Recommended card description:

```text
Running out of room? Mail this character four 24-slot Portable Holes. Send another bundle whenever you need more storage.
```

Recommended primary action: `Send bags`

Recommended confirmation:

```text
Send four Portable Holes to Thalgrim by in-game mail?
```

Recommended confirmed result:

```text
Four Portable Holes were sent to Thalgrim by in-game mail.
```

## Problem

New characters have limited inventory space, while obtaining four large bags normally requires substantial gold or crafting. An authenticated convenience boost should provide a complete set without requiring an administrator to create and mail items manually.

Portable Holes are Bind on Equip and can be traded or sold before use. The owner explicitly accepts the resulting unlimited item and vendor-value source for this friends-only server. Delivery still needs ownership checks, request-level idempotency, ambiguous-result handling, a short operational burst limiter, and a kill switch so network retries or double-clicks do not create unintended extra mail.

## User Outcome

After logging in, a player opens `Boosts`, selects an owned character, reviews the `Hole Lotta Storage` card, and confirms `Send bags`. The selected character receives one in-game mail containing four separate Portable Hole attachments.

The card clearly distinguishes ready, processing, sent, unresolved, disabled, and unavailable states. An exact request is never submitted again automatically, but the player may deliberately create another request for the same character.

## Current Behavior

- Portal account authentication and the shared protected Boosts route are deployed.
- `GET /api/boosts` resolves non-deleted characters owned by the authenticated account, and the page-level character selector is shared by both boost cards.
- `Hole Lotta Storage` uses the private SOAP `send items` command, a dedicated portal-state request table, and read-only mail/item reconciliation.
- The live feature flag is enabled after a successful deployed-core delivery and exact request-ID replay test.
- The existing `Free Money` workflow continues to use authenticated ownership checks, CSRF/origin protection, a shared per-IP mutation limiter, durable request IDs, private SOAP, and mail reconciliation.

## In Scope

- One new card on the existing `/boosts` page.
- Exactly four Portable Holes per accepted request.
- Repeatable requests for any eligible owned character, including concurrent requests with different UUIDs.
- Delivery using AzerothCore's built-in `send items` command.
- Authenticated ownership enforcement immediately before reservation and delivery.
- Durable request-level idempotency, auditing, and ambiguous-result reconciliation.
- A feature-specific kill switch that defaults off.
- Accessible confirmation, progress, success, unresolved, and error states.
- Mocked automated tests and explicitly authorized operator verification.

## Out of Scope

- Choosing a different bag, item, quantity, quality, or mail recipient in the browser.
- Automatically equipping bags, emptying or replacing existing bags, or moving inventory.
- Mailing profession-specific bags or changing the character backpack.
- Direct inserts into AzerothCore item, mail, or inventory tables.
- Creating items with `.additem`, requiring the character to be online, or using a selected in-game player.
- Reversing, deleting, binding, or reclaiming delivered bags.
- Changing `mod-player-statistics`.

## Request Policy

A request is eligible only when all of the following are true:

- the feature kill switch is enabled;
- the request has a valid authenticated portal session, allowed origin, and CSRF token;
- the selected character currently belongs to the authenticated account and is not deleted;
- the shared per-IP boost mutation limiter accepts the request;
- the portal-state database and private SOAP dependency are available.

There is no level requirement because the deployed item template has no required level. There is no per-character, per-account, daily, lifetime, inventory-based, or already-claimed restriction. A player may send repeated bundles to fill bank-bag slots, replace bags, supply alts, trade them, or keep extras.

The existing shared per-IP burst limiter remains an operational safety control against accidental request floods and service abuse; it is not a long-term product quota. A timeout, connection loss, malformed response, process interruption, unknown output, or missing reconciliation result is not a safe signal to replay the same request ID. The player may create a separate deliberate request with a new UUID after reviewing the warning that the prior bundle may already have arrived.

## Boost Overview API

Extend the authenticated response from:

```text
GET /api/boosts
```

with a sibling field:

```json
{
  "characters": [
    {
      "id": "42",
      "name": "Thalgrim",
      "level": 80,
      "race": "Dwarf",
      "class": "Paladin"
    }
  ],
  "money": {
    "enabled": true,
    "minimumGold": 1,
    "maximumGoldPerRequest": 10000,
    "dailyGoldLimit": 20000,
    "dailyRequestLimit": 5
  },
  "portableHoles": {
    "enabled": true,
    "name": "Hole Lotta Storage",
    "itemName": "Portable Hole",
    "itemCount": 4,
    "slotsPerBag": 24,
    "repeatable": true
  }
}
```

Requirements:

- `repeatable` is fixed `true` for this contract and allows the client to state the policy truthfully.
- Do not expose item entry, character GUID semantics, account ID, request database keys, mail IDs, command text, or internal result categories.
- Item name, count, capacity, and boost name come from server constants, not world-database fields rendered directly to the browser.
- Mark the response `Cache-Control: no-store` as required by the parent Boosts contract.
- An invalid feature configuration fails closed. The implementation should keep unrelated public pages available and must not enable item delivery implicitly.

## Delivery API

Add:

```text
POST /api/boosts/portable-holes
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

The request contains no item ID, item name, count, slot count, mail subject, mail body, account identifier, character name, or command fragment.

Server requirements:

- Accept only the same canonical lowercase UUID v4 and bounded opaque character-ID formats used by Free Money.
- Reject unknown properties unless the shared request parser deliberately documents an alternate strict behavior.
- Recheck character ownership immediately before reserving the request.
- Persist the `pending` request transactionally before calling SOAP.
- Apply the existing boost mutation rate limit across both money and item endpoints rather than giving each endpoint a separate burst allowance.

First confirmed success returns HTTP `201`:

```json
{
  "requestId": "10c2a707-1ef5-4d95-b7fe-750c4bd9bfe9",
  "status": "sent",
  "message": "Four Portable Holes were sent to Thalgrim by in-game mail."
}
```

An exact replay of that confirmed request returns HTTP `200` with the same result and does not invoke SOAP again.

Public failures:

- `400`: invalid media type, body shape, request ID, or character ID;
- `401`: missing or expired session;
- `403`: invalid origin/CSRF or character not owned by the session account;
- `409`: request-ID payload conflict or the same request is still processing;
- `429`: shared per-IP boost mutation limit exceeded;
- `503`: feature disabled, dependency unavailable, or delivery cannot be confirmed.

Ownership failures retain the parent contract's nondisclosing wording. A prior request for the same character never causes an already-claimed response.

## AzerothCore Command Contract

After validation, ownership resolution, and durable reservation, construct exactly one server-owned command equivalent to:

```text
send items Thalgrim "Hole Lotta Storage" "Four Portable Holes requested through the portal. Request ID: 10c2a707-1ef5-4d95-b7fe-750c4bd9bfe9" 51809:4
```

Only these values vary:

- canonical character name loaded from the authoritative characters table;
- canonical validated request UUID used only in the fixed mail body.

`51809:4`, the subject, and all remaining body text are fixed constants. Validate the database-derived character name against the exact compatible command-parser contract before interpolation. Never concatenate an item/count string supplied by the browser.

The compatible core's `send items` handler validates the item template and count, splits counts larger than the item's stack size into separate attachments, caps the mail at `MAX_MAIL_ITEMS`, creates the items, and commits the mail in a character-database transaction. Portable Hole has stack size one, so `51809:4` becomes four attachments. Four is within the core's twelve-attachment mail limit.

The SOAP service account needs `RBAC_PERM_COMMAND_SEND_ITEMS`. Grant that specific permission through the normal operator process; do not grant console administrator or arbitrary command access for this feature.

Command success is not equivalent to SOAP HTTP success. Capture the exact successful and failure output from the deployed compatible core. Unknown output fails closed and triggers reconciliation.

## Durable Idempotent Requests

Add an explicit portal-state migration for a narrowly scoped portal-owned table named `portable_hole_boost_requests`; portal startup must not create or alter schemas. An equivalent table name is acceptable during implementation only if it preserves this contract and remains distinct from money requests.

Each request record contains:

- canonical UUID request ID as primary key;
- fixed boost key `portable-holes-v1`;
- authenticated account ID snapshot;
- character GUID and canonical character-name snapshot;
- fixed item entry `51809` and quantity `4` snapshots;
- status: `pending`, `sent`, `failed`, or `unknown`;
- short internal result category;
- created, updated, and completed UTC timestamps;
- no credentials, session/cookie/CSRF data, IP address, email, raw command, or raw SOAP body.

Workflow:

1. Begin a transaction and resolve any existing request ID.
2. For a new UUID, insert the `pending` request. The request ID primary key prevents concurrent execution of the same logical request.
3. Commit before invoking SOAP so another process or retry sees the request.
4. Execute the one fixed `send items` command.
5. On proven success, mark the request `sent`.
6. On a proven pre-delivery rejection, mark the request `failed`.
7. On an ambiguous outcome, mark `unknown`. Never automatically resend that UUID.
8. Exact `sent` replay returns the stored result. Exact `pending`, `failed`, or `unknown` replay does not call SOAP.
9. A UUID reused for a different account, character, boost key, item entry, or quantity is a conflict.
10. A different valid UUID is an independent deliberate request even when the account and character are identical, and may execute concurrently.

Keep request audit rows for at least 90 days and never remove evidence still needed to reconcile a pending or unknown delivery.

## Mail Reconciliation

For timeout, connection loss, malformed output, or stale `pending`, query the authoritative characters mail data read-only. A confirmed match requires:

- receiver GUID equals the selected character;
- fixed subject and exact request-ID body marker match;
- exactly four attached item instances resolve to item entry `51809`;
- no unexpected attachment is present.

A unique exact match permits transition to `sent`. Zero matches is not proof of failure because delivery visibility and later player mail actions can race reconciliation. Multiple or partial matches are ambiguous. Retain `unknown` and expose the request ID to the player. The UI warns that the mail may already exist; it must not automatically replay that UUID.

The implementation must inspect the compatible characters schema and prove the minimum `mail`, `mail_items`, and item-instance columns needed. Do not guess column semantics or add write grants to AzerothCore mail/item tables.

## React Card Behavior

Place `Hole Lotta Storage` alongside or below `Free Money` in the existing Boosts card area. The page-level selected character controls both cards independently.

The card contains:

- heading `Hole Lotta Storage`;
- copy stating `Four 24-slot Portable Holes` and that the boost is repeatable;
- `Send bags` action when available;
- an explicit character-named confirmation step before mutation;
- a polite live-region result.

States:

- `available`: enable the action when a character is selected and no request is active;
- `confirming`: show the selected canonical display name and quantity with Confirm and Cancel actions;
- `submitting`: disable actions and show `Sending bags...`;
- `sent`: show the confirmed result, then allow another deliberate request with a new UUID;
- `pending`: show that this request is processing and do not replay its UUID;
- `unknown`: show `Delivery could not be confirmed and may already have arrived. Check your mail before sending another bundle. Request ID: ...`;
- feature disabled: show `This boost is currently unavailable.` without hiding its policy;
- no character/character load failure/session expiry: follow the parent Boosts page behavior.

Changing the selected character cancels an unsubmitted confirmation. It must not erase a submitted `pending` or `unknown` result from protected client state in a way that encourages an accidental replay. On logout or account change, clear all protected boost request data immediately.

## Accessibility and Responsive Design

- Use a semantic heading, description, status region, and real buttons.
- The confirmation step must be fully keyboard operable, announce its purpose, and return focus sensibly on cancel.
- Include quantity, bag capacity, selected character, and repeatable policy in text; do not communicate them only through an icon or color.
- Preserve visible focus and distinguish disabled, sent, and unresolved states without relying only on color.
- Keep the card and confirmation usable without horizontal scrolling at the existing mobile breakpoint.

## Configuration

Add one server-side setting with a disabled default:

```text
BOOST_PORTABLE_HOLES_ENABLED=false
```

The item entry, count, slots, boost key, subject, and body are contract constants rather than environment variables. Making them configurable would expand the command-injection and operator-misconfiguration surface without serving this fixed product requirement.

An invalid boolean fails this feature closed. It must never default to enabled. Document only a placeholder in `.env.example`.

## Database Permissions

In addition to the permissions already required for authenticated Boosts, the portal database user needs only:

- `SELECT`, `INSERT`, and `UPDATE` on the portal-owned item request table;
- read-only access to the minimum mail, attachment, and item-instance columns required for reconciliation.

No runtime world-database read is required because the item contract is fixed and verified before enablement. The portal must not receive write access to AzerothCore auth, characters, world, mail, inventory, or item-instance tables.

## Security, Privacy, and Logging

- Reuse authenticated account identity, origin checking, CSRF protection, strict JSON limits, and the shared per-IP boost limiter.
- Resolve ownership and character name server-side for every POST.
- Never expose or log SOAP credentials, cookies, CSRF values, raw SOAP XML, raw database errors, complete command strings, or request bodies.
- Log request ID, boost key, internal result category, and non-secret numeric ownership identifiers only when operationally useful.
- Do not disclose whether an unowned character exists or which account owns it.
- Mark all responses `Cache-Control: no-store`.
- Keep SOAP and databases private; the browser communicates only with same-origin portal APIs.

## Failure and Race Behavior

- Character deleted/transferred before POST: ownership check fails and no reservation or command occurs.
- Character renamed after GET: POST resolves and uses the current safe name.
- The same UUID submitted concurrently: the request primary key permits at most one command path.
- Two different UUIDs submitted concurrently for one character: both are independent valid requests and may each send one bundle.
- Exact UUID replay after success: return prior success without another command.
- UUID replay with altered details: reject as conflict.
- SOAP timeout after possible execution: reconcile; otherwise retain `unknown` and never replay that UUID automatically.
- Portal restart after `pending`: reconcile stale requests before permitting any related action.
- Proven command rejection: mark the request failed; a later deliberate request uses a new UUID.
- Mail already collected before reconciliation: absence of attachments is not proof of failure; remain unknown.
- Configuration disabled after page load: POST uses current configuration and sends nothing.
- Item template missing or altered in a future core/data update: operator verification fails and the feature remains disabled until the contract is reviewed.

## Deployment

1. Complete and verify the parent authenticated Free Money Boosts foundation.
2. Reconfirm item `51809` in the deployed world database: general bag, 24 slots, Bind on Equip, stack size one, no uniqueness or level restriction.
3. Confirm `send items <character> <subject> <body> 51809:4` syntax, output, offline behavior, and four-attachment result using a dedicated test character.
4. Add only `RBAC_PERM_COMMAND_SEND_ITEMS` to the portal SOAP account if it does not already have it.
5. Apply the additive portal-state migration and least-privilege grants.
6. Deploy with `BOOST_PORTABLE_HOLES_ENABLED=false`.
7. Run automated and authorized end-to-end verification, including idempotency and ambiguous-result handling.
8. Enable only after owner approval.

Rollback first disables `BOOST_PORTABLE_HOLES_ENABLED`, then restores the prior portal build if necessary. Retain requests needed for reconciliation. Rollback does not delete or reclaim delivered items.

## Acceptance Criteria

- The card uses the owner-approved `Hole Lotta Storage` name and clearly states four 24-slot Portable Holes.
- A signed-in player can target only a current non-deleted character owned by their account.
- One accepted request sends exactly one in-game mail containing four separate item `51809` attachments.
- The browser cannot choose or modify the item entry, count, subject, body, command, account, or character name.
- The same character can receive any number of bundles through separate deliberate requests; no per-character, per-account, daily, or lifetime product limit is enforced.
- Exact confirmed replay sends no additional mail; payload conflicts are rejected.
- Ambiguous outcomes never trigger an automatic replay of the same UUID and expose a request ID plus a check-mail warning.
- Different UUIDs remain independent even when submitted for the same character.
- The feature-specific kill switch defaults off and blocks command execution.
- Existing Free Money behavior and public portal pages remain functional when this feature is disabled.
- The UI is accessible and responsive across available, confirmation, processing, sent, unknown, disabled, empty-character, and expired-session states.
- No implementation path directly writes AzerothCore mail, inventory, item-instance, character, auth, or world data.
- Automated tests and the repository build pass without contacting the live realm.

## Automated Verification

Server tests cover:

- strict request parsing and rejection of item/count or unknown browser fields;
- authentication, origin, CSRF, ownership, disabled-feature, and rate-limit failures before SOAP;
- fixed command construction with item `51809`, count `4`, fixed mail copy, safe canonical name, and UUID marker;
- first request, exact replay, conflicting replay, same-UUID concurrency, and different-UUID concurrency;
- transaction rollback and proven pre-delivery failure;
- timeout/unknown behavior with exact, absent, partial, and multiple mail reconciliation matches;
- stale `pending` recovery and restart behavior;
- repeatable overview metadata without cross-account data;
- response and log redaction.

Frontend tests cover:

- card content and repeatable policy;
- confirmation and cancellation;
- disabled/loading/submitting controls and double-click prevention;
- repeated successful deliveries, pending, unknown, disabled, dependency error, and session-expired states;
- selector changes and protected-query clearing on logout/account change;
- keyboard operation, focus behavior, live-region announcements, and narrow layout.

All automated SOAP/database boundaries are mocked. They must never create live items or mail.

## Operator Verification

1. Inspect and back up before applying the portal-state migration and grants.
2. Verify the item-template facts and exact `send items` behavior on the deployed compatible core.
3. Confirm the feature-disabled POST cannot invoke SOAP.
4. With a dedicated ordinary account and test character, submit once while the character is offline.
5. Confirm exactly one mail, four separate Portable Hole attachments, and no unexpected attachment or money.
6. Equip the four bags and confirm each provides 24 general-purpose slots.
7. Replay the exact HTTP request and confirm it produces no second mail.
8. Submit a new UUID for the same character and confirm it deliberately produces a second mail with four more bags.
9. Attempt another account's character ID, altered payload fields, malformed UUIDs, CSRF failures, and rapid submissions.
10. Simulate ambiguous command completion and confirm reconciliation or durable `unknown` without replaying the same UUID.
11. Inspect browser responses, portal state, grants, and logs for prohibited data.
12. Enable the feature only after the owner approves the remaining decisions.

Progress recorded on August 27, 2026:

- Completed: pre-change backups, additive migration, least-privilege database grants, item-template verification, narrow `send items` RBAC grant, disabled-first rebuild, offline delivery, four exact attachments with no money, exact request-ID replay without a duplicate mail, enabled metadata, portal health, and signed-out API rejection.
- Still recommended as manual follow-up: equip the bags in game to confirm their visible capacity; exercise live cross-account, malformed-request, CSRF, and burst-limit failures; and simulate an ambiguous completion against the deployed environment.

## Owner Decisions

1. Approve or replace the recommended product name `Hole Lotta Storage`.
2. Approve the fixed subject/body copy and visible request ID in the mail.
3. Confirm that every owned non-deleted character is eligible regardless of level or current bag inventory.
4. Confirm the unknown-delivery warning: players may deliberately submit a new UUID after checking their mailbox, but the portal never automatically retries the ambiguous UUID.

## Primary References

- Deployed AzerothCore `acore_world.item_template` row for item `51809`, inspected for this specification.
- Compatible core `src/server/scripts/Commands/cs_send.cpp`, especially `HandleSendItemsCommand` and `RBAC_PERM_COMMAND_SEND_ITEMS`.
- AzerothCore GM command reference: <https://www.azerothcore.org/wiki/gm-commands>
