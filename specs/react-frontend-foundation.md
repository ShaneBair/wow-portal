# React Frontend Foundation

Status: Ready for implementation  
Repository: `wow-portal`  
Required before: `specs/site-navigation.md`, `specs/stats-population-filter.md`, `specs/character-deaths-leaderboard.md`

## Problem

The portal's framework-free page is sufficient for its current registration, status, and online-roster behavior. The next phase adds shared navigation, URL-backed page state, multiple asynchronous data panels, and increasingly interactive tables. Continuing to coordinate those concerns through document lookups and independent browser scripts would make shared state, loading behavior, testing, and reuse progressively harder.

## User Outcome

The portal retains its current appearance and behavior while gaining a React and TypeScript frontend foundation that supports:

- reusable page layouts and navigation;
- independent Home and Stats routes;
- typed API access and predictable loading, empty, error, and success states;
- URL-backed filters shared by multiple Stats panels;
- reusable accessible table behavior;
- focused frontend component tests.

This is an architectural migration, not a visual redesign.

## Current Behavior

- Express 5 serves API routes and the framework-free files in `src/public/`.
- `src/public/index.html` contains the complete Home markup.
- `src/public/app.js` owns registration, server status, and online-roster behavior through direct DOM access.
- Server status and the online roster refresh immediately and every 30 seconds.
- Server TypeScript compiles with strict checking and NodeNext modules.
- There is no client compilation step, client-side router, component test environment, or browser data library.
- Existing API and service tests run through Node's test runner.

## Accepted Architecture

Adopt a client-rendered React single-page application while retaining Express as the backend and production web server.

```text
Browser
  React + React Router + TanStack Query
                  |
                  | same-origin /api/* and /health
                  v
             Express server
                  |
          SOAP and future MariaDB
```

Architectural rules:

- React owns all rendered portal pages, including the existing Home page.
- Express continues to own every API, validation boundary, secret, integration, rate limit, and server-side cache.
- The browser never connects directly to SOAP or MariaDB.
- Use client-side rendering only. Do not add server-side rendering, React Server Components, Next.js, or another full-stack framework.
- Preserve same-origin production requests. Do not introduce CORS as part of this migration.
- The React application is unauthenticated, matching the portal's accepted current access model.

## Frontend Dependencies

Add and lock current mutually compatible stable versions of:

Production dependencies:

- `react`
- `react-dom`
- the official React Router browser package
- `@tanstack/react-query`

Development dependencies:

- `vite`
- `@vitejs/plugin-react`
- React and React DOM TypeScript types
- `vitest`
- `jsdom`
- React Testing Library
- `@testing-library/user-event`
- a small cross-platform process runner such as `concurrently` if needed to run both development servers from one command

Do not add Redux or another general-purpose client state store. URL state, TanStack Query server state, and local component/form state are sufficient for the accepted features.

TanStack Table is added by the first feature that uses it, `specs/character-deaths-leaderboard.md`, rather than remaining an unused foundation dependency.

## Source Layout

Keep browser and server code visibly separate. Use this layout unless a small variation is required by the selected stable tooling:

```text
client/
  index.html
  src/
    main.tsx
    App.tsx
    api/
    components/
    pages/
    styles.css
src/
  app.ts
  server.ts
  domain/
  routes/
  services/
tests/
  ...existing server tests
```

Requirements:

- Vite owns `client/index.html` and all browser TypeScript/TSX.
- The existing server `tsconfig.json` must not compile browser TSX as Node code.
- Add a client TypeScript configuration with strict checking and no emitted JavaScript outside Vite.
- Shared public API types may live in a narrowly scoped dependency-free folder only if both compilation targets can consume it safely. Do not import server integration or secret-bearing modules into the client.
- Move reusable styling into the client source tree. Preserve the existing visual language and responsive breakpoints where practical.
- Remove obsolete `src/public/index.html` and `src/public/app.js` only after their behavior is represented in React and verified.

## Build and Development Workflow

Vite provides the browser development server and production bundle. Express remains a separate process.

