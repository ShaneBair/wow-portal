# Universal Account Visibility Exclusions

Status: Implemented locally; deployment configuration and live verification pending

Priority: Implement before the authenticated Roster page

Repository: `wow-portal`

Depends on: `specs/portal-account-authentication.md`

Affects: `specs/online-players.md`, `specs/character-deaths-leaderboard.md`, `specs/comprehensive-player-deaths.md`, `specs/completionist-quest-leaderboard.md`, `specs/server-mvp-boss-kills.md`, `specs/authenticated-roster-page.md`

## Decision Summary

Add one server-owned account-visibility policy used by every portal feature that lists or ranks accounts or characters. Operators configure:

- accounts hidden from ordinary viewers; and
- authenticated accounts allowed to see the otherwise hidden accounts.

Anonymous visitors, invalid or expired sessions, and authenticated accounts outside the exception-viewer list receive the filtered view. An authenticated exception viewer receives the full view. The browser cannot request, assert, or override a visibility scope.

The policy is universal, but it is not a generic JSON response scrubber. Shared middleware resolves a trusted visibility scope once for a request, and each account-bearing service applies that scope before ranking, limiting, counting, grouping, caching, and response projection. This preserves correct leaderboards and prevents hidden rows from leaking through caches.

The owner-requested first deployment policy is:

- hidden accounts: `DMGMACHINE`, `DJGRAHAM`;
- exception viewers: `GMSHANE`.

Those live values belong in the ignored deployment `.env`, not `.env.example`, client code, tests, or frontend build variables. Source-controlled examples use placeholders.

This is a visibility rule only. It does not ban an account, prevent login, change game permissions, stop event collection, or prevent a hidden account from using its own authenticated tools such as Boosts.

## Problem

Account identities currently appear through several independent portal features:

- the public current-online roster;
- the Most Deaths leaderboard;
- Completionist quest completions;
- Server MVP boss kills;
- the proposed authenticated account Roster;
- future account- or character-bearing statistics such as Explorer.

Filtering only in React would still expose hidden rows through JSON. Filtering a completed top-25 response would produce fewer results instead of promoting the next eligible entries. Adding one-off checks to each route would also create inconsistent session behavior and cache leaks.

The portal needs one policy contract that every current and future account-bearing data source must consume.

## User Outcome

For an anonymous visitor or ordinary authenticated account:

- configured hidden accounts and all of their characters are absent from every covered list, leaderboard, count, and grouped roster;
- the response gives no indication that entries were removed; and
- rankings close around the hidden entries, so the next eligible records fill bounded boards.

For an authenticated account configured as an exception viewer:

- the same pages and APIs include hidden accounts normally; and
- no special button, query parameter, or visible mode switch is required.

For the requested initial policy, only a valid portal session for the configured GM account sees the two configured hidden accounts. The hidden accounts do not see themselves merely because they are logged in unless they are also added to the exception-viewer list.

## Terminology

- **Hidden account**: an AzerothCore game account configured to be removed from account-bearing portal results for the standard scope.
- **Exception viewer**: an authenticated AzerothCore account configured to receive the full scope.
- **Standard scope**: filtered view used by anonymous, expired, invalid, unavailable-auth, and ordinary authenticated requests.
- **Full scope**: unfiltered-by-this-policy view granted only when the trusted authenticated principal's account ID matches a resolved exception viewer.
- **Covered endpoint**: an API returning account or character identity, activity, ranking, membership, or a count derived from those records.

“Full” means only that this exclusion policy is bypassed. Existing bot, population, ownership, deletion, authentication, and feature-specific filters still apply.

## Configuration Contract

Add two server-only environment settings:

```text
PORTAL_HIDDEN_ACCOUNTS=ACCOUNT_TO_HIDE,SECOND_ACCOUNT_TO_HIDE
PORTAL_HIDDEN_ACCOUNT_VIEWERS=ACCOUNT_ALLOWED_TO_VIEW_HIDDEN
```

For the first deployment, the operator sets the ignored live `.env` to the owner-requested account names. `.env.example` must retain only neutral placeholders, for example:

```text
PORTAL_HIDDEN_ACCOUNTS=ACCOUNT_TO_HIDE
PORTAL_HIDDEN_ACCOUNT_VIEWERS=ACCOUNT_ALLOWED_TO_VIEW_HIDDEN
```

### Parsing and validation

- Both settings must be present. An explicit empty value means an empty list.
- Split non-empty values on commas, trim surrounding ASCII whitespace, and uppercase using the portal's canonical ASCII account-name normalization.
- Every item must match the existing portal login contract: 3–16 ASCII letters, digits, or underscores after normalization.
- Reject empty items inside a non-empty list, control characters, unsupported characters, and more than 100 entries per list.
- Bound each raw setting to 2,048 bytes before splitting.
- Deduplicate normalized entries without changing behavior.
- An empty hidden list disables filtering while retaining the same middleware contract.
- An empty exception-viewer list means nobody receives the full scope.
- A login may appear in both lists. Its authenticated account receives full scope and can therefore see itself and all other hidden accounts.
- Do not accept wildcards, prefixes, regular expressions, account ranges, character names, numeric IDs, JSON, or negation syntax.

Missing or invalid configuration fails closed for covered endpoints. It must not silently behave as an empty hidden list. Unrelated endpoints remain available.

Configuration is read once per process. A change requires rebuilding/restarting the portal container, which also invalidates the current in-memory portal sessions.

## Stable Account Resolution

Configuration is friendly account login text, but enforcement uses numeric AzerothCore account IDs.

On first covered request, or during explicit service initialization:

1. Read and validate both configured login lists.
2. Query the configured auth database through the existing portal database connection for exact canonical `account.username` matches.
3. Resolve every configured hidden and exception-viewer login to exactly one `account.id`.
4. Store immutable in-process sets of hidden account IDs and exception-viewer account IDs.

Requirements:

- Use a parameterized query and the existing column-level reads for `account.id` and `account.username`.
- If any configured login is absent, duplicated unexpectedly, or maps to an invalid ID, policy initialization fails and all covered endpoints return their normal unavailable response.
- Do not partially apply a policy when only some configured accounts resolve.
- Do not log the configured logins, resolved IDs, or database rows.
- Coalesce concurrent initialization so one process performs at most one resolution query.
- Cache a successful immutable policy for the process lifetime.
- Cache a failure only for a short bounded backoff, proposed as three seconds, so a temporary database outage does not create a tight loop and can recover without a restart.

Resolving to IDs prevents case/collation differences and keeps a hidden account hidden if its login is renamed while the portal process remains running. After a later restart, a stale configured name fails closed until the operator updates it; it never silently exposes the renamed account.

No new database grant or schema migration is required because portal authentication already reads `account.id` and `account.username`.

### Identity namespace contract

Version 1 assumes one AzerothCore auth identity namespace:

- `PORTAL_AUTH_DATABASE` and `STATS_AUTH_DATABASE` refer to the same authoritative account records;
- `characters.account` values refer to IDs from that auth database;
- the `playerstats online` provider's `accountId` values come from that same auth database; and
- the future Roster uses the same configured auth/characters pair.

Validate this deployment contract before enabling the policy. If configured database identities demonstrably disagree, fail affected endpoints unavailable rather than applying one account's exclusion ID to another identity namespace. Multi-realm or independently numbered auth databases require a new scoped identity contract and are out of scope.

## Shared Middleware Contract

Add one reusable account-visibility middleware and one shared scope type. A representative internal type is:

```ts
type AccountVisibilityScope = {
  cacheKey: "standard" | "full";
  excludedAccountIds: readonly number[];
};
```

The exact names may change during implementation, but these invariants may not:

- `standard` contains the complete configured hidden-account ID set;
- `full` contains no exclusions from this policy;
- arrays/sets are immutable to consumers;
- the scope and configured identities are never serialized to the browser.

### Optional session resolution

The middleware reuses the existing cookie parsing and portal session store through a factored optional-session resolver:

- valid session: use the trusted principal's numeric account ID;
- no cookie, invalid cookie, or expired session: clear an invalid cookie when appropriate and use standard scope;
- auth HTTP configuration unavailable: use standard scope rather than making a public endpoint fail open;
- principal account ID in the resolved exception-viewer ID set: use full scope;
- every other principal: use standard scope.

Do not determine exception status from a request header, query parameter, JSON body, displayed username, client state, source IP, AzerothCore GM/security column, or account-name substring. Being named in this configuration grants only full visibility under this policy; it does not grant portal or game administrative powers.

### Mounting model

Use the shared middleware on every covered route. It may be mounted through a common account-bearing router or explicitly in each covered router, but automated coverage tests must make omissions visible.

Do not make database-backed policy initialization a global prerequisite for `/health`, authentication, registration, server status, Boosts, static assets, or other responses that contain no cross-account listing. The universal aspect is one policy and scope contract across all account-bearing features, not a global response interceptor.

## Initial Covered Endpoints

Implementation is incomplete until every currently applicable endpoint is integrated in the same release:

| Endpoint | Current source | Required filtering point |
| --- | --- | --- |
| `GET /api/online-players` | `playerstats online` SOAP payload | After complete provider validation, before public mapping, sorting, count, and field stripping |
| `GET /api/stats/deaths` | statistics/auth/characters SQL | In SQL before leaderboard ordering and `LIMIT 25` |
| `GET /api/stats/quest-completions` | statistics/auth/characters SQL | In SQL before leaderboard ordering and `LIMIT 25` |
| `GET /api/stats/boss-kills` | statistics/auth/characters/world SQL | In SQL before leaderboard ordering and `LIMIT 25` |
| `GET /api/roster` | proposed auth/characters/Playerbots SQL | In SQL before account grouping, ordering, counts, and safety limits |

The Roster endpoint is a required future consumer but does not block deploying this policy against the four already implemented APIs. Its specification must depend on this one and must not introduce a second visibility configuration.

Future account-bearing endpoints—Explorer, additional leaderboards, guild rosters, character search, profiles, or similar—must accept the shared scope before implementation is considered complete.

## Service Integration Rules

### Database leaderboards

Each leaderboard query builder accepts `AccountVisibilityScope` or the scope's immutable excluded account IDs.

For standard scope:

- add a parameterized account-ID exclusion against the non-null `characters.account` ownership column, not nullable display-account join fields;
- apply it inside the leaderboard candidate query before `ORDER BY` and `LIMIT`;
- keep event-contract integrity and coverage calculations unchanged unless they expose account-specific rows;
- recalculate response `count` from the eligible top rows.

Using `characters.account NOT IN (?, ...)` preserves the existing behavior for any row whose display-account join is missing while still excluding every current character owned by a configured hidden account. Do not apply `NOT IN` to nullable `account.username`/`account.id` values, where SQL three-valued logic could unintentionally remove unrelated unknown-account rows.

For full scope, omit only this policy's exclusion predicate. Preserve population filters, bot semantics, deleted-character rules, boss classification, cutover integrity, and all other query behavior.

Never interpolate numeric arrays into SQL strings. Generate a bounded placeholder list and pass resolved IDs as values. An empty exclusion list emits no `NOT IN` predicate. Query-builder result types must allow the additional parameterized values without weakening runtime validation.

Filtering after `LIMIT 25` is prohibited because it would create shortened and misleading boards. Filtering after mapping is allowed only as a defense-in-depth assertion, not as the primary database policy.

### Current-online provider

The validated provider record already contains both `accountId` and `accountLogin`. Refactor the current-online service so its internal validated snapshot retains `accountId` until visibility filtering is complete.

- Cache/coalesce the validated internal provider snapshot, not a scope-specific public response.
- For standard scope, remove provider players whose `accountId` is in the hidden set.
- For full scope, retain them.
- Then map friendly race/class labels, sort, strip account IDs/GUIDs/map IDs, and calculate `count`.
- Never filter by `accountLogin` when the provider's authoritative numeric ID is available.

