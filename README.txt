Flexit Nordic (Homey Pro) - scaffold

What this scaffold does
- Discovers Flexit units using proprietary multicast discovery:
  - TX: 224.0.0.180:30000 (src port 30000, TTL=1)
  - RX: 224.0.0.181:30001 (IGMP join on selected interface, TTL=1)
- Adds a Homey device with stable ID derived from serial.
- Writes the "Home air temperature setpoint" via BACnet/IP using bacstack:
  - Object: AV 2:1994
  - Property: presentValue (85)
  - Application tag: REAL
  - Plain write (no options argument to writeProperty).

Notes
- bacstack MUST be in dependencies (not devDependencies) so it exists on Homey at runtime.
- Some bacstack versions crash if you pass an options argument (even undefined) to writeProperty.
  This scaffold uses the no-options ("plain write") signature.
