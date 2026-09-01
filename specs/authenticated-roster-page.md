# Authenticated Account Roster Page

Status: Ready for owner review

Repository: `wow-portal`

Depends on: `specs/portal-account-authentication.md`, `specs/account-visibility-exclusions.md`, `specs/site-navigation.md`

## Decision Summary

Add an authenticated `/roster` page that groups every visible, non-deleted character by its non-bot game account. Each character shows name, level, class, race, and total time played. The `Roster` navigation link is rendered only after the portal has confirmed an authenticated session.

Account visibility is governed by `specs/account-visibility-exclusions.md`. Ordinary authenticated users receive the standard scope and cannot see configured hidden accounts. A configured exception viewer receives the full scope. The Roster does not define a second exclusion list or accept a browser visibility override.

The authoritative bot-account exclusion is the compatible Playerbots database table `playerbots_account_type`. Any account ID present in that table is excluded, regardless of whether its `account_type` is `0` (unassigned), `1` (RNDbot), or `2` (AddClass). The portal must not infer bot ownership from an account-name prefix, numeric account range, current online state, or statistics events.

Character playtime comes from `characters.totaltime`, which the deployed-compatible AzerothCore schema stores as an unsigned integer count of seconds. It is the last value persisted by the worldserver, not a live timer for an online character.

This feature requires one new schema-name setting and two narrow read grants. It requires no schema migration, portal-state table, AzerothCore write, statistics-module change, SOAP command, or worldserver change.

## Problem

The portal has a public live `Players Online` panel, but it has no browsable account roster. Friends cannot see which characters belong to each real-player account or compare basic character progress without logging into the game.

The Playerbots deployment contains many generated bot accounts. Reading all rows from the AzerothCore account and character tables without an authoritative exclusion would overwhelm the page with bots and could misclassify accounts if the portal guessed from names or account IDs.

## User Outcome

After logging in, a player sees `Roster` in the primary navigation. The page shows all roster-eligible accounts visible under that authenticated viewer's universal account-visibility scope, grouped by account. Every character displays:

- character name;
- level;
- class;
- race;
- total time played.

A signed-out visitor does not see `Roster` in primary navigation. Directly opening `/roster` sends the visitor to Login and safely returns them to `/roster` after successful authentication.

## Current Behavior

- The React client has public Home and Stats routes, a protected Boosts route, and a shared primary navigation.
- `AuthProvider` resolves the portal session and clears query data under the `protected` query-key prefix when the authenticated identity changes or logs out.
- `ProtectedRoute` currently supports only the `/boosts` return path, and the Login page allowlists only `/` and `/boosts` as safe return destinations.
- The primary navigation currently renders `Boosts` even while signed out. This is an intentional existing Boosts decision and is not changed by this feature.
- Express already serves the React entry document for direct `/boosts` requests and has reusable session middleware for protected JSON APIs.
- The portal database connection already reads selected authentication and character columns. Its current character grant does not include `characters.totaltime`, and its configuration does not name the Playerbots database.
- The public `GET /api/online-players` route reports current human-controlled sessions through the statistics module. It does not provide offline characters or durable bot-account classification and remains separate from this feature.

## Access Policy and Navigation

### Page access

- Canonical route: `/roster`.
- The page requires a valid portal session through the existing protected-route behavior.
- While session resolution is pending, show the existing `Checking your portal session...` protected-route state and do not render roster data.
- If session resolution itself fails, show the existing portal-session unavailable state.
- A signed-out direct visit redirects to `/login?returnTo=%2Froster`.
- Extend the protected-route return-path type and the Login page's exact allowlist to accept `/roster`. Do not accept arbitrary, absolute, protocol-relative, or user-supplied redirect targets.
- If the session expires while the roster is open, a `401` response clears protected query data, transitions the client to the signed-out state, and returns the user to Login with `/roster` as the safe return path.

### Navigation visibility

The primary links are:

- signed out, session loading, or session unavailable: `Home`, `Stats`, `Boosts`;
- authenticated: `Home`, `Stats`, `Roster`, `Boosts`.

Requirements:

- Render the `Roster` link only when `auth.session.authenticated` is true.
- Do not briefly render the link before session resolution completes.
- Remove the link immediately after successful logout or an expired-session transition.
- Use the existing router link component and render `aria-current="page"` on `Roster` when `/roster` is active.
- Do not change the accepted public visibility or login behavior of the existing `Boosts` link.