Required npm capabilities:

- a server development command using the existing TypeScript watcher;
- a client development command using Vite;
- `npm run dev` starting both commands and terminating both cleanly;
- independent server and client build commands;
- `npm run build` running strict server compilation and the production client build;
- independent server and client test commands;
- `npm test` running both suites.

During development:

- Vite proxies `/api` and `/health` to the local Express port.
- Browser code uses relative URLs such as `/api/status`; it must not embed a development hostname.
- Vite's port is the interactive browser entry point.
- Proxy configuration must not contain credentials or live internal service addresses.

For production:

- Build Vite assets into a dedicated directory such as `dist/public` without erasing the compiled Express output.
- Express serves the generated HTML and hashed assets.
- The Docker build copies the client sources and Vite/TypeScript configuration needed by `npm run build`.
- The runtime image contains the compiled server, generated client assets, and production dependencies. It does not need client source files or development dependencies.
- Preserve the current port, loopback publication, private Docker network, and startup command behavior except for paths required to serve generated assets.

## Express Client Routing

The production server must return the generated React entry document for both accepted browser routes:

```text
GET /
GET /stats
```

Requirements:

- A direct request or browser refresh on `/stats` succeeds.
- API routes and `/health` are registered before any browser-route fallback.
- Unknown `/api/*` requests remain API errors and must never receive the React HTML document.
- Missing asset requests remain `404` and must not receive the React HTML document.
- Serving the entry document performs no SOAP command or database query.
- Keep the client-output path injectable when constructing the Express application so route tests can use fixtures without depending on a production build directory.

An explicit allowlist of current browser routes is acceptable and preferred over a broad fallback that could conceal missing assets or API routes.

## React Application Shell

Create a single application root with:

- a shared shell with a route-content outlet and a stable place for primary navigation;
- a Home route at `/`;
- a Stats route at `/stats`;
- a small not-found page for unmatched client-side routes;
- route-aware document titles;
- one page-level `h1` per route.

The actual navigation links, active-page behavior, and final empty Stats page are owned by `specs/site-navigation.md`. A temporary route placeholder is acceptable while implementing this foundation alone.

## Home Migration

Migrate the complete current Home experience to React without changing its public API contracts or accepted behavior:

- site hero and server-status indicator;
- invite-code account registration form;
- connection instructions and current realmlist copy;
- online human-player roster;
- current loading, success, empty, offline, and unavailable wording unless a necessary accessibility correction is documented;
- immediate server-status and roster requests;
- 30-second status and roster refresh intervals;
- no overlapping requests for the same resource;
- registration success resets the form; registration failure preserves useful input and displays the public API error.

Use semantic React markup and rendered text. Never use `dangerouslySetInnerHTML` for API-derived content.

## Client Data Ownership

Use TanStack Query for server state, including status, online players, registration mutation lifecycle, and future Stats data.

Requirements:

- Define focused typed API functions rather than calling `fetch` throughout visual components.
- Treat all response bodies as untrusted. Check response status and validate the fields required for rendering before returning typed data.
- Query keys include every input that changes the response.
- Pass TanStack Query's cancellation signal to `fetch` where supported.
- Preserve server `Cache-Control` behavior; the client cache does not replace server-side freshness and integration caches.
- Do not show data from one query input under another input's label.
- Configure refresh intervals explicitly; do not rely on library defaults for polling or retries.
- Avoid automatic retries that would conflict with server rate limits or repeatedly call an unavailable SOAP/database dependency. Any retry policy must be deliberate and tested.

The shared Stats population choice is URL state, not TanStack Query state. Its specification defines how it becomes part of each Stats query key.

## Styling and Accessibility

- Preserve the current dark visual design, typography, spacing, panels, tables, and responsive behavior.
- Do not introduce a component styling framework in this task.
- Use semantic landmarks, headings, forms, labels, tables, and buttons.
- Maintain visible keyboard focus treatment and readable contrast.
- Dynamic status messages use appropriate live-region behavior without repeatedly announcing background refreshes unnecessarily.
- Navigation and form operation must work with keyboard and screen readers.
- The portal must remain usable without horizontal page scrolling at the existing narrow breakpoint.
- React development Strict Mode may remain enabled, but network behavior must not depend on effects that create duplicate user-visible requests. TanStack Query and tests should make development behavior predictable.

