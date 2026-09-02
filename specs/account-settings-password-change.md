# Account Settings: Change Password

**Status:** Implemented  
**Owner:** Portal  
**Scope:** `wow-portal`

## User outcome

An authenticated user can open an Account Settings page and change the password for the same AzerothCore account represented by their portal session. The new password becomes the password for both the game client and future portal logins.

After a successful change, all portal sessions for that account are invalidated and the user is returned to Login with a confirmation that they must sign in using the new password.

## Current behavior and confirmed core contract

- Portal login already validates AzerothCore SRP6 salt/verifier material and creates an opaque, time-limited portal session.
- The session principal contains the trusted numeric account ID and canonical username. The browser must never choose the account whose password is changed.
- The deployed Playerbots-compatible AzerothCore core limits passwords to 16 Unicode characters, uppercases basic Latin characters, generates a new 32-byte salt and verifier, and updates only `account.salt` and `account.verifier` for the numeric account ID.
- The portal already has compatible SRP6 calculation and verification code in `src/services/azerothcore-srp6.ts`.

This feature will perform the parameterized credential update directly in the private auth database. It will not send any password through SOAP or a console command, because command tokenization would unnecessarily restrict or expose credential input.

## In scope

- Authenticated `/settings` page.
- An authenticated-only `Settings` navigation link.
- A Change Password form with current password, new password, and new-password confirmation.
- Server-side current-password reauthentication.
- Cryptographically secure generation and atomic persistence of new AzerothCore SRP6 material.
- Rate limiting, CSRF/origin enforcement, safe errors, and session invalidation.
- Least-privilege database grants and focused automated tests.

## Out of scope

- Forgotten-password recovery, email reset links, administrator resets, or email changes.
- Username changes, two-factor authentication management, or a device/session list.
- Changing another account's password, including GM-managed changes.
- Password history, breach-list services, or a separate portal password.
- Disconnecting an already-running game session. The changed password applies to later authentication.

## Page and navigation

Add `/settings` behind the existing protected-route behavior. Render `Settings` in the account actions or primary navigation only after a valid authenticated session has been resolved. Do not flash the link while session resolution is pending.

The page shows the signed-in account name as read-only context and one form:

- **Current password** — `autocomplete="current-password"`;
- **New password** — `autocomplete="new-password"`;
- **Confirm new password** — `autocomplete="new-password"`;
- **Change password** submit button.

All inputs have visible labels, validation is announced in an accessible status region, focus moves to the first invalid field, and submission has a clear pending state. Password values are never repopulated after a failure and are cleared after success or component unmount.

## Validation

The browser may provide immediate guidance, but the server is authoritative.

- Current password: 1–64 characters to permit reauthentication of existing accounts; reject NUL, CR, LF, and malformed Unicode.
- New password: 8–16 Unicode characters; reject NUL, CR, LF, and malformed Unicode.
- Confirmation must exactly equal the submitted new password before core normalization.
- New password must differ from the current password.
- Do not trim passwords.
- Normalize the username and passwords exactly as the deployed core does when calculating or verifying SRP6 material.

The 8-character minimum is a portal policy. The 16-character maximum is the deployed core's `MAX_PASS_STR` contract and must not be relaxed without confirming a compatible core change.

## HTTP contract

### Change password

```http
POST /api/account/password
Content-Type: application/json
X-CSRF-Token: <current portal CSRF token>
```

```json
{
  "currentPassword": "not-shown-here",
  "newPassword": "not-shown-here",
  "confirmNewPassword": "not-shown-here"
}
```

The route must:

1. set `Cache-Control: no-store`;
2. require the existing portal session;
3. enforce the configured same-origin policy and current CSRF token;
4. apply a dedicated per-account and per-client-IP limiter before database work;
5. accept only the three exact JSON fields above;
6. use the account ID and username from the trusted session principal;
7. invoke a focused password-change service.

Responses:

- `204`: password changed; every portal session for the account is invalidated and the session cookie is expired;
- `400`: malformed input, mismatched confirmation, unchanged password, or password-policy failure;
- `401`: missing/expired portal session, or incorrect current password;
- `403`: invalid origin or CSRF token;
- `409`: the account credentials changed concurrently; expire the current session and require login;
- `429`: too many attempts;
- `503`: the password change cannot be safely completed or confirmed.

Use short fixed browser messages. Never return SQL, salts, verifiers, account IDs, database names, stack traces, or raw dependency errors. An incorrect current password may say `The current password is incorrect.` because the caller has already authenticated, but it must not disclose authentication material.

## Password-change service

Create a service separate from the route and inject its database and random-byte dependencies for tests.

