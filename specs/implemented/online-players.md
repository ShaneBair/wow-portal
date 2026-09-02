# Online Human Players Panel

Status: Ready for implementation  
Provider contract: `mod-player-statistics/specs/online-players.md`, `PLAYERSTATS_ONLINE_V1`

## Problem

Visitors to the WoW portal cannot currently see which real people are playing. AzerothCore's existing `server info` response provides general server availability but does not provide a reliable human-only roster for the Playerbots server.

## User Outcome

The home page contains a responsive panel that lists every currently online human-controlled character with:

- account login;
- character name;
- race;
- class;
- level;
- friendly zone label.

Bots never appear. Human-controlled GMs appear like other players.

## Accepted Access Decision

For this version, the panel and its API are intentionally unauthenticated, matching the rest of the current portal. The account login is therefore visible to anyone who can reach the portal.

This is an explicit product decision, not an accidental leak. Account logins are credential identifiers and their public display increases account-discovery risk. Revisit this decision before broader public exposure or when portal authentication is introduced. Do not expose any additional account fields because of this exception.

## Current Behavior

- `GET /api/status` executes AzerothCore's `server info` command and returns `{ online: boolean }`.
- `POST /api/register` creates an account through SOAP after invite-code validation.
- The SOAP service currently returns raw response bodies to the integration layer; it does not parse a structured roster.
- The page has registration and connection panels, with no online-player panel.
- The browser checks server status every 30 seconds.
- The portal has no direct AzerothCore database connection and must not gain one for this feature.

## Provider Contract

The portal executes this fixed command through the existing private SOAP connection:

```text
playerstats online
```

The module returns one line beginning with:

```text
PLAYERSTATS_ONLINE_V1 
```

The remainder of that line is the version 1 JSON object defined by the module specification.

The module is authoritative for live-session enumeration, `IsBot()` filtering, account resolution, and location resolution. The portal must not attempt a second bot classification based on account names, IDs, or historical events.

## Backend Design

### SOAP parsing

Refactor the AzerothCore integration so callers can obtain the decoded text result of a successful SOAP `executeCommand` response rather than inspecting raw XML.

- Parse SOAP XML with a maintained XML parser suitable for Node.js; do not use a regular expression as the primary XML parser.
- Adding `fast-xml-parser` as a production dependency is acceptable for this feature.
- Preserve the existing eight-second request timeout and SOAP-fault detection.
- Decode XML entities through the parser.
- Continue to keep SOAP credentials and raw failure bodies server-side.
- Preserve account registration and status behavior while refactoring shared SOAP handling.

### Roster parsing and validation

Add a focused online-roster service that:

1. executes the exact fixed command `playerstats online`;
2. finds exactly one `PLAYERSTATS_ONLINE_V1 ` marker line;
3. parses the JSON following the marker;
4. validates the top-level object and every required player field at runtime;
5. rejects duplicate markers, unsupported versions, malformed JSON, invalid types, impossible numeric ranges, or an unreasonable payload size;
6. maps WotLK race and class IDs to friendly names;
7. removes integration-only IDs before constructing the browser response;
8. sorts players case-insensitively by character name, with account login as a stable tie-breaker.

Unknown but numeric race or class IDs do not fail the full roster. Display them as `Unknown race (<id>)` or `Unknown class (<id>)` and log a concise warning.

### Cache and request coalescing

- Cache a successful validated roster for 10 seconds in the portal process.
- Concurrent requests during a refresh share one in-flight SOAP promise.
- Do not serve a stale roster after a refresh failure; return the unavailable response so offline players are not shown as current.
- A short failure backoff of up to three seconds may be used to prevent a tight retry loop.
- The cache is per portal process and requires no persistence.
- Browser responses set `Cache-Control: no-store`; the deliberate server-side cache remains the only roster cache.

## HTTP API

Add:

```text
GET /api/online-players
```

Authentication: none for this version.

Successful response, including when no humans are online:

```json
{
  "generatedAt": "2026-08-22T16:00:00.000Z",
  "count": 1,
  "players": [
    {
      "accountLogin": "SHANE",
      "characterName": "Thalgrim",
      "race": "Dwarf",
      "class": "Paladin",
      "level": 42,
      "location": "Stranglethorn Vale"
    }
  ]
}
```

Public response requirements:

- Do not return account ID, character GUID, map ID, zone ID, or area ID.
- Do not return bot flags because bots have already been excluded.
- Do not return email, IP address, latency, GM status, security level, coordinates, or raw SOAP output.
- `count` must equal `players.length`.
- Convert the provider's Unix timestamp to an ISO 8601 UTC string.
- Return a successful `200` response with an empty `players` array when the module reports zero humans.

Unavailable response:

```json
{
  "error": "Online player information is temporarily unavailable."
}
```

Return HTTP `503` when SOAP is unreachable, the command is missing or rejected, the marker/version is unsupported, or the payload is malformed. Do not translate these failures into an empty roster.

Apply a modest per-client read limit that comfortably permits the 30-second browser polling interval. The internal cache and single-flight behavior remain the primary protection for AzerothCore.

## WotLK Display Mappings