## Testing

Retain Node's test runner for Express, service, and integration-boundary tests. Add Vitest with jsdom and React Testing Library for client behavior.

Foundation frontend tests cover at least:

- rendering Home and Stats routes;
- Home status loading, online, offline, and unavailable states;
- online-roster loading, populated, empty, and unavailable states;
- 30-second refresh behavior with fake timers and no overlapping request effects;
- registration success and public validation/error behavior;
- no rendering of API-derived content as HTML;
- an unmatched client route.

Use mocked browser fetches. Automated tests must not call live SOAP, create game accounts, reach MariaDB, or require the live AzerothCore server.

Retain focused Express tests proving production entry-document routing does not interfere with APIs, health, or missing assets.

## Security and Privacy

- Never place SOAP credentials, invite codes, database credentials, internal hostnames, or privileged commands in client source, generated bundles, fixtures, or snapshots.
- Treat every Vite-exposed environment variable as public browser data. Do not expose secret environment variables through a Vite prefix.
- Keep registration validation and all authorization decisions on the server.
- Do not add analytics, third-party scripts, remote fonts, or externally hosted runtime assets.
- Preserve the current same-origin and private-network deployment boundaries.

## Migration Sequence

1. Add the client build, strict client configuration, development proxy, and frontend test harness.
2. Create the React root, Query provider, router, shared shell, and route placeholders.
3. Migrate Home markup and styling.
4. Migrate status, registration, and online-roster behavior to typed API functions and React components.
5. Add production Express entry-document routes and update the Docker build/runtime paths.
6. Remove obsolete framework-free browser files only after equivalent behavior passes automated and manual checks.
7. Implement the dependent navigation, population-filter, and deaths-leaderboard specifications.

Steps may be delivered together in one change, but intermediate commits must not leave the production image unable to serve the portal.

## Out of Scope

- A visual redesign or new branding.
- Changing existing HTTP response contracts.
- Changing online-player bot detection or the module contract.
- Statistics database connectivity or the deaths API.
- Authentication, sessions, or protected routes.
- Server-side rendering, static pre-rendering, or React Server Components.
- Redux or a general-purpose application state store.
- A component library or CSS framework.
- Deployment, container restart, firewall, DNS, or tunnel changes.

## Acceptance Criteria

- `npm run dev` starts a usable React frontend and Express backend with API proxying.
- `npm run build` strictly checks server and client code and produces a runnable production server plus generated client assets.
- Express serves the React entry document for `/` and `/stats`, including direct refreshes.
- API routes, `/health`, and missing assets retain correct non-HTML behavior.
- Home preserves registration, status, connection instructions, and online-roster behavior.
- Status and roster refresh every 30 seconds without duplicate or overlapping browser work.
- No secret or internal integration value is present in the browser bundle.
- The responsive dark design and accessibility behavior are preserved.
- Obsolete framework-free browser scripts are no longer loaded after migration.
- Existing server tests and the new frontend tests pass through `npm test`.
- The Docker image builds the client and serves it through Express without adding a public service port.

## Verification Plan

1. Install dependencies from the updated package manifest and confirm the chosen Node 22 version satisfies Vite requirements.
2. Run the separate client and server development processes through `npm run dev`.
3. Exercise Home status, registration, connection instructions, and online roster with mocked or safely available dependencies.
4. Navigate between `/` and `/stats`, then directly refresh both paths.
5. Request an unknown API path and missing hashed/static asset and confirm neither returns the React document.
6. Run strict server and client builds.
7. Run server and frontend automated tests.
8. Validate `docker compose config` without starting or changing the live deployment.
9. Build the Docker image locally if authorized, then confirm its file layout and startup path serve generated assets.
10. Inspect the production browser bundle for accidentally exposed configuration names or values.
