import os from 'os';

import { FakeApiServer } from './fake-unit/apiServer';
import { FakeBacnetServer } from './fake-unit/bacnetServer';
import { DiscoveryResponder } from './fake-unit/discoveryResponder';
import {
  DEFAULT_BACNET_DEVICE_ID,
  DEFAULT_DEVICE_NAME,
  DEFAULT_FIRMWARE,
  DEFAULT_MAC,
  DEFAULT_MODEL_NAME,
  DEFAULT_SERIAL,
  DEFAULT_VENDOR_ID,
  DEFAULT_VENDOR_NAME,
  pointKey,
  SUPPORTED_POINTS,
} from './fake-unit/manifest';
import { FakeNordicUnitState } from './fake-unit/state';

export interface CliOptions {
  bindAddress?: string;
  advertiseAddress?: string;
  logTraffic: boolean;
  flexitGoLoginKey?: string;
  networkMask?: string;
  gateway?: string;
  discoveryPlatformCode?: string;
  discoveryPlatformVersion?: string;
  discoveryFirmwareInfo?: string;
  discoveryInterfaceName?: string;
  discoveryAppVersion?: string;
  apiHost: string;
  apiPort: number;
  bacnetPort: number;
  serial: string;
  deviceId: number;
  deviceName: string;
  modelName: string;
  firmware: string;
  mac: string;
  vendorName: string;
  vendorId: number;
  timeScale: number;
  periodicIAmMs: number;
  tickMs: number;
}

interface InterfaceInfo {
  address: string;
  netmask: string;
  mac?: string;
}

export interface RunningFakeUnit {
  shutdown: () => void;
  state: FakeNordicUnitState;
  discovery: DiscoveryResponder;
  bacnetServer: FakeBacnetServer;
  apiServer: FakeApiServer;
}

export function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function deriveDeviceIdFromSerial(serial: string): number {
  const digits = serial.replace(/[^0-9]/g, '');
  const asNumber = Number(digits);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return 1000;

  // BACnet device instance is 22 bits: 0..4194303. Keep away from low defaults (e.g. 2)
  // to avoid collisions with real units on the same LAN.
  const floor = 1000;
  const range = 4194304 - floor;
  return floor + (Math.trunc(asNumber) % range);
}

function firstIPv4Address(): string | undefined {
  const interfaces = os.networkInterfaces();
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return undefined;
}

function listIPv4Interfaces(): InterfaceInfo[] {
  const interfaces = os.networkInterfaces();
  const out: InterfaceInfo[] = [];
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      out.push({
        address: info.address,
        netmask: info.netmask,
        mac: info.mac,
      });
    }
  }
  return out;
}

function pickInterfaceInfo(address?: string): InterfaceInfo | undefined {
  const all = listIPv4Interfaces();
  if (!address) return all[0];
  return all.find((info) => info.address === address);
}

