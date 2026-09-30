# Item Delivery Service Boost

Status: Draft for owner review

Repository: `wow-portal`

Depends on:

- `specs/implemented/portal-account-authentication.md`
- `specs/implemented/player-boosts.md`
- the existing shared `/boosts` character selector and fixed-item mail workflow

## Decision Summary

Add an authenticated `Item Delivery Service` card to `/boosts`. A player selects one of their own characters, enters a numeric WotLK item entry and a quantity that defaults to `1`, reviews the resolved item name, and confirms delivery.

Every accepted request is delivered through AzerothCore in-game mail using the existing console-enabled `send items` command. Delivery works whether the selected character is online or offline and does not require an AzerothCore source change, custom module, or worldserver rebuild.

“Mail” in this specification always means AzerothCore in-game mail, never email to the account's registered email address.

## Why Mail Only

Read-only source inspection of the deployed Playerbots-compatible AzerothCore tree on September 30, 2026 confirmed:

- `send items` is console-enabled and works for connected or offline characters;
- it validates that the item template exists and that the quantity is positive;
- it respects a positive item `maxcount`;
- it splits quantities by the item's maximum stack size;
- it rejects a request requiring more than `MAX_MAIL_ITEMS` attachments; and
- it creates the attachments and mail through AzerothCore's own item and mail APIs.

The deployed stock `additem` command is also console-enabled, but it requires the target to be connected and can add only the portion that fits when inventory space is insufficient. Combining `additem` and `send items` in the portal would introduce partial-delivery, login/logout, response-parsing, and timeout ambiguity.

Always using `send items` is the smallest reliable implementation. It preserves the standard portal deployment workflow and does not require rebuilding the game server.

## Problem

The existing boosts deliver fixed, server-owned items. They do not let an authenticated player request an arbitrary valid item template. Doing this manually requires an administrator to look up the item entry and issue a GM command.

A browser-driven version is more sensitive than a fixed-item boost. Item entry and quantity are user input, item templates have different stack and uniqueness rules, and retries can create duplicate mail. The feature needs strict ownership checks, bounded inputs, authoritative item lookup, durable idempotency, and exact mail reconciliation.

## User Outcome

After logging in, a player opens `/boosts`, selects an owned character in the existing page-level selector, and uses the `Item Delivery Service` card.

The card lets the player:

1. enter a whole-number item ID;
2. see the authoritative item name and maximum accepted quantity;
3. enter a whole-number quantity, defaulting to `1`;
4. confirm the item, quantity, and recipient; and
5. receive confirmation that the items were sent through in-game mail.

The selected character does not need to be online. The portal does not inspect or modify character inventory.

## Current Behavior

- `/boosts` is authenticated and has a shared selector containing the signed-in account's non-deleted characters.
- Existing boosts enforce session authentication, origin and CSRF checks, character ownership revalidation, a shared mutation limiter, durable portal request IDs, private SOAP execution, sanitized errors, and disabled-by-default feature flags.
- Fixed-item boosts already use `send items` and reconcile ambiguous delivery from read-only mail data.
- The portal has no authenticated arbitrary-item lookup endpoint, world-item read configuration on the portal database connection, or generic item-delivery request table.
- Account-visibility exclusions used by public statistics must not hide a signed-in player's own eligible characters on the Boosts page.

## Scope

### In scope

- One new card in the existing Boosts card grid.
- Item entry and quantity supplied by the authenticated user and validated by the server.
- Authoritative item lookup from the configured AzerothCore world database.
- Current character ownership revalidation before delivery.
- In-game mail delivery through the existing private `send items` SOAP command.
- Portal-owned durable request state, UUID idempotency, and exact mail reconciliation.
- A disabled-by-default feature flag and conservative quantity bounds.
- Accessible confirmation, progress, success, failure, and unconfirmed states.
- Mocked automated tests plus explicitly authorized live-realm verification.