If the provider ever removes `accountId`, treat that as an unsupported contract and return unavailable. Do not fall back to display-name matching.

### Authenticated Roster

The roster service accepts both the authenticated principal and the shared visibility scope. Its normal bot-account exclusion and active-character rules remain independent.

- Standard scope adds a parameterized `a.id NOT IN (...)` predicate before grouping and bounds.
- Full scope omits that predicate but continues excluding generated Playerbots accounts.
- A hidden account logged in under standard scope does not see itself in the cross-account roster.
- Counts reflect only the viewer's visible accounts and characters.

## Cache Isolation

Every server-side cache and in-flight request map for covered results must include visibility scope in its key.

Examples:

- leaderboards: `(population, visibility.cacheKey)`;
- current-online public projection: derive per request from one cached internal snapshot, or cache by `visibility.cacheKey`;
- future roster cache: key by `visibility.cacheKey` if one is added.

Requirements:

- Never return a `full` cached value to a `standard` request.
- Never let a standard in-flight request satisfy a full request or vice versa when the query result itself is scope-specific.
- Successful cache TTLs, failure behavior, and single-flight behavior otherwise remain as currently specified.
- Do not serve stale privileged results after a policy/configuration failure.
- Continue setting `Cache-Control: no-store` on browser responses. Add `Vary: Cookie` to covered public endpoints as defense in depth, even though no-store is the primary rule.

## Browser Cache and Session Transitions

The browser sends same-origin session cookies on covered requests; it does not send a visibility flag.

Covered fetch functions should set `credentials: "same-origin"` explicitly so exception-viewer behavior does not depend on an implicit browser default.

Place all covered TanStack Query keys under a shared prefix such as:

```ts
["account-visible", ...]
```

On successful login, logout, authenticated-account change, or discovery of session expiry:

- cancel and remove every query under the account-visible prefix;
- let currently mounted panels refetch under the new server-resolved scope;
- never leave full-scope rows visible from React memory after logout.

The existing protected query clearing remains for owner-specific tools such as Boosts. Account-visible clearing is additional because online players and Stats remain publicly reachable.

The auth provider must discover passive session expiry within a bounded interval and on window focus, proposed as at most 60 seconds, then clear account-visible queries if the identity transitions to anonymous. A direct explicit logout clears them immediately.

Do not expose whether the signed-in account is an exception viewer in session JSON, HTML, query keys, local storage, or UI labels.

## API Behavior

Covered endpoint paths and successful public response shapes do not change. Only which entries and derived counts are present may differ by trusted session.

- Anonymous and standard-scope requests remain successful when their underlying source is available.
- Full-scope requests use the same status codes and schema.
- There is no `includeHidden`, `showAll`, viewer, account, or role parameter.
- Unknown attempts to override visibility through query strings or headers have no effect and should be covered by tests.
- Policy configuration/resolution failure returns each endpoint's existing fixed `503` unavailable response rather than partial or unfiltered data.
- Invalid/expired optional sessions fall back to standard scope; they do not make public endpoints return `401`.
- Endpoints that independently require authentication, such as the future Roster, still return their existing `401` when no valid session exists.

Standard responses must not reveal the existence, number, names, IDs, ranks, omitted positions, or aggregate contribution of hidden accounts. Do not add `filteredCount`, `hiddenCount`, `visibilityScope`, or similar metadata.

## Privacy, Security, and Logging

- Enforce filtering on the server before constructing the browser response.
- Treat configured logins and resolved IDs as sensitive credential identifiers.
- Never log configuration contents, hidden matches, exception-viewer matches, numeric IDs, or the viewer's scope during normal requests.
- Operational logs may state only that policy configuration, resolution, or application failed, plus a coarse error class and correlation ID.
- Do not return raw database/SOAP errors, config values, internal IDs, stack traces, or policy details.
- Do not persist policy values in browser storage or a portal-state table.
- Use constant-time comparison only where secrets are involved; account IDs are not secret comparison material. Exact set membership is sufficient.
- Preserve all existing authentication, CSRF, origin, ownership, rate-limit, database, SOAP, and private-network boundaries.

