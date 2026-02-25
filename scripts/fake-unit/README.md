# Fake Flexit Nordic Unit

Standalone simulator for a Flexit Nordic BACnet/IP unit with:

- Proprietary UDP multicast discovery (`224.0.0.180:30000` -> reply on `224.0.0.181:30001`)
- Flexit GO BACnet private-transfer discovery (vendor `7`, service `515` -> `516`)
- BACnet/IP endpoint handling `readProperty`, `readPropertyMultiple`, `writeProperty`, `writePropertyMultiple`, `whoIs`
- HTTP control API for e2e tests
- CLI for manual smoke testing

The simulator intentionally separates:

- documented BACnet points/properties (used by Homey emulation), and
- proprietary compatibility shims (used only so Flexit GO can complete login/discovery flows).

Unknown objects/properties are returned as BACnet errors unless explicitly listed as compatibility shims.

## Start

```bash
npm run fake-unit:start -- --bind 192.168.1.50 --advertise-ip 192.168.1.50
```

Useful options:

- `--bacnet-port 47808`
- `--api-port 18080`
- `--serial 800111-123456`
- `--device-id 123456` (optional; default is derived from serial to avoid collisions)
- `--name HvacFnct21y_A`
- `--time-scale 60` (1 simulated minute per real second)
- `--quiet` (disable discovery + BACnet traffic logs)
- `--go-login-key ABCDEF-GHJKL-MNPQR-STUVW-XYZ12` (override proprietary 264:2:4743 response)
- `--netmask 255.255.255.0`
- `--gateway 192.168.1.1`
- `--discovery-platform-code 160100F2C5`
- `--discovery-platform-version POS3.67`
- `--discovery-fw-info 'FW=03.39.03.38:BL=00.05.02.0003;SVS-300.4:SBC=13.24;'`
- `--discovery-interface Eth`
- `--discovery-app-version 2.11.0`

## API

- `GET /health`
- `GET /summary`
- `POST /feature/mode` body: `{ "mode": "home|away|high|fireplace" }`
- `POST /feature/setpoint` body: `{ "value": 20.5, "target": "home|away" }`
- `POST /feature/rapid/start` body: `{ "minutes": 15 }` (minutes optional)
- `POST /feature/fireplace/start` body: `{ "minutes": 20 }` (minutes optional)
- `POST /feature/filter/replace`
- `POST /feature/filter/set` body: `{ "operatingHours": 1000, "limitHours": 4380 }`

Debug endpoints (optional, BACnet-oriented):
- `GET /debug/state`
- `GET /debug/points`
- `GET /debug/manifest` (shows documented surface and proprietary compatibility surface separately)
- `POST /debug/advance` body: `{ "seconds": 300 }`
- `POST /debug/write` body: `{ "type": 2, "instance": 1994, "value": 21, "priority": 13 }`

## CLI

```bash
npm run fake-unit:cli -- summary
npm run fake-unit:cli -- mode high
npm run fake-unit:cli -- setpoint 21.5 home
npm run fake-unit:cli -- rapid 20
npm run fake-unit:cli -- fireplace 15
npm run fake-unit:cli -- filter status
npm run fake-unit:cli -- filter age 1200
npm run fake-unit:cli -- filter replace
```

Debug commands are still available when needed:

```bash
npm run fake-unit:cli -- state
npm run fake-unit:cli -- points
npm run fake-unit:cli -- write 2 1994 22 13
npm run fake-unit:cli -- advance 600
```

By default the CLI talks to `http://127.0.0.1:18080`. Override with:

```bash
npm run fake-unit:cli -- status --api http://192.168.1.50:18080
```

## Read-only probe against a real unit

To inspect what a real unit returns for specific object/property codes (including proprietary ones):

```bash
npm run bacnet:read-probe -- \
  --ip 192.168.1.100 \
  --query 264:2:4743 \
  --query DEVICE:2:SYSTEM_STATUS \
  --query DEVICE:2:DESCRIPTION \
  --query DEVICE:2:MODEL_NAME \
  --json
```

## Flexit GO compatibility

Compatibility is best-effort:

- Discovery replies include serial, endpoint, MAC, firmware-like tokens (legacy text + structured payload).
- BACnet `whoIs/iAm` and device object properties are implemented.
- BACnet private-transfer discovery requests are logged and answered.
- Proprietary compatibility points used by Flexit GO login are implemented separately.
- Current proprietary object shims include `264:2:4743`, `AV 8/60/126/130/1831/1833/1834/1835/1836/1837/1838/1839/1840/1841/1842/1843/1844/1919/2090/2096/2113/2114/2115/2118/2119/2120/2121/2122`, `AV 2275`, `MSV 7/18/340/341/343/344`, and `BV 474`.
- Current proprietary property overlays include `5093` on `MSV 42`, `BV 50`, and `BV 445`; proprietary AV range hints `5036/5037` are implemented on compatibility `AV 1835..1844`.
- External `7:516` identification payloads observed on LAN are logged (hex + ASCII) to aid emulation.
- `7:516` responses mimic observed real-unit structure and echo the request `ABTMobile:<uuid>` token.

If Flexit GO uses extra proprietary BACnet points not listed by `/manifest`, those requests are expected to fail until explicitly implemented.