### Out of scope

- Direct-to-inventory delivery.
- Checking whether the selected character is online.
- Email to the account's registered email address.
- An AzerothCore source change, custom module, custom command, or worldserver rebuild.
- Choosing another account's character, an account name, or an arbitrary recipient name.
- User-supplied mail subject, mail body, sender, enchantments, random properties, durability, charges, binding state, or item-instance fields.
- Equipping, using, learning, opening, selling, refunding, or deleting delivered items.
- Delivering money, currencies that are not item templates, spells, skills, reputations, quests, achievements, or levels.
- Direct portal inserts or updates to character inventory, `item_instance`, mail, or world item tables.
- Automatic reversal of a completed delivery.
- Treating the item service as an administrator console or accepting raw AzerothCore commands.
- Changing `mod-player-statistics` or its event schema.

## Eligibility and Quantity Policy

A request is eligible only when:

- `BOOST_ITEM_DELIVERY_ENABLED` is valid and enabled;
- the request has an authenticated portal session, allowed origin, and valid CSRF token;
- the selected non-deleted character still belongs to the authenticated account;
- `itemId` resolves to an existing `item_template` row;
- `quantity` is a positive JSON integer;
- the quantity does not exceed the configured absolute maximum;
- the quantity can be represented in at most twelve mail attachment stacks;
- when the template's `maxcount` is positive, the requested quantity does not exceed it;
- the shared boost mutation limiter accepts the request; and
- portal-state, world-item lookup, character-read, SOAP, and mail-reconciliation dependencies are available.

Recommended initial absolute maximum:

```text
BOOST_ITEM_DELIVERY_MAX_QUANTITY=200
```

For an item, calculate the effective maximum as:

```text
min(
  configured absolute maximum,
  item maximum stack size * 12,
  positive item maxcount when one exists
)
```

This prevents the portal from issuing a command that exceeds WotLK's twelve-attachment mail limit. `send items` remains authoritative and independently revalidates the template and count.

Version 1 has no per-character, per-account, daily, or lifetime claim quota. Every deliberate request uses a new UUID. The existing shared per-IP mutation limiter remains operational protection. The owner should enable this only with the understanding that authenticated users may create powerful, rare, quest, bind-on-pickup, or economy-altering items when they know the entry.

## Item Lookup API

Add an authenticated endpoint:

```text
GET /api/boosts/items/:itemId
```

Successful response, HTTP `200`:

```json
{
  "item": {
    "id": 41599,
    "name": "Frostweave Bag",
    "quality": 2,
    "maximumQuantity": 12
  }
}
```

Requirements:

- Accept only ASCII digits representing an integer from `1` through the database/core-supported unsigned item-entry range.
- Query `item_template` with a parameterized statement and return only the documented fields.
- Derive `maximumQuantity` on the server from the effective quantity rule.
- Return `404` with `That item could not be found.` for an unknown entry.
- Return `503` with the standard temporary-unavailability message when lookup/configuration fails.
- Require an authenticated session and mark the response `Cache-Control: no-store`.
- Apply a modest authenticated lookup limiter so rapidly scanning the entire world item table is not an unbounded API.
- Do not return buy/sell prices, scripts, spell data, flags, internal SQL fields, database names, or command fragments.

The lookup is a preview only. The mutation path repeats the authoritative lookup and validation immediately before reserving the request.

## Boost Overview API

Extend the authenticated `GET /api/boosts` response with:

```json
{
  "itemDelivery": {
    "enabled": false,
    "name": "Item Delivery Service",
    "defaultQuantity": 1,
    "maximumQuantity": 200,
    "deliveryMethod": "mail"
  }
}
```

This exposes presentation metadata and the configured absolute ceiling, not proof that a particular item is deliverable. Missing or invalid configuration disables only this card. Preserve existing protected-query cache clearing and `Cache-Control: no-store` behavior.

## Mutation API

Add:

```text
POST /api/boosts/item-delivery
Content-Type: application/json
X-CSRF-Token: opaque-token
```

Request:

```json
{
  "requestId": "d68083f4-44f2-4fb7-890c-1c107ef16e50",
  "characterId": "42",
  "itemId": 41599,
  "quantity": 4
}
```

Accept exactly these properties. Reuse the existing canonical lowercase UUID v4 and bounded opaque character-ID validators. `itemId` and `quantity` must arrive as JSON integers, not strings, decimals, exponents, item links, names, expressions, or command fragments.

First confirmed success returns HTTP `201`:

```json
{
  "requestId": "d68083f4-44f2-4fb7-890c-1c107ef16e50",
  "status": "sent",
  "item": {
    "id": 41599,
    "name": "Frostweave Bag",
    "quantity": 4
  },
  "message": "4 Frostweave Bags were sent to Thalgrim by in-game mail."
}
```

An exact replay of a confirmed request returns HTTP `200` with the stored result and never sends more mail. Public failures follow existing boost conventions:

- `400`: invalid media type, JSON shape, UUID, character ID, item ID, quantity, or item-specific maximum;
- `401`: missing or expired session;
- `403`: invalid origin/CSRF or selected character not owned by the session account;
- `404`: item entry does not exist;
- `409`: request-ID payload conflict or the same request is still processing;
- `429`: mutation limiter exceeded; and
- `503`: disabled feature, dependency failure, command rejection, or unconfirmed outcome.

Ownership failures remain nondisclosing. Browser responses never contain account IDs, character GUID semantics, SQL details, SOAP output, command text, mail IDs, or stack traces.

## AzerothCore Mail Command Contract

After validation, current ownership resolution, authoritative item lookup, and durable request reservation, construct exactly one command equivalent to:

```text
send items Thalgrim "Item Delivery Service" "Items requested through the portal. Request ID: d68083f4-44f2-4fb7-890c-1c107ef16e50" 41599:4
```

Only these values vary:

- canonical character name resolved from the authoritative characters database and validated against the compatible command parser;
- canonical request UUID embedded in the fixed body;
- validated decimal item entry; and
- validated decimal quantity.

The subject, body prefix, spacing, quoting, and command prefix are fixed server constants. The browser never supplies a character name, item name, mail text, or command fragment. The service must construct the command from typed values and must not expose a generic command executor to the route.

Use the existing AzerothCore `RBAC_PERM_COMMAND_SEND_ITEMS` permission and no broader command group or administrator role. SOAP and the worldserver port remain private.

Command success is not defined as SOAP HTTP `200`. Capture compatible fixtures and recognize the exact successful result. Known invalid-item, invalid-count, attachment-limit, missing-character, and other semantic errors are failures. Unknown, malformed, mismatched, or duplicated output is ambiguous and must not be shown as confirmed delivery.

## Durable Request State

Add a portal-state migration for:

```text
item_delivery_requests
```

Record:

- canonical request UUID primary key;
- fixed boost key `item-delivery-v1`;
- authenticated account-ID snapshot;
- character GUID and canonical-name snapshot;
- item entry, item-name snapshot, and requested quantity;
- status `pending`, `sent`, `failed`, or `unknown`;
- bounded result category; and
- created, updated, and completed UTC timestamps.

The table contains no credentials, cookies, CSRF values, email addresses, IP addresses, raw commands, raw SOAP XML, or raw errors. Portal startup does not create or alter schemas.

Workflow:

1. Validate authentication, origin, CSRF, body, feature configuration, item lookup, effective quantity maximum, and ownership.
2. Acquire the request lock and commit a new `pending` row before calling SOAP.
3. On duplicate UUID, compare account, character, item, and quantity. A mismatch is `409`.
4. Execute exactly one fixed `send items` command.
5. Mark exact compatible command success `sent`.
6. Mark only a proven pre-delivery rejection `failed`.
7. On timeout, connection loss, malformed output, process interruption, or uncertain execution, reconcile by exact mail contents.
8. A unique exact mail match confirms delivery and permits transition to `sent`.
9. Zero, partial, multiple, or inconsistent matches leave the request `unknown`; absence is not proof that the command did not execute.
10. Exact `sent` replay returns stored success without SOAP.
11. Exact `pending` or `unknown` replay never invokes SOAP automatically.

Stale `pending` rows are reconciled on startup or request access. Retain request rows for at least 90 days and always retain unresolved rows needed for investigation.

## Mail Reconciliation

For ambiguous execution, query AzerothCore character-mail data read-only.

One exact match requires:

- receiver GUID equals the selected character;
- subject equals `Item Delivery Service`;
- body equals the fixed text plus the exact request UUID;
- the attachment set contains only the requested item entry;
- attachment counts sum exactly to the requested quantity;
- the number of attachment stacks matches the core's expected stack split; and
- the mail contains no money or unexpected attachment.

One exact match may transition the request to `sent`. Zero matches is not proof of failure because command completion and player mail actions can race reconciliation. Partial or multiple matches remain `unknown`. The same UUID is never resent automatically.

Reuse the existing read-only mail reconciliation service and minimum `mail`, `mail_items`, and `item_instance` columns. No AzerothCore write permission is added.

## React Card

Place `Item Delivery Service` in the existing Boosts card grid and use the page-level character selector as its recipient source.

The card contains:

- heading `Item Delivery Service`;
- a short explanation that items arrive through in-game mail whether the character is online or offline;
- labeled `Item ID` text input with numeric input mode;
- an item preview showing the resolved name;
- labeled `Quantity` text input, initialized to `1`;
- item-specific maximum help after lookup;
- `Send item` action; and
- a polite live region for lookup and delivery results.

Use text inputs so validation does not inherit browser-specific number coercion. Client validation accepts ASCII digits only and converts only after the complete string passes. Server validation remains authoritative.

Do not enable confirmation until the selected character, item preview, and quantity are valid. The confirmation names the character, item, entry, and quantity:

```text
Send 4 × Frostweave Bag (item 41599) to Thalgrim by in-game mail?
```

States include `idle`, `looking up`, `item found`, `item not found`, `confirming`, `sending`, `sent`, `failed`, `unknown`, `disabled`, and session/dependency failure.

Changing the item ID clears the old preview and resets quantity to `1`. Changing the selected character cancels only an unsubmitted confirmation. A submitted pending/unknown warning and request ID must remain visible so the player is not encouraged to submit again.

Recommended unknown message:

```text
Delivery could not be confirmed. Do not send it again; give this request ID to an administrator.
```

## Accessibility and Responsive Design

- Use semantic labels, field help, validation messages, status regions, headings, and real buttons.
- Associate invalid state and help text programmatically with each input.
- Announce the resolved item name and final result without repeatedly announcing background refreshes.
- Keep the item ID visible in confirmation so similarly named items are distinguishable.
- Preserve native keyboard behavior, visible focus, and text descriptions that do not rely on color.
- Do not auto-focus the confirmation action.
- Keep the card usable without horizontal scrolling at the existing narrow breakpoint.

## Configuration

Add server-only portal settings to `.env.example`:

```text
BOOST_ITEM_DELIVERY_ENABLED=false
BOOST_ITEM_DELIVERY_MAX_QUANTITY=200
PORTAL_WORLD_DATABASE=world_database
```

Requirements:

- missing or invalid enablement/max values fail this card closed;
- examples contain placeholders only;
- item entry and quantity remain request data, not environment values;
- `PORTAL_WORLD_DATABASE` belongs to the authenticated portal database connection and is not coupled to the statistics credential or `STATS_WORLD_DATABASE`; and
- production remains disabled until migration, grants, command output, item lookup, mail reconciliation, and idempotency are verified.