## Failure and Edge-Case Behavior

- Both configured lists empty: covered endpoints behave as before, but still pass through the shared scope contract.
- Hidden list populated and viewer list empty: hidden accounts are absent for everyone.
- Anonymous visitor: standard scope.
- Ordinary authenticated account: standard scope.
- Hidden account authenticated: standard scope unless separately listed as an exception viewer; it does not see itself.
- Exception viewer authenticated: full scope.
- Account in both lists: full scope while that account has a valid session.
- Invalid/expired cookie on a public endpoint: clear when appropriate and return standard-scope data.
- Auth/session configuration unavailable: standard scope; exception access fails closed.
- Visibility configuration missing or malformed: all covered endpoints return their fixed unavailable response.
- Any configured account fails ID resolution: all covered endpoints return unavailable; no partial policy.
- Hidden account renamed after successful initialization: remains hidden by stable ID until restart.
- Configured name stale at next restart: resolution fails closed until corrected.
- Hidden character ranks within a top 25: omit it before limiting and promote the next eligible row.
- Hidden account has several online characters or roster characters: remove all of them and recalculate counts.
- Hidden account has Player and Bot event rows: remove every row joined to that account; population controls do not bypass visibility.
- Exception viewer selects Bots Only/All where supported: full scope bypasses only configured hidden accounts, not bot classification.
- Policy database temporarily unavailable during initialization: return unavailable with bounded retry backoff.
- Policy already initialized and auth database later fails: continue using the immutable resolved policy; underlying feature dependencies retain their own failure rules.

## Explicit Non-Goals

- Banning, suspending, deleting, anonymizing, renaming, or changing credentials for hidden accounts.
- Preventing hidden accounts from logging in to the portal or game.
- Blocking hidden accounts from their own Boosts character selector or boost delivery.
- Hiding events from database storage or changing `mod-player-statistics` collection.
- Altering AzerothCore GM/security levels, RBAC, account access, bans, or TOTP.
- Letting users maintain their own privacy lists or discover who can view them.
- Per-character exclusions in version 1.
- Wildcard, prefix, regex, guild, faction, IP, or role-based rules.
- A client-side visibility toggle or administrator UI.
- A schema migration or portal-owned policy table.
- Filtering server status, aggregate uptime, or other data with no account/character identity or contribution.

## Implementation Order

This feature is intended for the next deployment and should be completed as one coherent server/client change:

1. Add strict configuration parsing and stable account-ID resolution.
2. Factor optional portal-session resolution and implement the shared visibility middleware/scope.
3. Refactor current-online parsing/cache so filtering occurs while provider account IDs are retained.
4. Add pre-limit account-ID predicates and scope-aware cache keys to Deaths, Completionist, and Server MVP.
5. Put all covered frontend queries under the account-visible cache prefix and clear them on identity transitions.
6. Add configuration placeholders, Compose pass-through, README deployment instructions, and focused tests.
7. Configure the requested live lists only in the ignored `.env`.
8. Rebuild and verify anonymous, ordinary authenticated, hidden-account, and exception-viewer results before public use.
9. Implement the Roster against this policy; do not create a Roster-specific visibility list.

Do not deploy a partial version in which only some current boards are filtered.

## Acceptance Criteria

- One validated configuration and one shared middleware/scope govern all covered endpoints.
- The requested two accounts are absent from current online, Deaths, Completionist, Server MVP, and the future Roster for anonymous and ordinary authenticated viewers.
- A valid session for the requested exception viewer sees those accounts normally in every covered endpoint.
- Hidden accounts do not see themselves unless also configured as exception viewers.
- Filtering happens before ranking, `LIMIT`, counts, grouping, sorting, and public field stripping.
- The next eligible rows fill leaderboards after hidden rows are removed.
- The online provider is filtered by its validated numeric `accountId`, not login text.
- Database features use bounded parameterized account-ID predicates.
- Existing bot/population/deletion/ownership rules remain effective in full scope.
- No browser input can acquire full scope.
- Full-scope server or React cache entries never reach a standard request or survive logout/account change.
- Missing/invalid configuration and unresolved configured accounts fail covered endpoints closed with their existing unavailable response.
- Non-covered APIs and static pages remain available when policy initialization fails.
- Responses and logs reveal no exclusion list, viewer list, resolved IDs, hidden counts, or visibility scope.
- No schema migration, AzerothCore write, statistics event change, or new database grant is required.
- `npm run build` and `npm test` pass without contacting the live database, SOAP endpoint, or game server.

