# wow-portal Guidance

## Repository Role

This repository is the friends-only web portal for the DaBoysZeroth AzerothCore WotLK server. It currently provides invite-code-protected game-account registration, simple server availability, and connection instructions. Future work is expected to expose statistics collected by the sibling `mod-player-statistics` repository.

This repository is a standalone Git root. The parent workspace file may not be loaded when Codex starts here, so the essential shared constraints are repeated below.

## Current Stack and Layout

- Node.js 22 and TypeScript with strict checking, ES2022, and NodeNext modules.
- Express 5 serves both the JSON endpoints and static HTML/CSS/JavaScript.
- `src/server.ts` configures middleware, static files, `/health`, and route modules.
- `src/routes/register.ts` validates and rate-limits registration.
- `src/routes/status.ts` reduces AzerothCore SOAP health to an online/offline response.
- `src/services/azerothcore.ts` owns SOAP envelope construction, Basic authentication, timeouts, and AzerothCore console commands.
- `src/public/` is a framework-free browser UI.
- Docker Compose joins the pre-existing external `wow-server-playerbots_ac-network` network and publishes the portal only on `127.0.0.1:8090`.

Use npm, matching the existing scripts and Dockerfile. There is currently no lockfile, automated test suite, lint script, formatter configuration, database client, or frontend build step.

## Current HTTP and Integration Behavior

- `POST /api/register` accepts username, email, password, password confirmation, and invite code.
- Usernames are trimmed, uppercased, and limited to 3-16 ASCII letters, digits, or underscores.
- Passwords are 8-64 characters and may not contain line breaks. Email receives basic format and length validation.
- Registration is limited to five attempts per 15 minutes using the current in-process rate limiter.
- Successful validation sends `account create <username> <password> <email>` to AzerothCore SOAP.
- `GET /api/status` sends `server info` through SOAP and returns only `{ online: boolean }`.
- `GET /health` reports portal process health and does not prove the game server is online.
- SOAP has an eight-second request timeout. Raw SOAP output is not parsed beyond HTTP/fault detection.

`SITE_NAME` and `WOW_REALMLIST` appear in `.env.example` but are not currently used by the application. The public page currently hard-codes the site identity and `wow.shanebair.com`. Treat that as current behavior, not the desired long-term configuration contract.

## Implementation Rules

- Preserve strict TypeScript and NodeNext `.js` suffixes in TypeScript imports.
- Keep routes thin. Put AzerothCore/database integration and reusable domain logic in focused service modules.
- Validate and normalize every external input on the server even when the browser also validates it.
- Never place SOAP credentials, invite codes, database credentials, or privileged commands in browser code or responses.
- Do not return raw SOAP bodies, internal hostnames, stack traces, or database errors to clients. Log only operationally useful details and redact secrets and passwords.
- Treat any string passed to an AzerothCore console command as command input, not merely XML input. XML escaping alone does not prevent console-command argument injection; maintain tight allowlists and revisit the integration design before accepting broader character sets or new commands.
- Preserve the private network boundary. SOAP port 7878 must not be exposed publicly, and the portal's direct host binding should remain loopback-only unless a deployment specification says otherwise.
- `app.set("trust proxy", 1)` and rate-limiting behavior depend on the real proxy topology. Verify that topology before changing forwarding trust or client-IP logic.
- Keep API contracts explicit and stable. If response shapes change, update browser callers and documentation in the same task.
- Add production dependencies only when they solve a concrete requirement; document configuration and deployment impact.
- Maintain accessible, responsive UI behavior and clear success/error states when changing `src/public/`.

## Statistics Boundary

The sibling `mod-player-statistics` module owns the `mod_player_stats_events` schema and event semantics in the AzerothCore characters database. Before implementing statistics:

- use a specification to define database connectivity and least-privilege read access;
- join IDs to the correct characters or world database without copying assumptions into UI code;
- support deliberate Human Only, Bots Only, and combined views where applicable;
- use parameterized queries and constrain time ranges, page sizes, and grouping dimensions;
- plan indexes, caching, summaries, and retention around real event volume;
- never expose account IDs, private email addresses, credentials, or GM-only information;
- coordinate any event-contract change with the module repository.

The portal does not currently have direct database access. Do not silently introduce it as part of an unrelated UI feature.

## Configuration and Secrets

- `.env` is local and ignored. Never read it into chat output, commit it, or replace it with example values.
- Document configuration in `.env.example` using placeholders only.
- Validate required configuration at an appropriate startup or request boundary and provide actionable server-side errors without leaking values.
- Keep environment-specific hostnames, realm names, ports, and branding configurable when implementing the existing `SITE_NAME` and `WOW_REALMLIST` intent.
- Do not deploy, alter DNS/tunnels/firewalls, restart containers, or call the live SOAP account-creation endpoint without explicit authorization.

## Specifications

Place portal work in `specs/<feature-name>.md`. A portal specification should define:

- user outcome and access policy;
- pages, states, API request/response contracts, and error behavior;
- AzerothCore command or statistics-data dependencies;
- validation, authentication/authorization, privacy, abuse, and rate-limit requirements;
- configuration and deployment changes;
- responsive and accessibility expectations;
- acceptance criteria and verification steps;
- explicit non-goals.

Read only the specification relevant to the active task unless it explicitly depends on another.

## Verification

Use the existing repository commands once dependencies are installed:

- `npm run build` for strict TypeScript compilation.
- `npm run dev` for local development when interaction is required.
- `docker compose config` to validate Compose configuration without starting services.
- `docker compose up -d --build` only when the user authorizes running or changing the local deployment.

For behavior changes, also verify the relevant route with success, validation failure, dependency failure, and timeout cases. Add focused automated tests when introducing logic that would otherwise require repeated live SOAP or database access. Clearly distinguish mocked/local verification from tests against the live AzerothCore server.

