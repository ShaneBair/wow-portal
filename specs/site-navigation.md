# Site Navigation and Stats Page Shell

Status: Ready for implementation  
Repository: `wow-portal`  
Depends on: `specs/react-frontend-foundation.md`  
Followed by: `specs/stats-population-filter.md`

## Problem

The portal is currently one page with no global navigation. Statistics features need a stable destination and a shared layout that can grow without duplicating navigation markup or browser behavior across static documents.

## User Outcome

Every portal route has a clear top navigation menu with:

- `Home`
- `Stats`

Home retains the existing portal experience. Stats opens a dedicated route that is intentionally empty apart from its page shell and a truthful placeholder at the end of this specification.

## Current Behavior

- `/` is served from the framework-free `src/public/index.html`.
- The Home page contains server status, account registration, connection instructions, and the online human-player roster.
- `src/public/app.js` assumes the Home document's elements exist.
- There is no `/stats` browser route.
- There is no shared application shell or client-side router.

The React foundation specification migrates the existing Home page before or as part of this feature.

## Accepted Architecture

Implement navigation within the React application established by `specs/react-frontend-foundation.md`.

- Use React Router in client-rendered browser mode.
- `/` renders the Home page.
- `/stats` renders the Stats page.
- A shared layout component renders the primary navigation once and an outlet for page content.
- Express serves the same generated Vite entry document for direct requests to `/` and `/stats`.
- Do not create a second HTML document such as `stats.html`.
- Do not duplicate the navigation in individual page components.
- Navigating between Home and Stats should not perform a full document reload during normal JavaScript operation.

Serving or rendering either page shell performs no SOAP command or database query beyond the data requests intentionally mounted by that route. The empty Stats route performs none in this specification.

## Application Shell

Create a shared semantic structure equivalent to:

```text
Application shell
  Primary navigation
  Current route content
```

The shell owns page width and top-level spacing. Page components own their hero and main content.

The navigation uses real link semantics through the router's link component and renders:

```text
Home    Stats
```

The canonical destinations are exactly `/` and `/stats`.

## Active Page Behavior

- Home is current only at `/`.
- Stats is current at `/stats`, including when Stats query parameters are present.
- Render `aria-current="page"` on exactly one current navigation link.
- Keep the current link operable.
- Active styling must not rely on color alone.
- Both links have a visible keyboard focus state.
- Browser Back and Forward navigation updates route content and active state correctly.

Use React Router's route-aware navigation behavior rather than comparing `window.location` manually in visual components.

## Home Route

- Render the migrated Home page at `/` inside the shared shell.
- Preserve its hero, status indicator, registration form, connection instructions, online roster, public wording, API behavior, and responsive behavior as required by the foundation specification.
- Do not move Home features onto Stats.
- Leaving and returning to Home may remount Home queries. TanStack Query settings determine whether cached data can be shown or refreshed; the page must not create duplicate polling intervals.
- Keep one page-level `h1`.
- Set the document title to `DaBoysZeroth`.

## Stats Route Shell

Render `/stats` with:

- an eyebrow such as `SERVER STATISTICS`;
- one page-level `h1` of `Stats`;
- a short description of the page;
- a main content landmark;
- one empty-state panel containing truthful placeholder copy.

Suggested placeholder:

```text
Statistics are coming next.
```

The placeholder is not a loading state and must not claim that statistics are already available.

The Stats page does not include account registration, connection instructions, the Home server-status indicator, or the online-player roster in this specification.

Set the document title to `Stats | DaBoysZeroth` and restore the correct Home title when navigating back.

## Unknown Client Routes

The React application displays a small accessible not-found page for an unmatched client route. It includes a way back to Home and does not expose internal route or server information.

The production Express server does not need to serve arbitrary unknown routes as React entry points for this feature. Its explicit browser-route allowlist remains `/` and `/stats`.

## Styling

- Reuse the migrated shared stylesheet and existing dark design tokens.
- Place navigation at the top of the existing centered shell.
- Keep the menu consistent with current panels, borders, spacing, and muted colors.
- Keep both links directly visible; no mobile hamburger menu is needed for two items.
- Links remain comfortably tappable at narrow widths.
- The route layout works at the existing mobile breakpoint without horizontal page scrolling.
- Preserve existing Home responsive behavior.

## Accessibility

- Use a real `nav` landmark with an accessible label such as `Primary`.
- Preserve link semantics; do not render navigation as buttons.
- Maintain one page-level `h1` per route.
- Move keyboard focus predictably after route changes only if testing demonstrates it is needed; do not unexpectedly steal focus during ordinary interaction.
- Provide visible `:focus-visible` treatment.
- Maintain readable contrast for default, hover, focus, and active states.
- Navigation DOM order matches visual order.
- Route-aware document titles update on client navigation.

## Security and Privacy

- This feature adds public navigation and a public empty route only.
- Do not embed environment values, credentials, invite codes, SOAP details, database names, or internal hostnames in route components or client configuration.
- Do not add analytics, external scripts, or third-party runtime assets.

## Out of Scope

- Statistics data, APIs, database connectivity, filters, tables, or charts.
- Authentication or authorization.
- Server-side rendering.
- A mobile hamburger menu.
- A visual redesign of unrelated Home content.
- Moving the online-player panel to Stats.
- Prefetching Stats database data from navigation.

## Acceptance Criteria

- A visible shared navigation with Home and Stats appears on both routes.
- Home links to `/`; Stats links to `/stats`.
- Exactly one navigation link has `aria-current="page"` on each accepted route.
- Normal navigation changes routes without a full document reload.
- Direct requests and browser refreshes on `/` and `/stats` succeed through Express.
- The Stats route contains its hero and truthful empty placeholder, with no statistics request yet.
- The Home route retains registration, connection instructions, status, and online-roster behavior.
- Browser Back and Forward restore the correct route, title, content, and active navigation state.
- Navigation works with keyboard, mouse, and touch.
- Active and focus states are distinguishable without relying only on color.
- Both routes remain readable at the existing narrow breakpoint without horizontal page scrolling.
- Existing APIs and `/health` continue to work.
- `npm run build` and `npm test` pass.

## Automated Verification

Frontend component tests cover:

- Home and Stats route rendering;
- shared navigation presence on both routes;
- exactly one current-page marker;
- route changes from link activation and browser history;
- route-aware document titles;
- the Stats empty state;
- an unmatched client route.

Express tests cover:

- generated entry-document responses for `/`, `/stats`, and `/stats` with a query string;
- direct refresh compatibility;
- static generated asset delivery;
- unchanged `/health` and API routing;
- a missing asset and unknown API route not returning the React document.

Use test fixtures or an injected client-output path. Automated tests must not require live SOAP or database access.

## Manual Verification

1. Open Home directly and verify all existing content and behavior.
2. Navigate to Stats and back using the menu without a full reload.
3. Refresh `/stats` directly.
4. Exercise browser Back and Forward.
5. Inspect document titles and the active navigation state on both routes.
6. Navigate with keyboard only and inspect focus visibility.
7. Check desktop and narrow mobile widths.
8. Confirm opening Stats performs no SOAP or database request in this specification.