1. Select the canonical username, 32-byte salt, and 32-byte verifier by the session's numeric account ID.
2. Verify `currentPassword` with the existing constant-time compatible verifier logic.
3. Generate a new salt with `randomBytes(32)`.
4. Calculate the new verifier from the canonical username, normalized new password, and new salt.
5. Execute one parameterized compare-and-swap update:

```sql
UPDATE `AUTH_DATABASE`.`account`
SET `salt` = ?, `verifier` = ?
WHERE `id` = ? AND `salt` = ? AND `verifier` = ?
```

Exactly one affected row is success. Zero rows means the credential material changed concurrently and must return the safe conflict behavior. More than one affected row is a contract failure.

Do not retain passwords, salts, or verifiers outside the request/service call. Do not place them in portal state tables, application caches, analytics, request IDs, or logs. Buffers should become unreachable immediately after the operation; JavaScript cannot guarantee physical memory zeroization, so operational controls must not claim otherwise.

If the update result is ambiguous because the database connection fails during execution, do not retry automatically. Invalidate the account's portal sessions and return the fixed `503` response instructing the user to try signing in with the new password, then the old password if needed.

## Session behavior

Extend `PortalSessionStore` with an account-scoped invalidation method. On confirmed success, conflict, or ambiguous update, invalidate every in-memory session whose trusted `accountId` matches the changed account, including the current session.

On success the client clears all protected/account-visible query data, transitions to signed out, and navigates to `/login` with a one-time in-memory success message. Do not place that message or account name in the URL. A portal restart already invalidates every session and requires no migration.

## Abuse and security controls

- Limit password-change attempts to 5 per 15 minutes per authenticated account and 10 per 15 minutes per client IP. Limits must not reset after a successful attempt.
- Do not accept account ID or username in the request.
- Use parameterized SQL and validated database identifiers.
- Use the existing private database connection; do not expose the auth database or SOAP service publicly.
- Never log request bodies, passwords, cookies, CSRF tokens, salts, verifiers, or complete database rows.
- Log only a generated request ID, coarse result category, and safe operational error class where useful.
- Mark the page/API as non-cacheable and do not persist form values in browser storage.
- Password managers and paste must remain allowed.

## Configuration, grants, and migration

No new environment variable, table, or schema migration is required. Reuse `PORTAL_AUTH_DATABASE` and the existing portal database connection.

The portal database user already needs column-scoped reads for authentication. Add only this write grant, substituting the deployed schema, user, and host values:

```sql
GRANT UPDATE (`salt`, `verifier`)
ON `AUTH_DATABASE`.`account`
TO 'portal-user'@'portal-host';
```

Do not grant `UPDATE` on the whole account table and do not grant password-related writes in the characters, world, Playerbots, or portal-state databases.

## Acceptance criteria

- Settings navigation and `/settings` content are visible only to authenticated users.
- Direct anonymous access returns the existing protected Login flow, and the API independently returns `401`.
- A user can change only the password of the account in their trusted session.
- Wrong-current-password, validation, CSRF/origin, rate-limit, concurrent-change, and dependency failures use fixed safe responses.
- A successful change writes a fresh compatible 32-byte salt/verifier pair and the old password no longer verifies.
- The new password verifies through the same code path used by portal login and works for subsequent game authentication.
- Success invalidates all portal sessions for the account and requires login with the new password.
- No credential material appears in browser responses, logs, snapshots, URLs, state tables, or test fixtures.
- The production database user has only the documented column-scoped update permission.

## Verification

Automated tests use fabricated SRP6 fixtures and injected database/session dependencies; they must never use real credentials or mutate the live auth database.

- Unit-test validation boundaries, exact normalization, random-salt length, verifier generation, current-password failure, compare-and-swap SQL, affected-row contracts, and ambiguous failures.
- Route-test session, origin, CSRF, JSON allowlisting, rate limits, no-store headers, fixed errors, and cookie expiration.
- Session-test invalidation of multiple sessions for one account without affecting other accounts.
- Client-test protected navigation, accessibility, pending/errors, password clearing, success sign-out, and passive session expiry.
- Run `npm test`, `npm run build`, and `docker compose config`.
- Before production enablement, confirm the deployed core still updates only `salt` and `verifier`, apply the column-scoped grant, rebuild the portal, and test with a dedicated disposable account. Verify old/new portal and game logins, multiple-browser session invalidation, and recent logs containing no credential material.

## Implementation outline

1. Add account-password validation and the SRP6 password-change service.
2. Add account-scoped session invalidation and the protected API route.
3. Add the Settings page, navigation, API client, and protected-query cleanup.
4. Add focused server/client tests and update `.env.example`/README only if implementation introduces a configuration change.
5. Apply the production column-scoped grant and perform the disposable-account smoke test as a separately authorized deployment step.
