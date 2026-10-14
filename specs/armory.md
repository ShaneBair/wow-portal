# Authenticated Character Armory

Status: Implemented

Repository: `wow-portal`

## Outcome

Authenticated portal users can open `/armory`, select any visible non-bot character, and inspect its currently saved equipped gear and talent loadouts. Account visibility exclusions apply before characters are listed or loaded. Hidden accounts remain visible only to configured bypass accounts.

## Behavior

- `GET /api/armory` lists bounded, visible, non-deleted, non-bot characters.
- `GET /api/armory/:characterId` returns one character's identity, 19 equipment slots, and one or two talent loadouts.
- Both endpoints require a valid portal session, use the universal account-visibility middleware, are rate limited, and return `Cache-Control: no-store`.
- Character IDs are treated as opaque decimal identifiers. Detail lookup rechecks visibility and never trusts client-supplied account, name, race, or class data.
- Equipment comes from `character_inventory`, `item_instance`, and `item_template`. Only bag `0`, slots `0` through `18`, and item instances owned by the selected character are accepted.
- Items with AzerothCore scaling metadata use the selected character's current level, capped by the distribution's maximum level, to calculate attributes, armor, spell power, weapon damage, speed, and DPS with the same masks and arithmetic as the deployed core. The checked-in scaling catalog is generated from the deployed `ScalingStatDistribution.dbc` and `ScalingStatValues.dbc` files.
- Talent assignments come from `character_talent`. Names, ranks, positions, and tree names come from a checked-in catalog generated from the deployed WotLK 3.3.5a DBC files.
- Unknown custom talent spells remain visible with a safe spell-ID fallback instead of failing the whole character.

## UI

- Armory navigation is visible only while authenticated.
- `/armory` has a character picker and supports direct routes at `/armory/:characterId`.
- Character names on Stats, Roster, and Players Online link through `/armory?character=<name>`. The Armory resolves that name only against its authenticated, visibility-filtered character list and replaces the URL with the canonical `/armory/:characterId` route. Bot statistic rows remain plain text because bots are excluded from the Armory.
- A signed-out user following one of these links returns to the same character lookup after authentication. Only the single bounded `character` query parameter is accepted as an Armory login return target.
- The character summary shows name, level, race, class, and active talent loadout.
- Equipment renders every normal character slot, including empty slots.
- Hovering or focusing an equipped item shows an accessible, dark game-style tooltip containing its server-owned name, quality, item level, slot/type, armor, damage, stats, sockets, requirements, durability, and description when present.
- Tapping or clicking an equipped item opens the same information in an accessible dialog with a WotLK Wowhead link. The portal does not execute third-party scripts or send account/character identifiers to Wowhead.
- Talents are grouped by saved loadout and tree. Each talent shows its learned rank and links to the corresponding WotLK Wowhead spell page.
- The page has loading, empty, not-found, expired-session, rate-limit, and dependency-failure states and remains usable on narrow screens.

## Data and Security

- No schema migration or database write is required.
- The portal database account receives only the documented column-scoped reads in `migrations/007_grant_armory_permissions.sql.example`.
- API responses omit account IDs/logins, item-instance GUIDs, raw enchantment strings, database names, raw SQL errors, and deleted/bot/hidden character records.
- Item descriptions and character names are rendered as text, never injected HTML.
- Responses are bounded to 2,500 characters, 19 equipment rows, two talent loadouts, and a safe maximum number of learned talents.
- The UI labels data as the latest saved server state; an online character can change after the response.

## Verification

- Server tests cover query scoping, visibility exclusions, row bounds, static and level-scaled item/stat mapping, talent grouping, ownership consistency, malformed data, authentication, rate limiting, no-store headers, and redacted failures.
- Client tests cover authenticated navigation, selection/direct routing, equipment slots, hover/focus tooltip content, tap dialog, Wowhead URLs, dual-spec talents, loading/error/session-expiry states, and malformed response rejection.
- Run `npm test`, `npm run build`, and `docker compose config`.
- Before deployment, apply the grant example with the deployed schema/user/host values and test representative empty, low-level, dual-spec, and fully geared characters.
