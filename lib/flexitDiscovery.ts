import dgram from 'dgram';
import os from 'os';
import { randomUUID } from 'crypto';
import { DiscoveredFlexitUnit, parseFlexitReply } from './flexitReplyParser';
import { createRuntimeLogger, RuntimeLogger } from './logging';

const TX_GROUP = '224.0.0.180';
const TX_PORT = 30000;

const RX_GROUP = '224.0.0.181';
const RX_PORT = 30001;

type IPv4Interface = { name: string; address: string };
type SendLogContext = {
  loggedSendInterfaces: Set<string>;
  loggedSendFailures: Set<string>;
  logger?: RuntimeLogger;
};
type DiscoveryOptions = {
  interfaceAddress?: string;
  timeoutMs?: number;
  burstCount?: number;
  burstIntervalMs?: number;
  logger?: RuntimeLogger;
  log?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
};
type DiscoveryDependencies = {
  networkInterfaces: typeof os.networkInterfaces;
  createSocket: typeof dgram.createSocket;
  randomUUID: typeof randomUUID;
  parseFlexitReply: typeof parseFlexitReply;
};

const defaultDiscoveryDependencies: DiscoveryDependencies = {
  networkInterfaces: os.networkInterfaces.bind(os),
  createSocket: dgram.createSocket.bind(dgram),
  randomUUID,
  parseFlexitReply,
};

let discoveryDependencies = defaultDiscoveryDependencies;

export function setFlexitDiscoveryDependenciesForTests(dependencies: Partial<DiscoveryDependencies>) {
  discoveryDependencies = {
    ...defaultDiscoveryDependencies,
    ...dependencies,
  };
}

export function resetFlexitDiscoveryDependenciesForTests() {
  discoveryDependencies = defaultDiscoveryDependencies;
}

export function listIPv4Interfaces(): IPv4Interface[] {
  const out: IPv4Interface[] = [];
  const nics = discoveryDependencies.networkInterfaces();

  for (const [name, infos] of Object.entries(nics)) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        out.push({ name, address: info.address });
      }
    }
  }
  return out;
}

export async function discoverFlexitUnits(opts: DiscoveryOptions): Promise<DiscoveredFlexitUnit[]> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const burstCount = opts.burstCount ?? 10;
  const burstIntervalMs = opts.burstIntervalMs ?? 300;
  const logger = opts.logger ?? (
    opts.log || opts.error
      ? createRuntimeLogger({
        log: opts.log ?? (() => {}),
        error: opts.error ?? opts.log ?? (() => {}),
      }, { component: 'discovery' })
      : undefined
  );
  const allInterfaces = listIPv4Interfaces();
  const interfaces = pickInterfaces(allInterfaces, opts.interfaceAddress);

  logInterfaceSelection(allInterfaces, interfaces, opts.interfaceAddress, logger);
  if (interfaces.length === 0) {
    logger?.info('discovery.interfaces.none_selected', 'No candidate interfaces available for discovery', {
      interfaceAddress: opts.interfaceAddress ?? 'auto',
    });
    return [];
  }

  const rx = discoveryDependencies.createSocket({ type: 'udp4', reuseAddr: true });
  const tx = discoveryDependencies.createSocket({ type: 'udp4', reuseAddr: true });

  const found = new Map<string, DiscoveredFlexitUnit>();

  try {
    await bindSocket(rx, RX_PORT);
    logger?.info('discovery.socket.rx_bound', 'Bound discovery RX socket', {
      bindAddress: '0.0.0.0',
      port: RX_PORT,
    });
    joinReplyMulticast(rx, interfaces, logger);
    attachReplyHandler(rx, found, logger);

    await bindSocket(tx, TX_PORT);
    configureTxSocket(tx, logger);
    const request = buildDiscoverRequest();
    const sendLogContext: SendLogContext = {
      loggedSendInterfaces: new Set<string>(),
      loggedSendFailures: new Set<string>(),
      logger,
    };

    const start = Date.now();

    // Send burst per interface.
    for (let i = 0; i < burstCount; i++) {
      sendDiscoverViaInterfaces(tx, request, interfaces, sendLogContext);
      await sleep(burstIntervalMs);
    }

    const remaining = timeoutMs - (Date.now() - start);
    if (remaining > 0) await sleep(remaining);

    return [...found.values()];
  } finally {
    safeClose(rx, 'rx', logger);
    safeClose(tx, 'tx', logger);
  }
}