## Roster Eligibility

An account appears when all of the following are true:

1. It exists in the configured AzerothCore auth database.
2. Its numeric account ID has no matching row in the configured Playerbots database's `playerbots_account_type` table.
3. It owns at least one non-deleted character in the configured characters database.
4. The request's `AccountVisibilityScope` does not exclude its numeric account ID.

A character appears under that account when:

- `characters.account` equals the account's current ID; and
- `characters.deleteInfos_Name IS NULL`.

The account-to-character join already excludes AzerothCore soft-deleted characters whose active `account` ownership was cleared. The explicit deletion predicate is retained as a defense against malformed or version-drifted rows.

### Bot semantics

The compatible Playerbots revision populates `playerbots_account_type` for every generated random-bot account. Its type values describe current assignment, not whether the account belongs to the generated bot pool. Therefore:

- exclude every matching `account_id`, including `account_type = 0`;
- do not request or depend on the `account_type` column in the portal query;
- do not fall back to `AiPlayerbot.RandomBotAccountPrefix`, `LIKE 'rndbot%'`, account ranges, character names, online `IsBot()` state, or latest event flags;
- fail the roster request closed if the Playerbots schema, table, or permission is unavailable.

A character on a human account remains in the roster even if that character is sometimes controlled as a player-owned altbot. This feature classifies accounts, as requested; it does not attempt to classify every historical control mode of a character.

Accounts with no active characters are omitted. This avoids listing empty registration, SOAP, auction, or other service accounts that contribute no roster entries. GM accounts, banned accounts, and accounts with TOTP are not specially filtered if they otherwise meet the roster rules; the page does not read or expose those attributes.

The universal account-visibility exclusion is independent of bot classification. Full-scope viewers may bypass configured privacy exclusions, but they must never bypass the `playerbots_account_type` exclusion. A hidden account logged in under standard scope does not see itself in this cross-account roster unless it is also configured as an exception viewer by the universal policy.

## Data Source and Query Contract

Use the existing server-side portal MariaDB integration. All configured schemas are expected to reside on the same MariaDB/MySQL service as the current auth and character schemas.

The roster service reads only:

- auth `account.id` and `account.username`;
- characters `characters.guid`, `account`, `name`, `level`, `race`, `class`, `totaltime`, and `deleteInfos_Name`;
- Playerbots `playerbots_account_type.account_id`.

Use validated schema identifiers and parameterized values. Keep schema names out of browser responses. A representative query shape is:

```sql
SELECT
    a.id AS account_id,
    a.username AS account_login,
    c.guid AS character_guid,
    c.name AS character_name,
    c.level,
    c.race AS race_id,
    c.class AS class_id,
    c.totaltime AS total_played_seconds
FROM AUTH_DATABASE.account AS a
INNER JOIN CHARACTERS_DATABASE.characters AS c
    ON c.account = a.id
LEFT JOIN PLAYERBOTS_DATABASE.playerbots_account_type AS p
    ON p.account_id = a.id
WHERE p.account_id IS NULL
  AND c.deleteInfos_Name IS NULL
ORDER BY a.username, a.id, c.name, c.guid
LIMIT 2501;
```

The uppercase schema tokens above are documentation placeholders, not literal identifiers or string substitutions. Construct the final statement only from identifiers that pass the portal's existing database-identifier validation.

The service uses internal account IDs and character GUIDs only to group rows, detect duplicates, and provide deterministic tie-breakers. It removes both identifiers before constructing the HTTP response.

For standard visibility scope, the query builder also adds a bounded parameterized predicate equivalent to `AND a.id NOT IN (?, ...)` before ordering and limiting. For full scope, it omits only that predicate. Never interpolate configured IDs into SQL, filter after the safety limit, or infer scope from the signed-in username inside this service; consume the trusted middleware scope defined by `specs/account-visibility-exclusions.md`.

### Runtime validation and mappings