No AzerothCore module setting or worldserver rebuild is required.

## Database and RBAC Permissions

The portal database account needs only:

- existing character ownership/name reads;
- column-scoped `SELECT` on world `item_template` fields needed for lookup and limits: item entry, name, quality, stack size, and maximum owned count;
- `SELECT`, `INSERT`, and `UPDATE` on portal-state `item_delivery_requests`; and
- the existing minimum read-only mail reconciliation columns.

It receives no write access to AzerothCore auth, characters, inventory, `item_instance`, mail, or world tables. Portal startup does not create schemas, tables, users, or grants.

The private SOAP account reuses only `RBAC_PERM_COMMAND_SEND_ITEMS`. No custom command permission, raw `additem` permission, broader command group, or console-administrator role is required.

## Security, Privacy, and Logging

- Recheck character ownership and item validity on every POST immediately before request reservation.
- Treat item ID and quantity as hostile numeric input even though they are not free-form text.
- Never accept item links, names, SQL fragments, quoted values, signs, whitespace-normalized expressions, or command text.
- Keep the lookup endpoint authenticated, bounded, parameterized, rate-limited, and non-cacheable.
- Keep portal databases and SOAP private.
- Never log credentials, cookies, CSRF tokens, raw request bodies, raw SOAP XML, complete commands, or raw database errors.
- Operational logs may include request UUID, item entry, quantity, coarse result, and non-secret internal ownership IDs when useful.
- Public responses do not expose whether a supplied character belongs to another account.
- An administrator can disable this card without disabling other boosts.

## Race and Failure Behavior

- Character logs in or out: delivery remains mail and is unaffected.
- Character inventory is full: delivery remains mail and does not inspect inventory.
- Character is deleted, transferred, or renamed before POST: ownership/current-name resolution fails before command execution where possible.
- Character is renamed after reservation: command failure is reconciled and never redirected to another character.
- Item template changes between preview and submit: POST uses the new authoritative values and may reject stale quantity.
- Same UUID submitted concurrently: at most one command path.
- Same UUID with different payload: conflict and no delivery.
- Different UUIDs: independent deliberate requests.
- SOAP timeout after possible execution: reconcile exact mail; otherwise retain `unknown` and never resend automatically.
- Portal restart with stale `pending`: reconcile before permitting replay behavior.
- Mail is collected or deleted before reconciliation: absence is not proof of failure; retain `unknown`.
- Feature is disabled after page load: POST rechecks configuration and sends nothing.

## Migration and Deployment

1. Add and review the portal `item_delivery_requests` migration.
2. Add `PORTAL_WORLD_DATABASE` and the disabled feature settings to `.env.example` and production configuration without exposing credentials.
3. Grant the portal only the documented world lookup, portal-state, and mail-reconciliation permissions.
4. Confirm the private SOAP account has `RBAC_PERM_COMMAND_SEND_ITEMS` without a broader administrative role.
5. Deploy the portal with item delivery disabled. No game-server rebuild is required.
6. Run automated tests with mocked database/SOAP boundaries.
7. Run authorized live checks for online and offline recipients, replay, conflicts, invalid entries, stack limits, and ambiguous results.
8. Enable only after the owner accepts the power/economy implications and final quantity maximum.

Rollback first disables `BOOST_ITEM_DELIVERY_ENABLED`, then restores the prior portal build if needed. Preserve request rows required for reconciliation. Rollback never removes delivered items or mail.

## Acceptance Criteria