export function parseArgs(argv: string[]): CliOptions {
  const args = new Map<string, string>();
  const valueFlags = new Set<string>([
    '--bind',
    '--advertise-ip',
    '--go-login-key',
    '--netmask',
    '--gateway',
    '--discovery-platform-code',
    '--discovery-platform-version',
    '--discovery-fw-info',
    '--discovery-interface',
    '--discovery-app-version',
    '--api-host',
    '--api-port',
    '--bacnet-port',
    '--serial',
    '--device-id',
    '--name',
    '--model',
    '--firmware',
    '--mac',
    '--vendor-name',
    '--vendor-id',
    '--time-scale',
    '--periodic-iam-ms',
    '--tick-ms',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith('--')) continue;
    const next = argv[index + 1];
    if (valueFlags.has(part)) {
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${part}`);
      }
      args.set(part, next);
      index += 1;
      continue;
    }
    args.set(part, 'true');
  }

  const bindAddress = args.get('--bind');
  const discoveredAddress = firstIPv4Address();
  const advertiseAddress = args.get('--advertise-ip') ?? bindAddress ?? discoveredAddress ?? '127.0.0.1';
  const selectedInterface = pickInterfaceInfo(bindAddress ?? advertiseAddress);
  const autoNetmask = selectedInterface?.netmask;
  const autoMac = selectedInterface?.mac;
  const serial = args.get('--serial') ?? DEFAULT_SERIAL;
  const deviceIdArg = args.get('--device-id');
  const deviceId = deviceIdArg ? parseNumber(deviceIdArg, DEFAULT_BACNET_DEVICE_ID) : deriveDeviceIdFromSerial(serial);

  return {
    bindAddress,
    advertiseAddress,
    logTraffic: args.get('--quiet') !== 'true',
    flexitGoLoginKey: args.get('--go-login-key'),
    networkMask: args.get('--netmask') ?? autoNetmask,
    gateway: args.get('--gateway'),
    discoveryPlatformCode: args.get('--discovery-platform-code'),
    discoveryPlatformVersion: args.get('--discovery-platform-version'),
    discoveryFirmwareInfo: args.get('--discovery-fw-info'),
    discoveryInterfaceName: args.get('--discovery-interface'),
    discoveryAppVersion: args.get('--discovery-app-version'),
    apiHost: args.get('--api-host') ?? '127.0.0.1',
    apiPort: parseNumber(args.get('--api-port'), 18080),
    bacnetPort: parseNumber(args.get('--bacnet-port'), 47808),
    serial,
    deviceId,
    deviceName: args.get('--name') ?? DEFAULT_DEVICE_NAME,
    modelName: args.get('--model') ?? DEFAULT_MODEL_NAME,
    firmware: args.get('--firmware') ?? DEFAULT_FIRMWARE,
    mac: args.get('--mac') ?? autoMac ?? DEFAULT_MAC,
    vendorName: args.get('--vendor-name') ?? DEFAULT_VENDOR_NAME,
    vendorId: parseNumber(args.get('--vendor-id'), DEFAULT_VENDOR_ID),
    timeScale: parseNumber(args.get('--time-scale'), 60),
    periodicIAmMs: parseNumber(args.get('--periodic-iam-ms'), 20000),
    tickMs: parseNumber(args.get('--tick-ms'), 1000),
  };
}

export function printUsage() {
  console.log('Usage: ts-node scripts/fake-unit.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --bind <ip>                Bind UDP sockets to interface address');
  console.log('  --advertise-ip <ip>        IP advertised in discovery replies');
  console.log('  --quiet                    Disable fake discovery/BACnet traffic logs');
  console.log('  --go-login-key <string>    Override proprietary Flexit GO login key (264:2:4743)');
  console.log('  --netmask <ipv4>           Discovery-reported subnet mask');
  console.log('  --gateway <ipv4>           Discovery-reported default gateway');
  console.log('  --discovery-platform-code  Discovery section 4 field 1 (default 160100F2C5)');
  console.log('  --discovery-platform-version Discovery section 4 field 2 (default POS3.67)');
  console.log('  --discovery-fw-info <str>  Discovery firmware info blob (section 5 field 4)');
  console.log('  --discovery-interface <s>  Discovery interface name (default Eth)');
  console.log('  --discovery-app-version <s> Discovery trailer version (section 12 field 2, default 2.11.0)');
  console.log('  --bacnet-port <port>       BACnet UDP port (default 47808)');
  console.log('  --api-host <host>          HTTP API host (default 127.0.0.1)');
  console.log('  --api-port <port>          HTTP API port (default 18080)');
  console.log('  --serial <nnnnnn-nnnnnn>   Device serial (default 800111-123456)');
  console.log('  --device-id <n>            BACnet device instance (default 2)');
  console.log('  --name <string>            BACnet device object name');
  console.log('  --model <string>           Model name for BACnet device properties');
  console.log('  --firmware <string>        Firmware revision string');
  console.log('  --mac <aa:bb:cc:dd:ee:ff>  MAC in discovery reply');
  console.log('  --time-scale <n>           Sim speed (1=real, 60=1 min/s)');
  console.log('  --periodic-iam-ms <ms>     Periodic I-Am broadcast interval');
}

export async function startFakeUnit(options: CliOptions, registerSignalHandlers = true): Promise<RunningFakeUnit> {
  const state = new FakeNordicUnitState({
    identity: {
      deviceId: options.deviceId,
      serial: options.serial,
      modelName: options.modelName,
      deviceName: options.deviceName,
      firmware: options.firmware,
      vendorName: options.vendorName,
      vendorId: options.vendorId,
    },
    timeScale: options.timeScale,
  });

  const discovery = new DiscoveryResponder({
    bindAddress: options.bindAddress,
    advertiseAddress: options.advertiseAddress ?? '127.0.0.1',
    bacnetPort: options.bacnetPort,
    serial: options.serial,
    deviceName: options.deviceName,
    firmware: options.firmware,
    mac: options.mac,
    networkMask: options.networkMask,
    gateway: options.gateway,
    discoveryPlatformCode: options.discoveryPlatformCode,
    discoveryPlatformVersion: options.discoveryPlatformVersion,
    discoveryFirmwareInfo: options.discoveryFirmwareInfo,
    discoveryInterfaceName: options.discoveryInterfaceName,
    discoveryAppVersion: options.discoveryAppVersion,
    logTraffic: options.logTraffic,
  });
  await discovery.start();

  const bacnetServer = new FakeBacnetServer(state, {
    port: options.bacnetPort,
    bindAddress: options.bindAddress,
    advertiseAddress: options.advertiseAddress,
    flexitGoLoginKey: options.flexitGoLoginKey,
    mac: options.mac,
    networkMask: options.networkMask,
    gateway: options.gateway,
    discoveryPlatformCode: options.discoveryPlatformCode,
    discoveryPlatformVersion: options.discoveryPlatformVersion,
    discoveryFirmwareInfo: options.discoveryFirmwareInfo,
    discoveryInterfaceName: options.discoveryInterfaceName,
    discoveryAppVersion: options.discoveryAppVersion,
    logTraffic: options.logTraffic,
    periodicIAmMs: options.periodicIAmMs,
  });
  bacnetServer.start();

  const apiServer = new FakeApiServer(state, {
    host: options.apiHost,
    port: options.apiPort,
  });
  await apiServer.start();

  const tickTimer = setInterval(() => {
    state.tick();
  }, options.tickMs);

  const id = state.getIdentity();
  console.log(`[FakeUnit] Serial ${id.serial} deviceId=${id.deviceId} model="${id.modelName}"`);
  console.log(`[FakeUnit] BACnet listening on ${options.bindAddress ?? '0.0.0.0'}:${options.bacnetPort}`);
  console.log(`[FakeUnit] Discovery advertises ${options.advertiseAddress}:${options.bacnetPort}`);
  console.log(`[FakeUnit] API at http://${options.apiHost}:${options.apiPort}`);
  console.log(`[FakeUnit] Time scale x${options.timeScale}`);
  console.log(`[FakeUnit] Exposed points: ${SUPPORTED_POINTS.length}`);
  console.log(`[FakeUnit] Key sample: ${pointKey(SUPPORTED_POINTS[0].type, SUPPORTED_POINTS[0].instance)}`);

  let stopped = false;
  const shutdown = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(tickTimer);
    apiServer.stop();
    bacnetServer.stop();
    discovery.stop();
    if (registerSignalHandlers) {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
    }
  };

  if (registerSignalHandlers) {
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  return {
    shutdown,
    state,
    discovery,
    bacnetServer,
    apiServer,
  };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return null;
  }

  const options = parseArgs(argv);
  return startFakeUnit(options, true);
}

const isMainModule = typeof require !== 'undefined'
  && typeof module !== 'undefined'
  && require.main === module;

if (isMainModule) {
  main().catch((error) => {
    console.error('[FakeUnit] Fatal startup error:', error);
    process.exitCode = 1;
  });
}