- Validate every database value before adding it to the response.
- Account login must be non-empty, free of control characters, and no longer than the compatible auth column.
- Character name must be non-empty, free of control characters, and no longer than the compatible character column.
- Level must be an integer from 1 through 255.
- Race and class IDs must be integers from 0 through 255.
- `total_played_seconds` must be an integer from `0` through `4294967295`, matching the unsigned schema column and remaining safely representable by JavaScript.
- Reuse the existing typed WotLK race and class mapping in `src/domain/wotlk.ts`.
- Preserve a row with an unknown numeric race or class using `Unknown race (<id>)` or `Unknown class (<id>)` and log only the unknown numeric value.
- Reject the complete result as unavailable if a required value is malformed, an account or character row is duplicated inconsistently, or grouping/count invariants fail. Do not silently omit corrupt rows.

### Bounds and ordering

The first version is intentionally an all-at-once friends-only roster, not a paginated directory. Bound the read to at most 250 accounts and 2,500 characters:

- fetch at most 2,501 character rows so overflow can be detected;
- group rows and fail with the normal `503` unavailable response if either bound is exceeded;
- never return a silently truncated roster;
- sort accounts case-insensitively by account login with internal account ID as a stable tie-breaker;
- sort characters within each account case-insensitively by character name with internal GUID as a stable tie-breaker.

Run `EXPLAIN` against the deployed schemas and database user before release. The expected plan uses primary-key lookups for auth and Playerbots accounts and the existing character-account index. A new index is not part of this feature; if the deployed plan requires one, stop and write a separate additive migration specification.

## HTTP API

Add:

```text
GET /api/roster
```

Authentication: required through the existing portal-session middleware. The route also consumes the shared account-visibility middleware after the authenticated principal is available. This read does not require a CSRF token or request `Origin`; it performs no mutation.

Successful response, HTTP `200`:

```json
{
  "generatedAt": "2026-08-28T16:00:00.000Z",
  "accountCount": 1,
  "characterCount": 2,
  "accounts": [
    {
      "accountLogin": "SHANE",
      "characters": [
        {
          "characterName": "Thalgrim",
          "level": 80,
          "class": "Paladin",
          "race": "Dwarf",
          "totalPlayedSeconds": 987654
        },
        {
          "characterName": "Eori",
          "level": 10,
          "class": "Rogue",
          "race": "Human",
          "totalPlayedSeconds": 4321
        }
      ]
    }
  ]
}
```

Contract requirements:

- `accountCount` equals `accounts.length`.
- `characterCount` equals the sum of all `characters.length` values.
- Every returned account contains at least one character.
- Both counts include only accounts and characters visible under the request's trusted scope.
- The arrays are returned in the deterministic order defined above.
- `generatedAt` is the server's ISO 8601 UTC time after the complete query result has been validated.
- A valid empty roster returns `200` with both counts set to `0` and an empty `accounts` array.
- Set `Cache-Control: no-store` on every `/api/roster` response, including errors.

Do not return:

- account ID, character GUID, bot-table state, or raw race/class IDs;
- email, salt, verifier, TOTP secret, security level, ban state, IP address, last login, or session metadata;
- character location, coordinates, money, inventory, equipment, guild, online status, deletion metadata, or raw database rows;
- schema names, SQL, database errors, internal hostnames, stack traces, or credentials.

Public failures:

- missing or expired session: HTTP `401` with `{ "error": "Log in to continue." }`;
- modest read limit exceeded: HTTP `429` with `{ "error": "Too many roster requests. Try again later." }`;
- missing Roster or visibility-policy configuration, unresolved policy account, missing grant/table, database timeout/failure, invalid row, or size-bound failure: HTTP `503` with `{ "error": "The roster is temporarily unavailable." }`.

An unavailable dependency must never be translated into an empty roster, and a missing Playerbots classification source must never cause bots to be shown.

## Backend Design

Add a focused roster service that owns:

- layered roster configuration;
- the cross-schema parameterized query;
- application of the trusted universal account-visibility scope before bounds and grouping;
- runtime validation;
- authoritative bot exclusion;
- WotLK race/class mapping;
- grouping, counts, ordering, and response-field stripping.

Keep the Express route thin: set no-store headers, require a session, resolve the shared account-visibility scope, apply the read limiter, call the service with that scope, and translate failures to the fixed public response.

The new Playerbots schema setting must be read at the roster service boundary. Missing roster-only configuration must make `/api/roster` unavailable without breaking login, Boosts, Home, Stats, registration, status, the public online roster, or `/health`.

The browser makes one request when the authenticated page is entered. Do not poll automatically in version 1. Use TanStack Query with:

