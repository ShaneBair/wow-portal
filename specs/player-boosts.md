# Authenticated Player Boosts: Free Money

Status: Implemented locally with proposed limits; deployment requires owner/operator verification  
Repository: `wow-portal`  
Depends on: `specs/portal-account-authentication.md`

## Problem

Players currently need an administrator to grant convenience resources manually. The portal has no account-aware page, cannot list only the signed-in player's characters, and has no safe, auditable write workflow for a player-triggered AzerothCore command.

## User Outcome

After logging in, a player can open a `Boosts` page, choose one of their own characters from a dropdown at the top, enter a whole number of gold in a `Free Money` card, and press `Send gold`. AzerothCore sends that amount to the selected character through in-game mail.

The page clearly reports success, validation failures, temporary unavailability, and the rare case where delivery cannot be confirmed. It never permits one account to target another account's character.

## Current Behavior

- The React application has Home and Stats routes with a shared shell.
- The portal has no authentication, `/boosts` route, character selector, or mutating player tool.
- The statistics database integration can read selected AzerothCore tables but is not an authorization service and must not be repurposed silently.
- The SOAP service executes fixed commands such as `server info`, `playerstats online`, and account creation through the private worldserver endpoint.
- There is no portal-owned request/audit table or idempotency workflow.

## Accepted Product Shape

- Add `Boosts` to primary navigation with canonical route `/boosts`.
- The route requires the portal account session defined in `specs/portal-account-authentication.md`.
- Keep the Boosts navigation link visible while signed out. Opening it sends the user to Login and then safely returns to Boosts.
- Render a page-level character dropdown above all boost cards so future cards can reuse the same selection.
- Add one card in version 1: `Free Money`.
- Accept whole gold only. Do not accept copper, silver, decimals, negative values, scientific notation, arithmetic expressions, or formatted currency strings.
- Deliver the gold through AzerothCore's built-in `send money` command as in-game mail.
- Do not directly update `characters.money`, insert raw AzerothCore mail rows, or require the character to be online.

In-game mail is preferred over “GM touch” because the supported command owns AzerothCore mail transactions, works for offline characters, and avoids the portal racing a live character save or bypassing core rules.

## Security Boundary

The authenticated session establishes an internal account ID. It does not establish character ownership by itself.

For every character-list and money request, the server must use a parameterized query against the authoritative characters table and require:

```text
characters.account = authenticated account ID
AND deleteInfos_Name IS NULL
```

The POST handler repeats this ownership check immediately before command execution, even if the character appeared in a prior GET response. Never accept account ID, account name, character name, command text, mail subject, mail body, or copper amount from the browser as authoritative.

The browser submits an opaque character selector ID. The server resolves the current canonical character name and numeric GUID for the authenticated account. A missing, deleted, renamed-away, or no-longer-owned selection fails without revealing who owns it.

## Character Selector Data

Add an authenticated endpoint:

```text
GET /api/boosts
```

