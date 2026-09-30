# Statistics Navigation and Discovery

**Status:** Draft  
**Owner:** WoW Portal  
**Repository:** `wow-portal`

## Problem

The Stats page currently renders every implemented leaderboard as a full-width panel in one vertical sequence. Five panels already require substantial scrolling, every panel mounts and requests data together, and the page has no direct way to find, bookmark, or share one statistic. The planned statistics catalog will make this progressively harder to scan and more expensive to load.

## User Outcome

Users get a browsable Stats Hub and a focused detail view for each statistic:

- `/stats` is a lightweight directory organized by category and searchable by name or description;
- `/stats/:statSlug` displays one complete statistic at a stable, shareable URL;
- desktop detail views include a sticky statistics navigation rail;
- mobile detail views provide a compact category/stat switcher rather than a long horizontal tab strip;
- the existing Players-only versus Players-and-bots selection remains in the URL and follows users between compatible statistics.

This replaces “scroll until you find it” without hiding the catalog behind several unrelated pages.

## Current Behavior

- `/stats` renders the page hero, server status, population control, and every panel in `StatsPage.tsx`.
- The implemented panels are Completionist, Server MVP, Most Deaths, Bad Neighborhood, and The Real Raid Boss.
- Each mounted panel immediately initializes its own React Query request.
- `population=players|all` is canonicalized and managed through `StatsPopulationProvider`.
- Individual statistics have no browser route, breadcrumb, category, search metadata, or navigation entry.
- Public access and optional authenticated account-visibility scope are already enforced by the existing APIs and must not change.

## In Scope

- a source-owned statistics catalog;
- a Stats Hub with category filters and text search;
- one-statistic detail routes and deep links;
- desktop and mobile navigation between statistics;
- population-control behavior for compatible and fixed-population statistics;
- loading/performance behavior that mounts only the selected full panel;
- responsive, keyboard, screen-reader, focus, and browser-history behavior;
- route, component, catalog, and regression tests.

## Information Architecture

Each statistic has exactly one primary category. Initial category IDs and labels are:

| ID | Label | Intended contents |
|---|---|---|
| `combat` | Combat | kills, creature variety, pet kills, unusual kill records |
| `deaths` | Deaths & Danger | character deaths, deadly NPCs, dangerous zones |
| `progression` | Progression | quests, levels, leveling-time records |
| `exploration` | Exploration | zones, maps, travel, world activity |
| `economy` | Economy | looted, earned, spent, and vendor money statistics |
| `pvp-bots` | PvP & Bots | PvP and Playerbot interaction statistics |

The initial implemented entries are assigned as follows:

- Completionist → Progression;
- Server MVP → Combat;
- Most Deaths → Deaths & Danger;
- Bad Neighborhood → Deaths & Danger;
- The Real Raid Boss → Deaths & Danger.

A future statistic receives one primary category when registered. Search keywords may provide cross-category discovery, but the same statistic must not appear as duplicate tiles in multiple categories. Category order and statistic order are explicit source values, not alphabetical accidents.

## Statistics Catalog

Create one typed, client-owned catalog as the navigation source of truth. Each registered statistic defines:

```ts
interface StatisticDefinition {
  slug: string;
  title: string;
  shortDescription: string;
  category: StatisticCategoryId;
  icon: string;
  keywords: readonly string[];
  populationMode: "event" | "all-characters" | "human-vs-bot";
  component: React.LazyExoticComponent<ComponentType>;
  order: number;
}
```

Catalog rules:

- `slug` is a unique, lowercase, hyphenated source constant and is the route allowlist;
- titles, descriptions, icons, categories, keywords, and population mode are source-owned and never returned by a database;
- titles are unique under case-insensitive comparison;
- category IDs must exist in the category catalog;
- ordering values are deterministic; ties fall back to title and slug;
- only implemented statistics are registered and visible;
- adding a new statistic requires its panel, API client, tests, and one catalog entry;
- catalog validation fails during automated tests, not at runtime for users.

Use lazy component imports so the selected detail panel can be code-split. The hub may read catalog metadata but must not mount the full panels or call leaderboard APIs.

## Stats Hub: `/stats`

The page retains the current hero and server status, then presents:

1. an `h1` of “Stats” and concise explanation;
2. a labeled search input with a clear button;
3. category controls: All plus each non-empty category;
4. a result summary such as “5 statistics” or “2 results for ‘death’”;
5. a responsive grid of statistic links.

Each tile is a real link and contains icon, title, short description, and category label. It contains no live leaderboard winner or preview in this version. Avoiding previews prevents the directory from issuing every statistics request.

Search behavior:

- match title, short description, category label, and keywords;
- trim outer whitespace and compare case-insensitively;
- treat user text literally, not as a regular expression;
- limit the normalized query to 80 Unicode code points;
- update results client-side without a network request;
- display a useful no-results state with “Clear search” and “Show all categories” actions.