function pickInterfaces(all: IPv4Interface[], interfaceAddress?: string) {
  if (!interfaceAddress || interfaceAddress === 'auto') return all;
  return all.filter((i) => i.address === interfaceAddress);
}

function logInterfaceSelection(
  allInterfaces: IPv4Interface[],
  selectedInterfaces: IPv4Interface[],
  interfaceAddress: string | undefined,
  logger?: RuntimeLogger,
) {
  logger?.info('discovery.interfaces.selected', 'Selected interfaces for discovery', {
    availableInterfaces: allInterfaces.map(formatInterface),
    requestedInterfaceAddress: interfaceAddress ?? 'auto',
    selectedInterfaces: selectedInterfaces.map(formatInterface),
  });
}

function joinReplyMulticast(
  rx: dgram.Socket,
  interfaces: IPv4Interface[],
  logger?: RuntimeLogger,
) {
  for (const nic of interfaces) {
    try {
      rx.addMembership(RX_GROUP, nic.address);
      logger?.info('discovery.multicast.joined', 'Joined discovery reply multicast group', {
        group: RX_GROUP,
        interface: formatInterface(nic),
      });
    } catch (err) {
      logger?.error('discovery.multicast.join.failed', 'Failed to join discovery reply multicast group', err, {
        group: RX_GROUP,
        interface: formatInterface(nic),
      });
    }
  }
}

function attachReplyHandler(
  rx: dgram.Socket,
  found: Map<string, DiscoveredFlexitUnit>,
  logger?: RuntimeLogger,
) {
  rx.on('message', (msg, rinfo) => {
    const parsed = discoveryDependencies.parseFlexitReply(msg, rinfo.address);
    if (!parsed) {
      logger?.info('discovery.reply.ignored', 'Ignored discovery reply because parser returned null', {
        remote: formatRemote(rinfo),
        payloadLength: msg.length,
        asciiPreview: asciiPreview(msg),
      });
      return;
    }
    const duplicate = found.has(parsed.serialNormalized);
    found.set(parsed.serialNormalized, parsed);
    logger?.info('discovery.reply.parsed', 'Parsed discovery reply', {
      remote: formatRemote(rinfo),
      payloadLength: msg.length,
      unitId: parsed.serialNormalized,
      serial: parsed.serial,
      ip: parsed.ip,
      bacnetPort: parsed.bacnetPort,
      duplicate,
    });
  });
}

function configureTxSocket(tx: dgram.Socket, logger?: RuntimeLogger) {
  tx.setMulticastTTL(1); // link-local only
  tx.setMulticastLoopback(false);
  logger?.info('discovery.socket.tx_ready', 'Configured discovery TX socket', {
    bindAddress: '0.0.0.0',
    port: TX_PORT,
    targetGroup: TX_GROUP,
    targetPort: TX_PORT,
    multicastLoopback: false,
    ttl: 1,
  });
}

function sendDiscoverViaInterfaces(
  tx: dgram.Socket,
  request: Buffer,
  interfaces: IPv4Interface[],
  context: SendLogContext,
) {
  for (const nic of interfaces) {
    sendDiscoverViaInterface(tx, request, nic, context);
  }
}

function sendDiscoverViaInterface(
  tx: dgram.Socket,
  request: Buffer,
  nic: IPv4Interface,
  context: SendLogContext,
) {
  try {
    tx.setMulticastInterface(nic.address);
    tx.send(request, TX_PORT, TX_GROUP);
    logDiscoverSend(nic, context.loggedSendInterfaces, context.logger);
  } catch (err) {
    logDiscoverSendError(nic, context.loggedSendFailures, context.logger, err);
  }
}