- the universal account-bearing prefix, such as `['account-visible', 'roster']`;
- no automatic retries;
- no persistent browser storage;
- no refetch-on-window-focus;
- a short stale interval, proposed as 60 seconds, so immediate remounts do not hammer the database.

Apply a bounded in-memory read limiter that comfortably permits normal navigation and manual reloads; a proposed starting policy is 30 requests per effective client IP per five minutes. This endpoint needs no server-side roster cache initially. Revisit caching or account-cursor pagination only if measured use or `EXPLAIN` results justify it.

Login, logout, account change, and session-expiry behavior must clear this query through the universal account-visible cache policy. If a server-side Roster cache is added later, its key must include `standard` versus `full` visibility scope.

## User Interface

### Page structure

- Set the document title to `Roster | DaBoysZeroth`.
- Render one page-level heading, `Roster`.
- Briefly describe the page as the characters belonging to real-player accounts.
- Show a summary such as `3 accounts · 12 characters` after a successful load.
- Render one account section/card per account, headed by its canonical account login.
- Inside each account section, render a semantic character table with columns in this order: `Character`, `Level`, `Class`, `Race`, `Time played`.

Account login is intentionally displayed because the requested roster is grouped by account and the page is authenticated. It remains a credential identifier, so it must not be linked to Login, copied into hidden attributes, or combined with additional account metadata.

### Time-played formatting

The API returns exact integer seconds. The client formats the value as a compact duration:

- under one minute: seconds, for example `42s`;
- one minute or more: the largest relevant day, hour, and minute units, for example `18m`, `3h 12m`, or `12d 3h 4m`;
- omit zero-value units except that an exact zero is `0s`;
- do not round up or treat the value as a wall-clock date.

Provide an accessible full-duration label such as `12 days, 3 hours, 4 minutes` when the compact abbreviations would otherwise be unclear to a screen reader.

### Page states

- Loading: `Loading roster...`
- Empty success: `No player characters are on the roster yet.`
- Unavailable: `The roster is temporarily unavailable.`
- Expired session: clear roster data and follow the protected Login return flow; do not leave the previous roster visible behind an error.

### Responsive and accessible behavior

- Use semantic headings, sections, tables, column headers, and status/live-region behavior.
- Associate each character table with its account heading.
- On narrow screens, transform rows into stacked character cards with visible field labels and no horizontal page scrolling.
- Preserve keyboard navigation and the existing visible focus treatment.
- Render all database-derived strings as React text, never injected HTML.
- Do not rely on color alone to distinguish account headings, labels, loading, or error states.

## Configuration and Database Grants

Add this placeholder-only setting to `.env.example` and Compose pass-through during implementation:

```text
PORTAL_PLAYERBOTS_DATABASE=playerbots_database
```

Do not commit the deployed schema name or credentials. The setting uses the same strict identifier validation as the existing portal schema settings.

The configurable hidden-account and exception-viewer lists are owned exclusively by `specs/account-visibility-exclusions.md`. Add no `ROSTER_*` privacy-list variables. The Roster consumes that shared resolved policy and requires no additional policy database grants.

The existing portal application database user requires only these additions:

```sql
GRANT SELECT (totaltime)
ON `CHARACTERS_DATABASE`.`characters`
TO 'PORTAL_APPLICATION_USER'@'%';

GRANT SELECT (account_id)
ON `PLAYERBOTS_DATABASE`.`playerbots_account_type`
TO 'PORTAL_APPLICATION_USER'@'%';
```

The identifiers and principal above are placeholders. The operator must substitute the deployed values without committing them. Preserve the user's existing column-level auth and character reads; do not replace narrow grants with table-wide or schema-wide access.

