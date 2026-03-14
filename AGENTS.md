# Agent Notes for com.barelysufficient.flexit

## Purpose
This Homey app controls Flexit Nordic ventilation units via two transports:
- **Local (BACnet/IP):** Discovers units on the LAN via proprietary UDP multicast.
- **Cloud:** Connects via the Flexit cloud using Flexit GO account credentials.

Both drivers provide identical capabilities and behavior — only the transport differs.

## Architecture
- `lib/UnitRegistry.ts` — Central state manager for all units. Handles both transports. All device operations go through Registry.
- `lib/FlexitNordicBaseDevice.ts` — Shared base class for both drivers (settings handling, capability listeners, suppression logic).
- `lib/flexitCloudClient.ts` — Flexit cloud API client (auth, read/write datapoints).
- `drivers/nordic/device.ts` — BACnet driver (extends base, adds BACnet-specific timeout/error handling).
- `drivers/nordic-cloud/device.ts` — Cloud driver (extends base, adds token persistence).

## Rules

### No logic duplication across drivers
Shared behavior (settings handling, capability listeners, state management) belongs in the base class (`FlexitNordicBaseDevice`) or `UnitRegistry` — never copied between driver files. Only transport-specific code lives in individual drivers:
- BACnet: timeout warnings, connection label normalization, error message formatting
- Cloud: token restore/persist, cloud client lifecycle

### Feature parity
Both drivers must support the same capabilities, settings, flow cards, and state management. When adding behavior to one driver, verify it applies to both. If it does, implement it in shared code.

### Named constants over magic numbers
Use `VENTILATION_MODE_VALUES`, `TRIGGER_VALUE`, `COOKER_HOOD_ON`, etc. — not raw numeric literals.

### BACnet details
BACnet object IDs, discovery protocol, and point catalog details are documented in `localdocs/`. Consult those when working on BACnet-specific transport code. Key reference: `docs/bacnet_point_catalog.json`.

When adding new BACnet points, update both the poll list and `distributeData` mappings in `UnitRegistry.ts`.

## Local Conventions
- TypeScript `strict` is enabled.
- ESLint max-warnings=0 is enforced.
- Tests use mocha + chai + sinon (NOT jest). Device tests use proxyquire.
- Any feature touching BACnet behavior must include end-to-end coverage using the fake unit.
- Run `npm run validate` after changes (lint + tests + `homey app validate`).
- `README.txt` is app-store/user-facing only; no developer/test instructions.
- Commit messages: imperative present tense, concise. Body required for non-trivial changes.
- Keep PR branches squashed to a single commit before merge/push unless requested otherwise.

## Useful scripts
- `npm run lint` / `npm run lint:fix`
- `npm run typecheck`
- `npm test` — typecheck + mocha tests with c8 coverage
- `npm run validate` — lint + test + homey app validate
- `npm start` — runs `homey app run --remote`
- `npm run fake-unit:start` — standalone fake Nordic unit
- `npm run fake-unit:cli` — CLI for the fake unit API
- `homey app build` — regenerates app.json from compose files