function logDiscoverSend(
  nic: IPv4Interface,
  loggedSendInterfaces: Set<string>,
  logger?: RuntimeLogger,
) {
  if (loggedSendInterfaces.has(nic.address)) return;
  loggedSendInterfaces.add(nic.address);
  logger?.info('discovery.request.sent', 'Sent discovery request on interface', {
    interface: formatInterface(nic),
    targetGroup: TX_GROUP,
    targetPort: TX_PORT,
  });
}

function logDiscoverSendError(
  nic: IPv4Interface,
  loggedSendFailures: Set<string>,
  logger: RuntimeLogger | undefined,
  err: unknown,
) {
  if (loggedSendFailures.has(nic.address)) return;
  loggedSendFailures.add(nic.address);
  logger?.error('discovery.request.send.failed', 'Failed to send discovery request on interface', err, {
    interface: formatInterface(nic),
    targetGroup: TX_GROUP,
    targetPort: TX_PORT,
  });
}

function formatInterface(nic: IPv4Interface) {
  return `${nic.name}=${nic.address}`;
}

function formatRemote(rinfo: Pick<dgram.RemoteInfo, 'address' | 'port'>) {
  return `${rinfo.address}:${typeof rinfo.port === 'number' ? rinfo.port : '?'}`;
}

function asciiPreview(payload: Buffer) {
  const preview = payload
    .toString('latin1')
    .replace(/[^\x20-\x7E]+/g, ' ')
    .trim();
  if (preview.length === 0) return '<no-ascii>';
  return preview.slice(0, 120);
}

/**
 * Build the proprietary Flexit multicast discovery request.
 * Must be EXACTLY 104 bytes or units don't respond.
 */
function buildDiscoverRequest(): Buffer {
  const uuid = discoveryDependencies.randomUUID(); // 36 chars
  const tlv2 = `ABTMobile:${uuid}`; // length 46
  const tlv3 = '?Devices=All'; // length 12

  const buf = Buffer.alloc(104);
  let o = 0;

  // fixed header:
  // 80 01 00 04
  // 00 00 00 08
  // "discover" (8 bytes)
  // 00 00 00 00
  // 0c 00 01 0b
  // 00 01 00 00 00 00
  buf.set([0x80, 0x01, 0x00, 0x04], o); o += 4;
  buf.set([0x00, 0x00, 0x00, 0x08], o); o += 4;

  buf.write('discover', o, 'ascii'); o += 8;

  buf.set([0x00, 0x00, 0x00, 0x00], o); o += 4;
  buf.set([0x0c, 0x00, 0x01, 0x0b], o); o += 4;
  buf.set([0x00, 0x01, 0x00, 0x00, 0x00, 0x00], o); o += 6;

  o = writeTLV(buf, o, 0x02, tlv2);
  o = writeTLV(buf, o, 0x03, tlv3);

  // suffix
  buf.set([0x00, 0x00], o); o += 2;

  if (o !== 104) throw new Error(`Discover payload wrong length: ${o} (expected 104)`);
  return buf;
}

/**
 * TLV header is 7 bytes:
 * 0b 00 <tag> 00 00 00 <len8>
 */
function writeTLV(buf: Buffer, offset: number, tag: number, payload: string) {
  const payloadLen = Buffer.byteLength(payload, 'ascii');
  buf.set([0x0b, 0x00, tag & 0xff, 0x00, 0x00, 0x00, payloadLen & 0xff], offset);
  offset += 7;
  buf.write(payload, offset, 'ascii');
  offset += payloadLen;
  return offset;
}

function bindSocket(sock: dgram.Socket, port: number) {
  return new Promise<void>((resolve, reject) => {
    const onErr = (e: any) => reject(e);
    sock.once('error', onErr);
    sock.bind(port, () => {
      sock.off('error', onErr);
      resolve();
    });
  });
}

function safeClose(sock: dgram.Socket, label: string, logger?: RuntimeLogger) {
  try {
    sock.close();
  } catch (err) {
    logger?.error('discovery.socket.close.failed', 'Failed to close discovery socket', err, {
      socket: label,
    });
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
