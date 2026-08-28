# WoW Portal

Small friends-only portal for the private AzerothCore server.

The browser application is a client-rendered React app built with Vite. Express serves the
production bundle and continues to own all APIs, validation, rate limits, and AzerothCore
integration.

Node.js 22.22.2 or newer is required by the locked frontend toolchain.

## V1 features

- Invite-code-protected account creation
- AzerothCore SOAP integration
- Server online/offline status
- Human-only online player roster with a short-lived server-side cache
- Player/Bot-filtered deaths leaderboard with comprehensive post-cutover coverage
- Completionist award for recorded quest completions, including repeatable-quest events
- Server MVP award for recorded direct and pet-owner boss killing blows
- Universal account visibility exclusions across online players and leaderboards
- Game-account login with bounded portal sessions and protected-route support
- Authenticated character boosts with durable, idempotent Free Money requests
- Connection instructions
- Registration rate limiting
- Docker deployment on the existing AzerothCore network

## Setup

1. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env`.

   Use the existing SOAP service account or create a dedicated portal service account in AzerothCore.

3. Install dependencies and build:

   ```bash
   npm ci
   npm run build
   ```

4. For local development, start the React and Express development servers together:

   ```bash
   npm run dev
   ```

   Open the Vite URL shown in the terminal. Browser API requests are proxied to Express.

5. Build and start the container:

   ```bash
   docker compose up -d --build
   ```

6. Check:

   ```bash
   docker compose ps
   docker compose logs -f wow-portal
   ```

7. Open on GamingTower01:

   ```
   http://localhost:8090
   ```

## Docker networking

The portal joins the existing external network:

```
wow-server-playerbots_ac-network
```

It talks to the AzerothCore worldserver at:

```
http://ac-worldserver:7878/
```

Port 7878 should NOT be forwarded through router.

The portal itself is bound only to:

```
127.0.0.1:8090
```

so it is not directly exposed to the LAN or Internet.

The roster endpoint executes the read-only `playerstats online` command supplied by the
compatible `mod-player-statistics` module. When the module or SOAP service is unavailable,
`GET /api/online-players` returns `503` rather than an empty roster.

The deaths leaderboard reads `mod_player_stats_events`, `mod_player_stats_migrations`, and
`characters` from the configured characters database plus `account` from the auth database.
Its dedicated database user needs `SELECT` on those four tables only. The canonical death
provider migration must be deployed and verified before deploying this portal version; invalid
or missing cutover metadata causes `GET /api/stats/deaths` to fail closed with `503`.

The Completionist award reuses that read-only connection and counts `QUEST_COMPLETE` event rows,
with separate Player/Bot groups and independent population caches. Ensure the event-table grant
includes column-level `SELECT` for `event_time`, `event_type`, `actor_guid`, `actor_is_bot`,
`target_type`, `target_entry`, `target_guid`, `target_is_bot`, `value1`, `value2`, and `source`.
No new table, database write, or portal-state migration is required. Before deployment, verify the
module setting, run `EXPLAIN` with the deployed reader, and confirm ordinary, repeatable, and
Playerbot-controlled quest completions against the live-compatible data contract.

The Server MVP award adds `STATS_WORLD_DATABASE` and reuses the same read-only statistics
connection. Its reader needs column-level `SELECT` for `instance_encounters.creditType` and
`creditEntry`, plus `creature_template.entry`, `rank`, and `type_flags`; no world writes are
required. The endpoint combines kill-creature encounter credits with rank-3 and boss-type-flag
creatures, then counts direct and pet-owner killing blows. Spell-credit-only encounters are not
counted unless their creature is independently boss-marked. A missing world setting or grant makes
only `GET /api/stats/boss-kills` return `503`. Before deployment, confirm the three classification
constants against the deployed core, run both population queries and `EXPLAIN` as the reader, and
verify ordinary, direct, pet-owner, and non-killing-party-member cases against live-compatible data.

## Portal authentication

Portal login verifies the game account's AzerothCore SRP6 salt and verifier through a separate,
least-privilege MariaDB user. It never sends player passwords through SOAP and does not create an
authserver/game session. Sessions are opaque, process-local, idle for at most 30 minutes, expire
absolutely after eight hours, and are invalidated by a portal restart.

Configure the `PORTAL_DB_*` schema settings and `PORTAL_PUBLIC_ORIGIN` from `.env.example`.
The database user needs column-level `SELECT` access for `account.id`, `account.username`,
`account.salt`, `account.verifier`, and `account.totp_secret`, plus the account-ban columns needed
to determine whether an active ban exists. It must not have write access to AzerothCore schemas.
The characters and portal-state schema settings establish the shared integration boundary for
future authenticated features; authentication does not mutate either schema.

`PORTAL_PUBLIC_ORIGIN` must exactly match the browser's origin. Production requires HTTPS and
uses a `Secure`, HTTP-only, host-only cookie. Local Vite development may use
`http://localhost:5173`; non-loopback plain HTTP is rejected. The existing one-hop proxy trust
must be verified against the real tunnel/reverse-proxy topology before production login is
enabled.

