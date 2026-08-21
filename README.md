# WoW Portal

Small friends-only portal for the private AzerothCore server.

## V1 features

- Invite-code-protected account creation
- AzerothCore SOAP integration
- Server online/offline status
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

3. Build and start:

   ```bash
   docker compose up -d --build
   ```

4. Check:

   ```bash
   docker compose ps
   docker compose logs -f wow-portal
   ```

5. Open on GamingTower01:

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

## Next

Once registration is verified locally, expose the portal as:

```
https://play.domain.com
```

through a secure tunnel/reverse proxy rather than opening another inbound router port.