Successful response, HTTP `200`:

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
  }
}
```

Requirements:

- `id` is an opaque browser identifier even if version 1 encodes a numeric character GUID. The client must not infer meaning from it.
- Never return account ID, account login, email, money balance, coordinates, IP, GM level, deletion metadata, database/schema names, or bot flags.
- Use existing typed WotLK race/class mappings and their documented unknown-numeric fallback.
- Sort by character name case-insensitively, with GUID as a stable server-only tie-breaker.
- Include all non-deleted characters owned by the account. Playerbot-controlled alts on that same account are included; random bots are not reachable because their owning account did not authenticate.
- Return `characters: []` when the account has no characters.
- Mark the response `Cache-Control: no-store`.
- Do not cache character ownership across users. A short per-session display cache is unnecessary for version 1; query on page load/refocus as configured by the client.
- If configuration or MariaDB is unavailable, return HTTP `503` with `{ "error": "Boosts are temporarily unavailable." }`.

The response exposes effective limits so the browser can render truthful help, but the server enforces every limit independently.

## Free Money Form

The `Free Money` card contains:

- heading: `Free Money`;
- short copy explaining that whole gold will arrive through in-game mail;
- a visible label such as `Gold amount`;
- a text input with numeric input mode and accessible help showing the accepted range;
- a `Send gold` button.

Use a text input rather than trusting browser number parsing. Client validation accepts ASCII digits only, strips no punctuation silently, and converts to a safe integer only after the full string passes. Server validation remains authoritative.

The selected character at the page top applies to the card. The button is disabled while:

- auth/session state is loading;
- character data is loading;
- no character is selected;
- the gold value is invalid;
- a request is in flight;
- the feature kill switch is off.

Changing characters clears any character-specific success/error message and does not submit automatically.

## Amount and Frequency Policy

Proposed review defaults:

```text
BOOST_MONEY_ENABLED=false
BOOST_MONEY_MAX_GOLD_PER_REQUEST=10000
BOOST_MONEY_DAILY_GOLD_LIMIT=20000
BOOST_MONEY_DAILY_REQUEST_LIMIT=5
```

Rules:

- minimum: 1 whole gold;
- maximum per request: configured value and never above the safe range proven for the compatible `send money` command;
- daily totals are per authenticated account, across all characters;
- `pending`, `sent`, and `unknown` requests count toward daily request and gold limits; definitive pre-delivery failures do not;
- the day boundary is UTC and is returned/described consistently if surfaced in UI;
- configuration values are validated at startup or first use and the feature fails closed when invalid;
- the kill switch defaults off in examples and production until database migration, command-output verification, and end-to-end checks pass.

These limits are abuse/economy guardrails, not client hints. The owner must confirm or replace the proposed numbers before implementation is marked ready.

Gold is converted to copper on the server using checked integer arithmetic:

```text
copper = gold * 10,000
```

Reject any value that is not a safe integer or exceeds the accepted AzerothCore command/mail representation. Never concatenate the raw browser value into a command.

## Money Request API

Add:

```text
POST /api/boosts/money
Content-Type: application/json
X-CSRF-Token: opaque-token
```

Request:

```json
{
  "requestId": "0d6202eb-15c0-4e62-9cc2-f7697dd5866f",
  "characterId": "42",
  "gold": 500
}
```

Requirements:

- `requestId` is a client-generated UUID v4 created once for one deliberate button activation and retained until that request reaches a terminal state.
- `characterId` must match the endpoint's bounded opaque-ID format.
- `gold` must be a JSON integer within current server limits.
- Require an authenticated session, exact allowed origin, and valid session CSRF token.
- Recheck current character ownership and all account limits after validating the request and before invoking SOAP.
- Apply a modest per-IP mutation rate limit in addition to daily per-account limits. Proposed burst limit: five submissions per minute.

First confirmed success returns HTTP `201`:

```json
{
  "requestId": "0d6202eb-15c0-4e62-9cc2-f7697dd5866f",
  "status": "sent",
  "message": "500 gold was sent to Thalgrim by in-game mail."
}
```

An exact replay of a previously confirmed request returns HTTP `200` with the same `sent` result and does not invoke SOAP again.

Public failures:

- `400`: invalid shape, character ID, request ID, or gold amount;
- `401`: missing/expired session;
- `403`: invalid origin/CSRF, or character not owned by the session account;
- `409`: idempotency-key payload conflict, account daily limit exceeded, or a still-processing request;
- `429`: per-IP submission limit exceeded;
- `503`: database/SOAP unavailable or delivery cannot be confirmed.

Use concise public messages. A character ownership failure should say `That character is not available for this account.` without disclosing another owner or character details.

## AzerothCore Mail Command

After ownership and amount validation, build exactly one server-owned command equivalent to:

```text
send money Thalgrim "DaBoysZeroth Boost" "Free Money requested through the portal. Request ID: 0d6202eb-15c0-4e62-9cc2-f7697dd5866f" 5000000
```

Only these values vary:

- canonical character name loaded from the database;
- canonical lowercase UUID already validated to the exact UUID v4 syntax;
- decimal copper string produced from the validated integer gold amount.

The subject and all other body text are fixed server constants. Before interpolation, validate the database-derived character name against the exact compatible AzerothCore character-name contract and reject whitespace, quotes, backslashes, control characters, command delimiters, or any representation the command parser has not been proven to accept. Do not reuse a broad generic command executor with arbitrary browser-derived text.

The configured SOAP service account needs the AzerothCore permission for `send money` and no broader command permission than existing portal operations require. Confirm the exact RBAC/security grants in the live compatible core; do not raise it to console administrator merely for convenience.

Command success is not defined as “SOAP returned HTTP 200.” Implementation must capture fixtures from the compatible core and recognize the exact successful command result without depending on raw output in the browser. A semantic command error, mailbox failure, missing target, SOAP fault, malformed XML, timeout, or unknown output must not be reported as confirmed success.

Do not use direct SQL to update character money or construct AzerothCore mail records. Do not use `.modify money`, which depends on a live/selected player and can race worldserver persistence.

## Durable Idempotency and Audit State

Add an additive migration owned by `wow-portal` for a portal-state schema/table such as `money_boost_requests`. The exact SQL belongs in the implementation change, but the table contract includes:

- canonical UUID request ID as primary key;
- authenticated account ID;
- character GUID and character-name snapshot;
- gold and copper amount;
- status enum or constrained value: `pending`, `sent`, `failed`, `unknown`;
- created, updated, and completed timestamps in UTC;
- a short internal result category;
- no password, session ID, CSRF token, SOAP credential, raw SOAP body, IP address, or email.

The portal database user may `SELECT`, `INSERT`, and narrowly `UPDATE` this portal-owned table. It remains read-only against AzerothCore auth/characters/world tables. Apply the migration as an explicit operator step; portal startup must not create or alter schemas automatically.

Workflow:

1. Begin a transaction, enforce account daily limits, and insert `pending` with unique `requestId`.
2. On duplicate `requestId`, compare account ID, character GUID, and amount. A mismatch is `409`; an exact `sent` replay returns the prior success; exact `pending`/`unknown` does not issue another command.
3. Commit `pending` before calling SOAP so retries and concurrent processes can see it.
4. Execute the one fixed money command.
5. On proven command success, update to `sent`.
6. On a proven pre-delivery semantic failure, update to `failed`.
7. On timeout, connection loss, malformed response, process interruption, or any point where execution may have happened but confirmation is absent, update/recover as `unknown`; never automatically resend.

If SOAP result is ambiguous, query the authoritative mail table read-only for the exact receiver GUID, request ID marker, and copper amount. A unique matching mail proves delivery and permits transition to `sent`. Absence is not proof of failure because of timing or later mail handling; retain `unknown` and instruct the player not to resubmit automatically.

On startup or request access, stale `pending` rows older than the maximum command duration must be reconciled to `sent` when a matching mail exists or to `unknown` otherwise. Never convert them to retryable `failed` automatically.

Retain request rows for at least the accepted daily-limit window. Proposed audit retention is 90 days, with a separately documented bounded cleanup job or operator procedure. Deletion must never affect delivered in-game mail.

## Database Permissions

In addition to authentication reads, the dedicated portal database user needs only:

- `SELECT` on the necessary columns of the AzerothCore characters table;
- `SELECT` on the minimum mail columns needed for ambiguous-result reconciliation;
- `SELECT`, `INSERT`, and `UPDATE` on the portal-owned money-request table;
- optional `DELETE` on old portal request rows only if automated retention is implemented.

It does not need and must not receive write access to AzerothCore auth, characters, mail, item, world, or statistics-event tables. The portal is not responsible for creating the state schema/user/grants at runtime.

## React Page

Add `/boosts` with one page-level `h1` of `Boosts`, a short description, and route-aware title `Boosts | DaBoysZeroth`.

Layout:

```text
Boosts page
  Character selector
  Boost cards
    Free Money