Before enabling login, verify the fabricated SRP6 test vector against the exact deployed
AzerothCore/Playerbots revision, then test with a dedicated non-privileged account. Accounts with
an active account ban or configured TOTP fail closed. Existing Home, registration, status, roster,
and Stats behavior remains public.

## Account visibility exclusions

`PORTAL_HIDDEN_ACCOUNTS` contains a comma-separated list of canonical game-account logins that
ordinary and anonymous viewers must not see. `PORTAL_HIDDEN_ACCOUNT_VIEWERS` contains the
authenticated accounts allowed to see those hidden accounts. Both settings are required; an
explicit empty value represents an empty list. Put real account names only in the ignored `.env`.

At runtime the portal resolves configured logins through its existing least-privilege auth reads
and enforces immutable account IDs. The shared visibility scope applies to the current-online
panel, Most Deaths, Completionist, Server MVP, and future account-bearing views. Filtering occurs
before ranking, limits, counts, and public projection. Public endpoints use the filtered scope for
anonymous, invalid-session, and ordinary-account requests; only a valid configured viewer session
receives the full scope.

No migration or additional database grant is required. `PORTAL_AUTH_DATABASE` and
`STATS_AUTH_DATABASE` must refer to the same AzerothCore account identity namespace. Missing or
invalid visibility settings and unresolved configured accounts make only account-bearing endpoints
unavailable; registration, Login, Boosts, status, `/health`, and static assets remain independent.
Changing either list requires a portal container restart.

## Player boosts

The protected `/boosts` page lists only non-deleted characters owned by the authenticated
account. Free Money uses AzerothCore's `send money` command and durable request state; it never
writes character balances or AzerothCore mail tables directly.

Before enabling it, apply `migrations/001_create_money_boost_requests.sql` to the configured
portal-state schema. Grant the portal user `SELECT`, `INSERT`, and `UPDATE` on that table,
column-scoped `SELECT` for `characters.guid`, `account`, `name`, `level`, `race`, `class`, and
`deleteInfos_Name`, and column-scoped `SELECT` for `mail.id`, `receiver`, `subject`, `body`, and
`money`. Do not grant writes to AzerothCore schemas.

Keep `BOOST_MONEY_ENABLED=false` until the deployed Playerbots/AzerothCore revision's exact
`send money` success output, permission, offline delivery, amount range, replay behavior, and mail
reconciliation have been verified with a dedicated test character. The other `BOOST_MONEY_*`
settings define the enforced per-request and per-account UTC-day limits. Retain request rows for
at least the daily window; the current operator policy target is 90 days, and cleanup must never
delete AzerothCore mail.

Hole Lotta Storage uses the same authenticated character selector to send a fixed bundle of four
Portable Holes through AzerothCore's `send items` command. Apply
`migrations/002_create_portable_hole_boost_requests.sql` and the grants documented in
`migrations/README.md` before deployment. Keep `BOOST_PORTABLE_HOLES_ENABLED=false` until item
51809, exact command output, offline four-attachment delivery, the narrow SOAP permission, replay,
and ambiguous-result reconciliation have been verified against the deployed core revision.

## Verification

Run strict server/client builds and mocked server/frontend tests without contacting the live
game server:

```bash
npm run build
npm test
```

## Next

Once registration is verified locally, expose the portal as:

```
https://play.domain.com
```

through a secure tunnel/reverse proxy rather than opening another inbound router port.