## Automated Verification

### Configuration and policy service

- required-present versus explicit-empty settings;
- trimming, uppercase normalization, deduplication, size/count limits, and invalid-token rejection;
- empty, populated, and overlapping lists;
- exact parameterized resolution to account IDs;
- missing/duplicate/invalid resolutions failing the entire policy;
- initialization single-flight, immutable success caching, and bounded failure backoff;
- no sensitive values in thrown public errors or captured logs.

### Middleware

- anonymous, ordinary, hidden, overlapping, and exception-viewer principals;
- valid, absent, malformed, expired, and auth-configuration-unavailable cookies;
- standard fallback and invalid-cookie clearing;
- browser headers/query/body values unable to change scope;
- unrelated routes not requiring policy initialization.

### Current online

- hidden provider account IDs removed before mapping/counting;
- all characters on one hidden account removed;
- exception viewer receives the full validated snapshot;
- account IDs and other provider-only fields still stripped;
- internal snapshot cache safely serving both scope projections;
- provider contract without account ID failing unavailable.

### Database leaderboards

- standard queries include the correct bounded placeholders/values before ordering and limit;
- full queries omit only the visibility predicate;
- a hidden top entry promotes the twenty-sixth eligible entry;
- Player, All, and applicable Bot behavior retains existing semantics;
- cache and in-flight keys include both population and visibility scope;
- coverage/integrity metadata remains correct without exposing hidden identities.

### Routes and browser cache

- every covered route invokes the shared middleware and passes scope to its service;
- each existing route-specific `503` is preserved on policy failure;
- public endpoints use standard scope rather than `401` for invalid optional sessions;
- `Cache-Control: no-store` and `Vary: Cookie` are present;
- login/logout/account-change/passive-expiry transitions remove and refetch all account-visible queries;
- privileged rows cannot remain rendered after logout.

Use injected config, session stores, clocks, query functions, and SOAP fixtures. Automated tests must not read or mutate live accounts.

## Operator Verification

1. Confirm the two hidden accounts and the exception-viewer account exist with the exact intended canonical logins.
2. Put the requested lists in the ignored live `.env`; keep real account names out of `.env.example`.
3. Build and run the complete automated suite before deployment.
4. Rebuild/restart the portal so configuration is loaded and prior in-memory sessions are invalidated.
5. While signed out, verify both hidden accounts are absent from Players Online, Deaths, Completionist, and Server MVP.
6. Log in as an ordinary account and repeat every check.
7. Log in as each hidden account and verify the standard view still hides both hidden accounts.
8. Log in as the configured exception viewer and verify both hidden accounts appear wherever their data qualifies.
9. Place or identify a hidden account inside a top-25 boundary in controlled data and verify the next eligible row fills the board for standard scope.
10. Log out from the exception viewer while a covered page is open and confirm hidden rows disappear immediately after protected caches are cleared/refetched.
11. Temporarily misspell one configured login in a controlled test and confirm covered endpoints become unavailable rather than unfiltered; restore it afterward.
12. Confirm registration, Login, Boosts, status, `/health`, and static assets remain available during that controlled policy failure.
13. Inspect browser responses and normal logs for policy values, IDs, scope labels, hidden counts, and privileged cache leakage.

## Follow-Up Rule

Every specification for a new account- or character-bearing page/API must list this specification as a dependency and state where `AccountVisibilityScope` is applied. A feature is not complete if it displays account-derived data without an explicit visibility-policy test.