Hub URL state is optional but shareable:

```text
/stats?category=deaths&q=boss&population=players
```

- omit `category` when All is selected;
- omit `q` when empty;
- preserve the canonical population parameter even though the hub does not fetch leaderboard data, so detail links inherit it;
- an unknown/empty/repeated category is normalized to All;
- an invalid/repeated population continues to normalize to `players`;
- search/category changes replace the current history entry while opening a statistic pushes a new entry.

## Statistic Detail: `/stats/:statSlug`

A valid detail route renders:

- the shared Stats hero in a compact form;
- breadcrumb links: `Stats / <Category> / <Statistic>`;
- the population control or fixed-population explanation;
- a desktop statistics navigation rail;
- one full existing statistic panel in the main content region;
- Previous and Next links based on catalog order, plus “Browse all stats.”

The hub uses “Stats” as its single `h1`. A detail route uses the selected statistic’s title as its single `h1`; “Stats” becomes breadcrumb/eyebrow text there. Refactor panel heading presentation as needed so the panel does not repeat the same visible title or introduce a second `h1`, while retaining a correctly ordered `h2` for any distinct panel subsection.

The selected panel is the only full panel mounted. Its existing loading, success, empty, unavailable, retry, coverage, sorting, privacy, and cache behavior remains authoritative.

Detail URLs preserve population:

```text
/stats/bad-neighborhood?population=players
/stats/real-raid-boss?population=all
```

An unknown slug displays a Stats-specific not-found view within the normal shell. It includes “Browse all stats” and does not mount a panel or issue a statistics API request. Do not redirect an unknown slug to a different statistic.

## Navigation Rail and Mobile Switcher

At desktop widths, use a two-column detail layout:

- a sticky navigation rail on the left, bounded below the global site header;
- the selected statistic panel on the right;
- category headings with their registered statistic links;
- `aria-current="page"` on the selected link;
- the selected item remains visibly distinct without relying on color alone.

The rail scrolls independently only when it cannot fit in the viewport. It must not cover the page footer or trap wheel/keyboard scrolling.

Below the desktop breakpoint, replace the rail with:

- a labeled category selector; and
- a labeled statistic selector containing the selected category’s entries.

Changing the statistic selector navigates to the corresponding detail URL and preserves population. Do not implement dozens of horizontally scrolling tabs: they truncate labels, obscure the current location, and scale poorly.

The mobile selectors are navigation controls, not form submission. Their labels must remain visible, and options must use the full statistic titles.

## Population Modes

`populationMode` controls the detail toolbar:

- `event`: show the existing Players only / Players + bots control and pass the selected value to the panel;
- `all-characters`: hide the radio control and show a read-only “All current characters” explanation because cumulative counters cannot be split historically;
- `human-vs-bot`: hide the radio control and show a read-only “Human killers • Bot victims” explanation.

When navigating from an event statistic to a fixed-population statistic, retain `population` in the URL but do not use it to alter or key that statistic’s request. Returning to an event statistic restores the retained selection. Fixed modes must never silently claim to represent the selected event population.

## Routing and Server Fallback

Add React routes for:

```text
/stats
/stats/:statSlug
```

Update the Express SPA allowlist to serve `index.html` for exactly `/stats` and one safe statistic-slug segment. Do not add a broad catch-all server fallback. API paths remain unchanged.

Direct navigation, refresh, browser Back/Forward, opening in a new tab, and copied URLs must all work. The global Stats navigation item remains current for both hub and detail routes.

## Focus, Scroll, and History

- Opening a detail link starts at the detail heading rather than preserving the hub’s old vertical scroll offset.
- Client-side detail-to-detail navigation moves focus to the new detail `h1` or a dedicated focus target after navigation.
- Browser Back returns to the prior hub search/category state and restores a reasonable scroll position through the router/browser defaults.
- Population changes preserve slug, category, and search parameters that are valid for the current route.
- Search keystrokes must not move focus or announce the entire tile grid repeatedly; announce the debounced result count through a polite live region.
- Respect `prefers-reduced-motion`; no animated page carousel is required.

## Accessibility and Responsive Behavior

- Use a `nav` landmark with an accessible “Statistics” label for the rail.
- Tiles are links with visible focus indicators and at least a 44-by-44 CSS-pixel target.
- Category controls use buttons or links with a clear selected state; do not apply tab roles unless implementing the complete ARIA tab interaction model.
- Search has a programmatic label and clear button with an accessible name.
- Breadcrumbs use `nav aria-label="Breadcrumb"` and an ordered list.
- The detail panel keeps exactly one logical page `h1`; panel headings follow a consistent hierarchy.
- At 200% zoom and 320 CSS pixels wide, no navigation or leaderboard controls overlap or require page-level horizontal scrolling.
- Icons are decorative when adjacent text provides the name.
- Empty, loading, and error messages remain available to assistive technology.

## Performance and Data Behavior