- Only authenticated users can look up or request items.
- The shared selector exposes only current non-deleted characters owned by the signed-in account.
- Quantity defaults to `1` and both inputs accept only bounded whole-number values.
- The UI resolves and confirms the authoritative item name before submission.
- Every accepted request sends the complete quantity through AzerothCore in-game mail.
- Delivery works whether the selected character is online or offline.
- The implementation uses the existing `send items` command and requires no AzerothCore code/module change or worldserver rebuild.
- Unknown items and quantities exceeding the absolute, stack, attachment, or positive `maxcount` limit are rejected before SOAP.
- Character ownership, item validity, and quantity are rechecked server-side on POST.
- Exact UUID replay never sends additional mail; conflicting reuse is rejected.
- Ambiguous delivery never becomes false success or automatic resend.
- The browser cannot set recipient name, mail prose, item-instance properties, or command text.
- The portal has no write permission to AzerothCore item, mail, auth, character, or world tables.
- Other boosts continue to work when this card or its dependencies are unavailable.
- UI states are keyboard accessible, screen-reader understandable, and responsive.
- `npm run build` and `npm test` pass without contacting the live realm or creating items.

## Automated Verification

Server tests cover:

- strict item-ID/quantity parsing and exact request shape;
- authenticated item lookup, unknown item, configured world schema, output-field stripping, and lookup limiting;
- effective maximum calculations for stack size, twelve attachments, positive `maxcount`, and absolute cap;
- ownership, auth, origin, CSRF, feature flag, mutation limiter, and dependency failures before SOAP;
- safe `send items` construction from canonical server data;
- exact success and known/unknown output classification using deployed-core fixtures;
- first request, exact replay, payload conflict, concurrent replay, stale pending, and mail reconciliation;
- redacted errors and logs; and
- no regression to existing boost routes.

Frontend tests cover:

- default quantity `1`;
- digits-only item and quantity validation;
- item lookup loading, found, missing, changed, and unavailable states;
- item-specific maximum help and confirmation copy;
- character selection changes;
- disabled, confirming, sending, sent, failure, unknown, and expired-session states;
- protected cache clearing on logout/account change; and
- keyboard, labels, live regions, focus, and narrow layouts.

Automated tests never contact SOAP, mutate a live database, or send live mail.

## Operator Verification

1. Confirm the deployed core's `send items` syntax, permission, exact success output, attachment splitting, and maximum-count behavior.
2. Inspect the migration, world-item read grant, portal-state grants, and existing mail-reconciliation grants.
3. With the feature disabled, confirm lookup/mutation fail closed and SOAP is not called.
4. Use a dedicated ordinary account and selected test character.
5. While the character is online, request one stackable item and confirm one mail with the exact quantity.
6. Log out the character, submit a new request, and confirm the same mail behavior.
7. Test a stack-size-one item, a multi-stack item, a positive-`maxcount` item, an unknown entry, zero, negative, decimal, exponent, oversized, and tampered values.
8. Replay the exact UUID and confirm no additional mail.
9. Reuse the UUID with another payload and confirm conflict with no delivery.
10. Simulate a timeout after execution and confirm mail reconciliation does not redeliver.
11. Attempt another account's character ID and verify nondisclosing rejection.
12. Inspect browser responses, logs, grants, and request rows for prohibited data.
13. Test mobile/desktop layout, keyboard use, logout, session expiry, and dependency outages.

## Owner Decisions

1. Approve or replace the recommended absolute maximum of 200 items per request.
2. Confirm that any valid item template is eligible, including rare, bind-on-pickup, quest, and economy-altering items, subject to core rules and quantity limits.
3. Approve the fixed subject `Item Delivery Service` and request-ID mail body.
4. Approve a 90-day minimum retention period for completed request rows.

## Primary References

- Deployed Playerbots-compatible `cs_send.cpp`, `HandleSendItemsCommand`, inspected September 30, 2026.
- Deployed Playerbots-compatible `cs_misc.cpp`, `HandleAddItemCommand`, inspected September 30, 2026, for the rejected direct-inventory alternative.
- Existing portal fixed-item and durable mutation contracts in `specs/implemented/player-boosts.md`, `specs/implemented/hole-lotta-storage-boost.md`, and `specs/implemented/tomeward-bound-arcane-tome-boost.md`.
