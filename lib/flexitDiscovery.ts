import dgram from 'dgram';
import os from 'os';
import { randomUUID } from 'crypto';
import { DiscoveredFlexitUnit, parseFlexitReply } from './flexitReplyParser';

const TX_GROUP = '224.0.0.180';
const TX_PORT = 30000;

const RX_GROUP = '224.0.0.181';
const RX_PORT = 30001;

type IPv4Interface = { name: string; address: string };
type DiscoveryLogger = (...args: any[]) => void;
type SendLogContext = {
  loggedSendInterfaces: Set<string>;
  loggedSendFailures: Set<string>;
  log: DiscoveryLogger;
  error: DiscoveryLogger;
};
type DiscoveryOptions = {
  interfaceAddress?: string;
  timeoutMs?: number;
  burstCount?: number;
  burstIntervalMs?: number;
  log?: DiscoveryLogger;
  error?: DiscoveryLogger;
};

export function listIPv4Interfaces(): IPv4Interface[] {
  const out: IPv4Interface[] = [];
  const nics = os.networkInterfaces();

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
  const log = opts.log ?? (() => { });
  const error = opts.error ?? (() => { });
  const allInterfaces = listIPv4Interfaces();
  const interfaces = pickInterfaces(allInterfaces, opts.interfaceAddress);

  logInterfaceSelection(allInterfaces, interfaces, opts.interfaceAddress, log);
  if (interfaces.length === 0) {
    log('[Discovery] No candidate interfaces available for discovery');
    return [];
  }

  const rx = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const tx = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  const found = new Map<string, DiscoveredFlexitUnit>();

  try {
    await bindSocket(rx, RX_PORT);
    log(`[Discovery] Bound RX socket on 0.0.0.0:${RX_PORT}`);
    joinReplyMulticast(rx, interfaces, log, error);
    attachReplyHandler(rx, found, log);

    await bindSocket(tx, TX_PORT);
    configureTxSocket(tx, log);
    const request = buildDiscoverRequest();
    const sendLogContext: SendLogContext = {
      loggedSendInterfaces: new Set<string>(),
      loggedSendFailures: new Set<string>(),
      log,
      error,
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
    safeClose(rx);
    safeClose(tx);
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
  log: DiscoveryLogger,
) {
  log(`[Discovery] Available IPv4 interfaces: ${formatInterfaces(allInterfaces)}`);
  if (interfaceAddress && interfaceAddress !== 'auto') {
    log(`[Discovery] Requested interface address: ${interfaceAddress}`);
  }
  log(`[Discovery] Selected interfaces: ${formatInterfaces(selectedInterfaces)}`);
}

function joinReplyMulticast(
  rx: dgram.Socket,
  interfaces: IPv4Interface[],
  log: DiscoveryLogger,
  error: DiscoveryLogger,
) {
  for (const nic of interfaces) {
    try {
      rx.addMembership(RX_GROUP, nic.address);
      log(`[Discovery] Joined reply multicast ${RX_GROUP} on ${formatInterface(nic)}`);
    } catch (err) {
      error(`[Discovery] Failed to join reply multicast ${RX_GROUP} on ${formatInterface(nic)}:`, err);
    }
  }
}

function attachReplyHandler(
  rx: dgram.Socket,
  found: Map<string, DiscoveredFlexitUnit>,
  log: DiscoveryLogger,
) {
  rx.on('message', (msg, rinfo) => {
    const parsed = parseFlexitReply(msg, rinfo.address);
    if (!parsed) {
      log(
        `[Discovery] Ignored reply from ${formatRemote(rinfo)} len=${msg.length};`
        + ` parser returned null; ascii="${asciiPreview(msg)}"`,
      );
      return;
    }
    const duplicate = found.has(parsed.serialNormalized);
    found.set(parsed.serialNormalized, parsed);
    log(
      `[Discovery] Parsed reply from ${formatRemote(rinfo)} len=${msg.length}:`
      + ` ${parsed.serial}@${parsed.ip}:${parsed.bacnetPort}${duplicate ? ' (duplicate)' : ''}`,
    );
  });
}

function configureTxSocket(tx: dgram.Socket, log: DiscoveryLogger) {
  tx.setMulticastTTL(1); // link-local only
  tx.setMulticastLoopback(false);
  log(`[Discovery] Bound TX socket on 0.0.0.0:${TX_PORT}`);
  log(`[Discovery] Discovery request target ${TX_GROUP}:${TX_PORT} (multicast loopback disabled)`);
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
    logDiscoverSend(nic, context.loggedSendInterfaces, context.log);
  } catch (err) {
    logDiscoverSendError(nic, context.loggedSendFailures, context.error, err);
  }
}

function logDiscoverSend(
  nic: IPv4Interface,
  loggedSendInterfaces: Set<string>,
  log: DiscoveryLogger,
) {
  if (loggedSendInterfaces.has(nic.address)) return;
  loggedSendInterfaces.add(nic.address);
  log(`[Discovery] Sending discover via ${formatInterface(nic)} to ${TX_GROUP}:${TX_PORT}`);
}

function logDiscoverSendError(
  nic: IPv4Interface,
  loggedSendFailures: Set<string>,
  error: DiscoveryLogger,
  err: unknown,
) {
  if (loggedSendFailures.has(nic.address)) return;
  loggedSendFailures.add(nic.address);
  error(`[Discovery] Failed to send discover via ${formatInterface(nic)} to ${TX_GROUP}:${TX_PORT}:`, err);
}

function formatInterface(nic: IPv4Interface) {
  return `${nic.name}=${nic.address}`;
}

function formatInterfaces(interfaces: IPv4Interface[]) {
  if (interfaces.length === 0) return 'none';
  return interfaces.map((nic) => formatInterface(nic)).join(', ');
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
  const uuid = randomUUID(); // 36 chars
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

function safeClose(sock: dgram.Socket) {
  try {
    sock.close();
  } catch (_err) {
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