No migration is required. Do not grant or perform `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, or `DROP` on AzerothCore auth, characters, world, Playerbots, statistics, or portal-state schemas for this feature.

## Privacy, Security, and Logging

- Authentication gates both the page and JSON API; hiding the nav link alone is not authorization.
- The response is a cross-account roster whose rows vary only between the trusted standard and full visibility scopes. Authentication proves portal membership; the shared policy determines whether configured hidden accounts may be disclosed.
- Account logins and playtime are private portal data. Keep responses out of shared/browser caches and clear protected query data on logout or account change.
- Never log the complete roster, account logins, character names, session cookies, or response bodies during normal operation.
- Operational errors may log a coarse failure category, query duration, and bounded row counts, but not SQL values, credentials, or raw database errors sent to the browser.
- Reuse the existing database pool limits and timeouts. Do not connect the browser to MariaDB or expose a database port.
- Keep the public online panel's current access contract unchanged. This feature does not make the full roster public and does not use SOAP.

## Failure and Edge-Case Behavior

- No human accounts or no active characters: return the empty success response.
- Account with several characters: return one account group containing every active character.
- Configured hidden account under standard scope: omit the account and all its characters before counts, grouping, ordering, and bounds.
- Configured hidden account under full scope: include it if it satisfies all normal non-bot and active-character rules.
- Hidden account viewing under standard scope: omit itself as well as every other configured hidden account.
- Soft-deleted character: omit it.
- Account present in `playerbots_account_type` with type `0`, `1`, or `2`: omit the account and all its characters.
- Human-owned character currently or historically controlled as an altbot: include it because its account is not a generated bot-pool account.
- Unknown numeric race/class: retain the character with the documented fallback label.
- Invalid or duplicate database row: fail the whole response with `503`.
- Missing Playerbots schema setting, table, or column grant: fail only the Roster API with `503`; never fall back to an unfiltered query.
- Missing/invalid universal visibility configuration or unresolved configured account: fail Roster with `503`; never fall back to full scope.
- Database outage or timeout: fail with `503` and do not show a stale or false-empty roster.
- More than 250 eligible accounts or 2,500 eligible characters: fail with `503` and an operational size-bound log; never truncate silently.
- Character changes while a read is running: normal database read consistency applies. The next successful page request reflects the next persisted state.
- Online character's displayed playtime: may lag the game client's `/played` value until the worldserver next persists the character.
- Logout or authenticated-account change: remove all protected roster query data before another identity can render it.

## Out of Scope

- Public or invite-code-only roster access.
- Changes to the existing public online-player panel beyond the shared behavior required by `specs/account-visibility-exclusions.md`.
- Character profiles, armory links, equipment, professions, talents, achievements, quests, reputations, mounts, pets, inventories, money, locations, guilds, factions, or online indicators.
- Editing, deleting, renaming, transferring, logging in as, or otherwise managing accounts or characters.
- User-managed privacy controls, friends lists, or a Roster-specific role/visibility system. Operator-configured universal account visibility is owned by its prerequisite specification.
- Detecting player-owned altbot control at a point in time.
- Account aliases or separate public display names.
- Reading event statistics or changing `mod-player-statistics`.
- A new portal database table, database migration, worldserver module, or SOAP command.
- Multi-realm aggregation. Version 1 uses the one configured characters database/realm.
- Automatic polling, WebSockets, exports, search, filters, sorting controls, or pagination.

## Acceptance Criteria

- `Roster` is absent from primary navigation while signed out, loading the session, or unable to resolve the session.
- `Roster` appears in the documented navigation order only after authentication and has the current-page state on `/roster`.
- Direct signed-out access to `/roster` returns safely through Login after successful authentication.
- Both `/roster` and `GET /api/roster` require a valid portal session.
- Every eligible account visible under the request's trusted scope appears once, with all active characters grouped beneath it.
- Character name, level, class, race, and correctly formatted total persisted playtime are displayed.
- Every account represented in `playerbots_account_type`, including type `0`, is absent with all its characters.
- Every universally hidden account is absent with all its characters for standard scope and visible normally to a configured full-scope viewer.
- Full scope never bypasses generated-Playerbots exclusion, population rules, or active-character rules.
- The implementation does not classify bots by names, prefixes, account ranges, online state, or event history.
- Deleted characters and empty accounts are absent.
- The API exposes none of the prohibited identifiers or account/character metadata.
- Missing classification data or a database failure returns unavailable rather than bots, partial data, stale data, or a false empty result.
- Logout, session expiry, and account changes clear account-visible Roster data and remove the nav link.
- Desktop and narrow-screen layouts are readable, keyboard accessible, and free of horizontal page scrolling.
- Direct `/roster` refresh serves the React application, while unknown API and asset paths retain normal `404` behavior.
- Existing Home, Stats, Boosts, Login, registration, status, public online roster, and `/health` behavior remain intact except for the deliberate shared exclusions defined by the prerequisite policy.
- `npm run build` and `npm test` pass without contacting a live database or game server.

## Automated Verification

Server service tests cover:

- empty and populated query results;
- grouping multiple characters under one account and multiple accounts in deterministic order;
- exclusion by any `playerbots_account_type` row, explicitly including type `0` fixture semantics;
- standard/full visibility predicates, including a hidden viewer not seeing itself and full scope still excluding generated bot accounts;
- omission of deleted characters and accounts with no active characters;
- exact `totaltime` bounds, including zero and `4294967295`;
- race/class mappings and unknown numeric fallbacks;
- malformed values, duplicate/inconsistent rows, account overflow, and character overflow;
- stripping internal account IDs, GUIDs, raw IDs, and deletion/classification fields;
- database/configuration/classification failure without an unfiltered fallback;
- universal policy failure without a full-scope fallback.

Express route tests cover:

- authenticated `200` populated and empty responses;
- standard and full middleware scopes passed unchanged to the service;
- unauthenticated and expired-session `401` responses;
- `429` read limiting;
- fixed `503` dependency failure;
- `Cache-Control: no-store` on success and failure;
- no effect on unrelated routes when roster-only configuration is missing.

Frontend tests cover:

- nav-link absence for loading, failed, and anonymous session states;
- nav-link presence, order, activation, and removal for authenticated/login/logout/session-expiry flows;
- safe `/roster` Login return handling and rejection of arbitrary return targets;
- loading, empty, populated, unavailable, and expired-session states;
- account grouping, character fields, order, counts, and duration formatting;
- response runtime validation and protected-query clearing between identities;
- universal account-visible query clearing/refetch after login, logout, account change, and session expiry;
- text-safe rendering of hostile account/character strings;
- semantic table/card behavior, keyboard focus, document title, and narrow layout.

All automated database and session dependencies use injected fakes or fixtures. Tests must not read live accounts, expose credentials, or modify AzerothCore data.

## Operator Verification

1. Complete and deploy `specs/account-visibility-exclusions.md` with its requested live policy.
2. Configure the real `PORTAL_PLAYERBOTS_DATABASE` value without committing it.
3. Add only the documented `totaltime` and `playerbots_account_type.account_id` grants to the existing portal database user.
4. As an operator, confirm the compatible Playerbots revision maintains one classification row for every generated bot-pool account. Confirm that unassigned type `0` rows exist in the exclusion set when applicable.
5. Run both standard- and full-scope roster queries and `EXPLAIN` with the portal application user. Confirm it cannot select ungranted Playerbots, auth, or character columns.
6. Log in with an ordinary non-privileged portal account and verify the Roster nav link, direct-route return flow, and omission of every universally hidden account.
7. Log in as the configured exception viewer and verify the hidden accounts appear with their eligible characters.
8. Log in as a hidden account that is not an exception viewer and verify it does not see itself or the other hidden accounts.
9. Compare at least two known visible human accounts and all their active characters with the authoritative auth/characters data.
10. Check a known generated bot account from each available type, including type `0`, and confirm none appears even for the exception viewer. Do not rely on its username during the portal test.
11. Compare one saved/offline character's displayed time with the character's in-game `/played` total, allowing for persistence timing when testing an online character.
12. Remove or deny the Playerbots table grant in a controlled test and confirm Roster alone becomes unavailable rather than showing an unfiltered list; restore the grant afterward.
13. Test logout from the exception viewer, session expiry, Back/Forward, a direct `/roster` refresh, desktop width, and narrow mobile width. Confirm protected rows disappear after the visibility cache is cleared/refetched.
14. Inspect browser responses, the built client, and normal logs to confirm no prohibited IDs, fields, schema details, policy values, credentials, or complete roster logs are exposed.

## Owner Review Decisions

The specification proposes these behaviors for approval:

1. Display canonical game-account logins as account headings to authenticated friends. A future alias/display-name feature would reduce credential-identifier exposure but does not exist today.
2. Include every character on a human account, including player-owned altbots, because the requested rule is non-bot accounts rather than current human control.
3. Omit accounts with no active characters, including empty and characterless service accounts.
4. Include otherwise eligible GM, banned, and TOTP-enabled accounts without showing those attributes.
5. Use the proposed all-at-once safety bounds of 250 accounts and 2,500 characters, failing rather than truncating if either is exceeded.