```

Character selector states:

- loading: `Loading your characters...`;
- populated: dropdown with labels such as `Thalgrim — Level 80 Paladin`;
- empty: `This account does not have any characters yet.` and no enabled boost action;
- unavailable: `Your characters are temporarily unavailable.`;
- session expired: return to Login while preserving only the known internal `/boosts` return path.

Selection behavior:

- Default to the first sorted character only after a successful character response.
- Keep selection in component state; do not put a character ID in the URL in version 1.
- Always render a labeled native `select`, even for one character, so the shared page pattern remains stable for future boosts.
- Do not show another account's prior selection while auth state changes.

Submission behavior:

- Create one request UUID when the user deliberately submits, not on every render.
- Disable the inputs/button and show a progress state while the request is active.
- Prevent double-clicks but rely on server idempotency for correctness.
- On confirmed success, announce the message accessibly, clear the amount, retain the selected character, and discard that completed request ID.
- On ordinary validation/definitive failure, keep the useful amount and permit correction or a new deliberate request.
- On `unknown`, show: `Delivery could not be confirmed. Do not send again; give this request ID to an administrator.` Display the request ID and keep the form disabled for that request until page data is refreshed or an administrator resolves it.
- A background refetch must not erase a visible submission result unexpectedly.

Use TanStack Query for authenticated server state and the mutation. Include the authenticated session identity in query ownership or clear all protected query data immediately on logout/session change. Never display one account's cached characters to another account.

## Accessibility and Responsive Design

- Use semantic `main`, heading, form, label, field help, status, and button elements.
- Associate validation text with its input and indicate invalid state programmatically.
- Use an appropriate polite live region for submission status without repeatedly announcing background character refreshes.
- Preserve visible keyboard focus and do not rely on color alone for disabled, error, or success states.
- Keep selector and card usable without horizontal scrolling at the existing narrow breakpoint.
- Ensure tap targets and input text remain comfortably sized on mobile.
- Do not move focus on ordinary validation unless doing so clearly helps recovery; focus the first invalid field after submit when appropriate.

## Logging and Privacy

- Log a request/correlation ID, internal result category, amount, and non-secret numeric ownership identifiers only when operationally useful.
- Never log login credentials, cookies, CSRF tokens, full SOAP XML, SOAP Basic credentials, raw database errors, or full request bodies.
- Do not return account IDs, character GUID semantics, mail table IDs, internal status details, command strings, database names, or raw SOAP output to the browser.
- Avoid logging character/account names on failed authorization. Confirmed audit rows may retain the character-name snapshot for administrator reconciliation.
- Mark all Boosts API responses `Cache-Control: no-store`.

## Failure and Race Behavior

- Character deleted/transferred between GET and POST: ownership recheck fails; no command is sent.
- Character renamed between GET and POST: resolve and use the current database name; return the current name on success.
- Account session expires during form entry: POST returns `401`; no command is sent.
- Limits change while the page is open: server uses current limits and returns a validation/limit error; client refetches Boosts metadata.
- Two concurrent requests for the same UUID: at most one reaches SOAP.
- Two different UUIDs submitted concurrently: serialize the account's limit check/inserts through a transaction or account-scoped database lock so both cannot bypass daily limits.
- SOAP timeout after possible execution: reconcile mail; otherwise mark `unknown` and do not auto-retry.
- Portal restart after inserting `pending`: reconcile stale state before allowing a replay.
- Mailbox or core command rejects delivery: report unavailable/definitive failure according to proven compatible output; never report success from transport status alone.
- Feature flag disabled: GET reports `enabled: false`; POST fails closed without SOAP.

## Configuration and Deployment

Document placeholder values in `.env.example` for the four boost controls and the portal database settings from the authentication spec. Do not place character names, account IDs, live database names, credentials, or production limits in client build-time variables.

Deployment order:

1. Complete and verify portal authentication.
2. Confirm the compatible core's `send money` syntax, permission, output, offline behavior, and maximum safe amount with a dedicated test character.
3. Apply the additive portal-state migration and least-privilege grants.
4. Deploy the portal with `BOOST_MONEY_ENABLED=false`.
5. Run mocked tests and authorized end-to-end tests.
6. Confirm idempotency/reconciliation and inspect logs/browser responses.
7. Set owner-approved amount/frequency values and enable the feature.

Rollback is the feature kill switch followed by the prior portal build if needed. Existing request audit rows remain for reconciliation. Rolling back must not delete or reverse delivered mail.

## Out of Scope

- Boosts other than Free Money.
- Items, levels, skills, reputations, professions, mounts, spells, gear, teleports, race/faction changes, or character services.
- Direct character-money updates or raw mail-table writes.
- An administrator approval dashboard or automatic reversal of grants.
- Account sharing detection or determining who physically controls a character.
- Cross-realm character selection; version 1 assumes the one configured characters database/realm and requires a new contract before multiple realms.
- Currency denominations below whole gold.
- Public or invite-code-only access to Boosts without an authenticated game account.
- Changing `mod-player-statistics` events or schema. This feature does not require that module.

## Acceptance Criteria

- A signed-out visitor can see Boosts navigation but must log in before protected content or data is available.
- A signed-in player sees only non-deleted characters owned by their account in the top selector.
- Selecting a character and submitting an accepted whole-gold amount sends exactly one in-game money mail through AzerothCore.
- The command uses only a database-resolved canonical character name, fixed mail copy, a validated request UUID, and checked server-calculated copper.
- A player cannot target another account's character by modifying client data or replaying another account's request.
- Per-request, daily-gold, daily-request, burst-rate, origin, CSRF, and feature-flag rules are enforced server-side.
- Exact duplicate request replay never sends a second mail; payload conflicts are rejected.
- Ambiguous delivery is reconciled from mail when possible and otherwise remains `unknown` without automatic resend.
- SOAP/database failure never becomes a false success and does not break public portal pages.
- No portal database credential can write to AzerothCore auth/characters/world tables.
- UI loading, empty, disabled, success, failure, unknown, expired-session, and unavailable states are accessible and responsive.
- Direct `/boosts` refresh works through Express and unknown API/assets retain correct 404 behavior.
- `npm run build` and `npm test` pass without contacting the live game server or database.

## Automated Verification

Server tests cover:

- authenticated character list filtering and output-field stripping;
- empty list, deleted characters, unknown race/class, and database failure;
- request/body/UUID/character/gold validation;
- checked gold-to-copper conversion and configured bounds;
- session, origin, CSRF, ownership, feature-flag, daily-limit, and rate-limit failures before SOAP;
- safe command construction from canonical server data;
- success-marker parsing and known semantic command failures using compatible fixtures;
- first request, exact replay, conflicting replay, concurrent replay, and concurrent limit enforcement;
- timeout/ambiguous result with matching-mail and no-matching-mail reconciliation;
- stale `pending` recovery after simulated restart;
- public response/log redaction.

Frontend tests cover:

- protected-route/login return behavior;
- character loading, populated, empty, and unavailable states;
- shared selector behavior and cache clearing on account/logout change;
- digits-only amount validation and current limit copy;
- disabled/in-flight behavior and one UUID per activation;
- confirmed success, definitive error, limit error, unknown-delivery, and expired-session states;
- keyboard operation, labels, described errors, live-region announcements, and narrow layout.

All automated integrations use mocked database/SOAP boundaries. They must not deliver live mail or use a real account.

## Operator Verification

1. Inspect the migration and database grants before applying them.
2. Confirm `send money` permission and exact SOAP output on the deployed compatible core.
3. With the feature disabled, verify GET reports disabled and POST cannot call SOAP.
4. Log in with a dedicated ordinary account containing at least two test characters and confirm only those characters appear.
5. Send a small amount to an offline selected character and confirm exactly one mail with the correct amount/request ID.
6. Repeat with that character online and confirm the same behavior.
7. Replay the same HTTP request and confirm no second mail is created.
8. Simulate a response timeout after execution and confirm mail reconciliation prevents a resend.
9. Attempt another account's character ID, invalid amounts, changed UUID payloads, CSRF failures, and limit violations.
10. Test desktop/mobile layouts, logout/query clearing, direct refresh, session expiry, and dependency outages.
11. Inspect browser responses, production bundle, request table, and logs for prohibited data.
12. Enable the feature only after the owner approves final limits.

## Unresolved Decisions for Owner Review

1. Approve or replace the proposed maximum of 10,000 gold per request, 20,000 gold per account per UTC day, and five requests per account per UTC day.
2. Confirm that all owned characters, including player-controlled altbots on the account, should be eligible.
3. Confirm the mail subject/body tone and whether the visible request ID in the mail is acceptable.
4. Confirm a 90-day portal request/audit retention period.
5. Confirm that Boosts is visible in public navigation and redirects to Login, rather than hiding the link until login.

## Primary References

- AzerothCore GM command reference for `send money`: <https://www.azerothcore.org/wiki/gm-commands>
- AzerothCore `send money` implementation and RBAC command registration: <https://github.com/azerothcore/azerothcore-wotlk/blob/master/src/server/scripts/Commands/cs_send.cpp>
