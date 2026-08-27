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
- Game-account login with bounded portal sessions and protected-route support
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