- The hub makes zero leaderboard API requests.
- A detail route initializes only the selected statistic’s request.
- Navigating away aborts an in-flight fetch through the existing `AbortSignal` integration where supported.
- React Query may retain its normal per-statistic/population cache so Back navigation can reuse fresh data.
- Prefetching every statistic is prohibited. Optional prefetching of one explicitly hovered/focused detail link may be considered later only after measurement.
- Existing server-side 60-second caches, read limiters, query timeouts, visibility scopes, and `Cache-Control: no-store` behavior do not change.

## Access, Privacy, and Security

The hub and detail routes remain public like the current Stats page. An optional authenticated session continues to select standard or full account-visibility scope through each existing API. Navigation metadata contains no account IDs, hidden-account names, internal database identifiers, or privileged counts.

Search is client-only and must not be logged or sent to statistics APIs. Slugs come only from the source catalog; they are not SQL input. Unknown route segments never select arbitrary modules, files, endpoints, or database dimensions.

## Loading and Failure States

- Hub catalog rendering does not depend on game/database availability.
- A failed detail request affects only that statistic and retains its existing retry action.
- A lazy component chunk failure shows a generic statistic-unavailable state with Retry and Browse all actions.
- Category/search no-results is distinct from a valid statistic with an empty leaderboard.
- Server status failure does not block browsing the catalog or opening cached statistic views.

## Migration and Rollout

No database migration, database grant, new environment value, module change, or API response change is required.

Suggested rollout:

1. introduce and validate the category/statistics catalogs;
2. register the five currently implemented statistics;
3. add hub and detail routes plus the narrow Express fallback;
4. move the existing population provider so both hub and detail routes preserve its query parameter;
5. add desktop rail and mobile selectors;
6. verify direct URLs and production build output;
7. add future statistics through catalog entries rather than appending panels to `StatsPage`.

The old all-panels rendering should be removed after the new routes are verified. Do not keep a hidden copy mounted, because it would continue issuing all API requests.

## Acceptance Criteria

- `/stats` shows all five implemented statistics as directory tiles grouped/filterable by category.
- The hub issues no leaderboard API requests.
- Search and category filters work together and produce a useful no-results state.
- Every tile opens a stable `/stats/:statSlug` URL.
- Refreshing or directly opening a valid detail URL renders the correct panel.
- Only the selected panel’s leaderboard endpoint is requested.
- Desktop users can switch statistics through the sticky rail without returning to the hub.
- Mobile users can switch through labeled category/statistic selectors without horizontal tab scrolling.
- Browser Back/Forward and copied URLs preserve the expected detail, category, search, and population state.
- Event statistics retain Players/All behavior; fixed-population statistics explain their fixed scope.
- Unknown slugs show the Stats-specific not-found state and issue no statistics request.
- The global Stats navigation item remains current on hub and detail routes.
- Existing visibility, caching, sorting, error, and retry behavior remains unchanged inside each panel.
- Keyboard-only and screen-reader navigation can identify the current statistic and reach every hub/detail control.

## Automated Verification

Add focused tests for:

- catalog slug/title uniqueness, valid categories, deterministic order, and valid population modes;
- hub rendering, combined category/search filtering, literal special-character search, clear actions, and no-results behavior;
- proof that the hub performs no leaderboard fetches;
- valid, invalid, refreshed, and directly loaded detail routes;
- only one selected-panel endpoint request;
- detail-to-detail navigation, Back/Forward behavior, and population preservation;
- event versus fixed population controls;
- `aria-current`, navigation/breadcrumb labels, heading hierarchy, focus movement, and result-count announcements;
- mobile selector navigation and desktop rail rendering at the relevant layout states;
- Express serving `index.html` for one-segment detail URLs while leaving unknown API paths untouched;
- no regression to account-visible query keys or logout/account-change query clearing.

Run `npm run build` and `npm test` after implementation.

## Operator Verification

1. Open `/stats` in a clean browser session and confirm no leaderboard requests appear in the network panel.
2. Filter by Deaths & Danger, search for “boss,” clear both controls, and verify URL/history behavior.
3. Open each implemented statistic directly by URL and confirm the intended endpoint is the only leaderboard request.
4. Change Players/All on an event statistic, navigate among detail views, and verify the selection persists.
5. Verify a standard and privileged account still receive their correct visibility scopes.
6. Test keyboard-only navigation, screen-reader landmarks/current item, 200% zoom, and a 320-pixel viewport.
7. Refresh a detail URL through the production reverse proxy and confirm the SPA fallback works.

## Non-Goals

- redesigning individual leaderboard tables or their SQL;
- implementing any of the planned statistic specifications;
- live winner previews on the hub;
- user favorites, custom ordering, recently viewed history, or notifications;
- server-driven navigation metadata or an administrative category editor;
- infinite scrolling, horizontal statistic carousels, or loading every panel in the background;
- changing authentication, account visibility, database grants, statistics APIs, or module event semantics.
