# Stats Population Filter

Status: Ready for implementation  
Repository: `wow-portal`  
Depends on: `specs/react-frontend-foundation.md`, `specs/site-navigation.md`  
Consumed by: `specs/character-deaths-leaderboard.md`

## Problem

The Playerbots server records both human-controlled and bot-controlled activity. Every Stats panel needs one consistent page-level decision about whether bot activity is excluded or included. Per-panel filters would be repetitive and could leave the page showing incompatible populations at the same time.

## User Outcome

The Stats page has one prominent filter that switches the entire page between:

- `Players only`
- `Players + bots`

The default is Players only. The selection is reflected in the URL so it survives refreshes, can be bookmarked, participates in browser history, and becomes an input to every current and future Stats query.

## Domain Semantics

The filter describes how a character was controlled when the recorded event occurred.

- `players` includes events where the statistic's applicable event-time bot flag is `0`.
- `all` includes events from both flag values `0` and `1`.

For actor-centric statistics, the applicable flag is normally `actor_is_bot`. For a statistic in which the subject is an event target, its specification must identify the corresponding target flag.

Do not treat a character as permanently human or permanently a bot. An alt character may have human-controlled and bot-controlled events at different times.

There is no Bots-only option in this version.

## URL Contract

The canonical query parameter is:

```text
population=players
population=all
```

Examples:

```text
/stats?population=players
/stats?population=all
```

Rules:

- Missing `population` initializes to `players`.
- Any value other than exactly `players` or `all` initializes to `players`.
- Multiple `population` parameters are invalid browser input and initialize to `players`.
- Normalize missing, repeated, or invalid input to one `population=players` parameter with a history replacement and no document reload.
- User changes create a browser-history entry and do not reload the document.
- Preserve unrelated query parameters and their values so future Stats filters can coexist.
- Browser Back and Forward navigation update the visible control and all consuming Stats queries.
- The normalized URL is the single source of truth; do not maintain a second independent population value.

Use React Router's URL/search-parameter APIs. Do not call `window.history` directly from visual components.

## Shared React Contract

Define one typed domain value:

```ts
type StatsPopulation = "players" | "all";
```

Create a focused Stats population helper or hook that owns:

- reading the search parameter;
- normalization;
- updating the router search parameters;
- exposing the effective typed value;
- preserving unrelated parameters.

The Stats page supplies the effective population to all Stats panels through normal React composition, a route outlet context, or a narrowly scoped Stats context. Prefer the smallest approach that avoids prop drilling as the page grows.

Do not use:

- a custom DOM event;
- global mutable browser state;
- Redux or another general state store;
- a TanStack Query cache entry as the population source of truth;
- cookies, server sessions, or local storage.

Every population-dependent TanStack Query key must include the effective value, for example:

```text
["stats", "deaths", "players"]
["stats", "deaths", "all"]
```

This prevents one population's response from satisfying or overwriting the other population's view.

## User Interface

Replace the Stats placeholder with a page-level controls region followed by a content region that may remain empty until the deaths-leaderboard specification is implemented.

Use an accessible `fieldset` and native radio inputs, visually styled as a segmented control:

```text
Show
[ Players only ] [ Players + bots ]
```

Requirements:

- The group has a visible legend or accessible group label.
- Labels are exactly `Players only` and `Players + bots` unless copy review changes the UI and tests together.
- Players only is selected by default.
- The selected state is visibly clear and does not rely only on color.
- Native keyboard interaction works: Tab reaches the group and arrow keys change the radio choice according to browser behavior.
- The control remains usable at narrow widths and may stack if necessary.
- Include concise helper text explaining that Players + bots includes Playerbot-controlled activity.
- Changing the selection must not move focus away from the control.

## Server API Filter Convention

All Stats APIs introduced after this specification use the same query parameter and values:

```text
?population=players
?population=all
```

Server routes validate the value independently. Browser normalization is not a security or correctness boundary.

API convention:

- Missing value defaults to `players`.
- Exactly one `players` or `all` value is accepted.
- Any other supplied or repeated value receives HTTP `400` with a generic validation error.
- Never interpolate the raw query-string value into SQL.

This specification introduces the convention but does not itself add a Stats API.

## Query Transition Behavior

When the effective population changes:

- every mounted population-dependent panel receives the new typed value during the same React update;
- each panel uses a population-specific query key and request parameter;
- obsolete requests receive TanStack Query's abort signal through the API client where possible;
- a late response for the previous population must never render under the new selection;
- one panel's error does not prevent other panels from requesting or rendering the new population;
- previous-population rows are not retained beneath the newly selected label while the new query loads.

The filter remains usable when every Stats API is unavailable.

## Styling

- Use the shared React stylesheet and existing design language.
- Keep controls visually subordinate to the Stats heading but above every Stats panel.
- Use existing border radii, colors, typography, and focus treatment.
- Provide hover, checked, focus-visible, and disabled treatments where applicable.
- Do not hide the real inputs in a way that removes them from the accessibility tree or keyboard order.

## Failure Behavior

- The control itself has no network dependency.
- Invalid URL input is normalized to Players only rather than displayed as a third state.
- If a panel fails to load after a population change, the selected control and URL remain correct.
- One panel failure must not disable or mask another panel.

## Security and Privacy

- The filter and Stats route remain unauthenticated, matching the accepted portal access model.
- Do not use the filter to authorize data. Each API defines which fields it can return publicly.
- Do not expose database identifiers or SQL-oriented bot flags in visible helper text.
- Server-side population validation remains mandatory.

## Out of Scope

- Death or other statistic data.
- Bots-only filtering.
- Date ranges, realm selection, faction selection, per-table search, column sorting, or pagination.
- Persisting a preference independently of the URL.
- Authentication or private Stats views.
- Changing module bot classification or historical event flags.

## Acceptance Criteria

- The Stats route displays the population filter above its content region.
- Players only is selected for missing, repeated, or invalid URL input.
- Valid `players` and `all` values restore the correct selection on direct load and refresh.
- Invalid input is normalized through router history replacement without a full reload.
- Selecting either option updates the URL and creates useful browser history without a full reload.
- Browser Back and Forward update the control and every population-dependent query.
- Unrelated query parameters are preserved.
- Population-dependent query keys and requests include the normalized value.
- Previous-population results never display beneath a new population selection.
- Keyboard and screen-reader users can identify and change the selected option.
- The control works at desktop and mobile widths.
- Home does not render or initialize the Stats filter.
- `npm run build` and `npm test` pass.

## Automated Verification

Use React Testing Library with a memory or browser-compatible test router. Cover:

- `/stats` with missing, `players`, `all`, invalid, and repeated values;
- normalization to one `population=players` parameter;
- preservation of unrelated parameters;
- radio state and accessible group naming;
- user selection creating the expected URL state;
- Back and Forward transitions;
- a test consumer receiving exactly the effective typed value;
- distinct population-dependent query keys;
- no previous-population result displayed during a transition;
- independent panel failure behavior.

Add focused server helper tests when the first Stats API implements the matching query-value validation.

## Manual Verification

1. Load `/stats`, `/stats?population=players`, `/stats?population=all`, and invalid/repeated forms directly.
2. Confirm missing or invalid input becomes one `population=players` parameter without reloading.
3. Change the control and inspect the URL.
4. Add unrelated query parameters and confirm they survive population changes.
5. Exercise browser Back and Forward across several changes.
6. Inspect population-dependent network requests when a consuming panel exists.
7. Test keyboard, screen reader labeling, and narrow-screen behavior.
8. Run the portal build and both automated test suites.
