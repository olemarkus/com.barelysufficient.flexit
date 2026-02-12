# Agent Notes for com.barelysufficient.flexit

## Purpose
This Homey app discovers Flexit Nordic units on the LAN and exposes each as a single Homey device
with class `airtreatment`, combining thermostat controls (setpoint, temperatures, heater power)
and fan controls (fan mode, humidity, RPM, filter life) in one device per physical unit.

The goals are reliability, clean code, and correct BACnet/IP behavior.

## Discovery (Proprietary UDP Multicast)
- TX multicast: `224.0.0.180:30000`
- RX multicast: `224.0.0.181:30001`
- TX uses TTL=1 (link-local only).
- Discovery payload must be **exactly 104 bytes** or units do not respond.
- `lib/flexitDiscovery.ts` builds the discovery request and parses replies.

## BACnet/IP usage (bacstack)
- Library: `bacstack` (BACnet/IP)
- We talk directly to a unit IP address and BACnet port.
- **Important:** bacstack always sends to the client’s configured port. We therefore create a **separate client per BACnet port** and reuse it (see `lib/bacnetClient.ts`).
- BACnet property ID 85 = `presentValue`.
- All values are read with `readPropertyMultiple` and written with `writeProperty`.
- Avoid passing incorrect `maxApdu` values: bacstack expects the enum values (e.g. `BacnetEnums.MaxApduLengthAccepted.OCTETS_1476`), not raw byte lengths.
- Flexit BACnet docs require **priority 13** for writes on objects with priority arrays (used for setpoint and fan modes).

### Known object IDs (Flexit mapping)
Used in `lib/UnitRegistry.ts`:
- AV 2:1994 -> Setpoint (REAL)
- AI 0:4 -> Supply Temp (REAL)
- AI 0:1 -> Outdoor Temp (REAL)
- AI 0:11 -> Exhaust Temp (REAL)
- AI 0:59 -> Extract Temp (REAL, primary on some models)
- AI 0:95 -> Extract Temp (REAL, alternate on some models)
- AI 0:96 -> Humidity (REAL)
- AV 2:194 -> Heater Power (REAL, kW; multiply by 1000)
- AI 0:5 -> Fan RPM Supply
- AI 0:12 -> Fan RPM Extract
- AO 1:3 -> Fan Speed % Supply
- AO 1:4 -> Fan Speed % Extract
- AV 2:285 -> Filter Time
- AV 2:286 -> Filter Limit
- BV 5:50 -> Mode Home/Away (ENUMERATED)
- High/Fireplace are treated as read-only over BACnet until a confirmed writable control point is identified.
- BV 5:15 -> Rapid ventilation active (status)
- BV 5:400 -> Fireplace ventilation active (status)
- AV 2:2031 -> Remaining rapid ventilation time (used to report High)
- AV 2:2038 -> Remaining fireplace ventilation time (used to report Fireplace)

When adding new points, update both the poll list and `distributeData` mappings.

## What We Want to Achieve
- Reliable multicast discovery and pairing.
- Correct BACnet/IP reads/writes with proper tagging and options.
- Stable device IDs based on serial numbers.
- Clear logging and safe error handling.
- Good test coverage and enforceable code quality gates.

## Local Conventions
- Typescript `strict` is enabled (keep types explicit when needed).
- ESLint is required (see scripts).
- Tests must pass with coverage thresholds in `package.json`.
- Run `npm run validate` regularly after changes (lint + tests + `homey app validate`).

## Useful scripts
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm start` (runs `homey app run --remote`)