Race IDs:

- `1`: Human
- `2`: Orc
- `3`: Dwarf
- `4`: Night Elf
- `5`: Undead
- `6`: Tauren
- `7`: Gnome
- `8`: Troll
- `10`: Blood Elf
- `11`: Draenei

Class IDs:

- `1`: Warrior
- `2`: Paladin
- `3`: Hunter
- `4`: Rogue
- `5`: Priest
- `6`: Death Knight
- `7`: Shaman
- `8`: Mage
- `9`: Warlock
- `11`: Druid

Keep these mappings in a small typed domain module rather than embedding them in route or browser rendering code.

## User Interface

Add a full-width `Players Online` panel below the existing registration/connection grid.

### Populated state

- Show the human-player count in or beside the heading.
- On wider screens, use a semantic table with columns: Account, Character, Race, Class, Level, Location.
- On narrow screens, transform each row into a readable card or stacked layout without horizontal page scrolling.
- Use text nodes/`textContent` for all API values. Do not construct HTML from account, character, or location strings.
- Keep visual styling consistent with the existing dark portal design.
- Account and character must remain distinguishable without relying on color alone.

### Other states

- Initial loading: `Checking who is online...`
- Empty success: `No real players are online.`
- API unavailable: `The online roster is temporarily unavailable.`
- Preserve the last successful panel only until a failed refresh is received; then replace it with the unavailable state rather than presenting stale presence as current.

The roster refreshes immediately on page load and every 30 seconds afterward. Prevent overlapping browser refreshes. A roster failure must not break account registration or the existing server-status indicator.

## Privacy and Security Requirements

- Account login exposure is limited to the explicitly requested field. Do not expose account IDs or other account metadata.
- Keep SOAP and all AzerothCore details behind the server-side route.
- Do not log a complete roster during normal operation.
- Errors may identify the command/version but must not include account logins, credentials, raw SOAP envelopes, or internal stack traces in browser responses.
- Keep SOAP on the private Docker network and keep the portal's direct host port loopback-bound.
- If portal authentication is later added, place this route and panel behind it and update this specification's accepted access decision.

## Failure and Compatibility Behavior

- Module not yet deployed: show unavailable, not empty.
- AzerothCore offline or SOAP timeout: show unavailable.
- Unsupported marker version: show unavailable and log the received version without logging the roster body.
- One invalid player row: reject the entire payload so contract drift is visible rather than silently hiding a player.
- Unknown numeric race/class: keep the row using the documented fallback label.
- Unknown location provided as `Unknown`: display it normally.
- Extra unknown JSON fields: ignore them for forward-compatible version 1 additions.

## Out of Scope

- Portal login, sessions, or role-based access control.
- Hiding human GMs.
- Showing bots, total bot counts, or differentiating random bots from altbots.
- Character profiles, guilds, factions, playtime, equipment, status messages, or links.
- Exact coordinates or live map tracking.
- Direct database access.
- WebSockets or server-pushed presence updates.
- Changing the existing server-status panel.

## Acceptance Criteria

- The home page displays the new full-width panel without breaking the existing layout.
- A human-controlled character appears with the correct account login, character name, race, class, level, and friendly location.
- Human-controlled GMs appear normally.
- Bots appear in neither the provider contract nor the public API.
- Multiple human characters appear as separate rows sorted by character name.
- Zero humans produces the empty success state.
- Provider/SOAP failure produces the unavailable state and HTTP `503`, not a false empty state.
- Desktop and mobile layouts remain readable and accessible.
- The browser refreshes every 30 seconds without overlapping requests.
- Multiple simultaneous API callers produce at most one SOAP roster request per cache refresh.
- Public API responses contain none of the prohibited integration/account fields.
- Account registration, `/api/status`, `/health`, and existing connection instructions continue to work.
- `npm run build` passes under strict TypeScript settings.

## Automated Verification

Add focused tests for:

- successful SOAP result extraction and XML entity decoding;
- SOAP fault and malformed XML handling;
- marker extraction, including missing and duplicate markers;
- valid empty and populated version 1 payloads;
- malformed JSON and invalid field types/ranges;
- race/class mappings and unknown numeric fallbacks;
- stripping integration-only IDs from the public response;
- successful cache reuse and concurrent request coalescing;
- refresh failure returning unavailable rather than stale roster data;
- API `200` empty/populated and `503` failure behavior.

Use mocked SOAP responses for automated tests. Live SOAP verification is a separate operator test and must not create accounts or mutate game state.

## End-to-End Verification

1. Deploy the compatible module build and confirm `playerstats online` works through the portal SOAP account.
2. Load the portal with no human players and verify the empty state.
3. Log in a normal human character and verify the displayed values.
4. Enable GM mode and verify the same character remains visible.
5. Bring random bots and an altbot online and verify they do not appear.
6. Change the human character's zone and level and verify the next refresh updates.
7. Log the human out and verify removal within the next refresh.
8. Stop or disconnect the worldserver and verify the unavailable state.
9. Test the panel at desktop and narrow mobile widths.
10. Inspect the browser response and logs to confirm no prohibited fields or raw SOAP content are exposed.
