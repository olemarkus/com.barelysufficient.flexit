import dgram from 'dgram';
import os from 'os';
import { randomUUID } from 'crypto';
import { DiscoveredFlexitUnit, parseFlexitReply } from './flexitReplyParser';

const TX_GROUP = '224.0.0.180';
const TX_PORT = 30000;

const RX_GROUP = '224.0.0.181';
const RX_PORT = 30001;

export function listIPv4Interfaces(): Array<{ name: string; address: string }> {
  const out: Array<{ name: string; address: string }> = [];
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

export async function discoverFlexitUnits(opts: {
  interfaceAddress?: string;
  timeoutMs?: number;
  burstCount?: number;
  burstIntervalMs?: number;
}): Promise<DiscoveredFlexitUnit[]> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const burstCount = opts.burstCount ?? 10;
  const burstIntervalMs = opts.burstIntervalMs ?? 300;

  const interfaces = pickInterfaces(opts.interfaceAddress);
  if (interfaces.length === 0) return [];

  const rx = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const tx = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  const found = new Map<string, DiscoveredFlexitUnit>();

  try {
    await bindSocket(rx, RX_PORT);

    // Join reply multicast group on each candidate interface
    for (const nic of interfaces) {
      try {
        rx.addMembership(RX_GROUP, nic.address);
      } catch (_err) {
        // Some interfaces won't support multicast; ignore.
      }
    }

    rx.on('message', (msg, rinfo) => {
      const parsed = parseFlexitReply(msg, rinfo.address);
      if (!parsed) return;
      found.set(parsed.serialNormalized, parsed);
    });

    await bindSocket(tx, TX_PORT);
    tx.setMulticastTTL(1); // link-local only
    tx.setMulticastLoopback(false);

    const request = buildDiscoverRequest();

    const start = Date.now();

    // Send burst per interface.
    for (let i = 0; i < burstCount; i++) {
      for (const nic of interfaces) {
        try {
          tx.setMulticastInterface(nic.address);
          tx.send(request, TX_PORT, TX_GROUP);
        } catch (_err) {
          // ignore per-interface errors
        }
      }
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

function pickInterfaces(interfaceAddress?: string) {
  const all = listIPv4Interfaces();
  if (!interfaceAddress || interfaceAddress === 'auto') return all;
  return all.filter((i) => i.address === interfaceAddress);
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
