import dgram from 'dgram';

const TX_GROUP = '224.0.0.180';
const TX_PORT = 30000;

const RX_GROUP = '224.0.0.181';
const RX_PORT = 30001;

const DEFAULT_DISCOVERY_PLATFORM_CODE = '160100F2C5';
const DEFAULT_DISCOVERY_PLATFORM_VERSION = 'POS3.67';
const DEFAULT_DISCOVERY_INTERFACE_NAME = 'Eth';
const DEFAULT_DISCOVERY_FW_INFO = 'FW=03.39.03.38:BL=00.05.02.0003;SVS-300.4:SBC=13.24;';
const DEFAULT_DISCOVERY_APP_VERSION = '2.11.0';

export interface DiscoveryResponderOptions {
  bindAddress?: string;
  advertiseAddress: string;
  bacnetPort: number;
  serial: string;
  deviceName: string;
  firmware: string;
  mac: string;
  networkMask?: string;
  gateway?: string;
  discoveryPlatformCode?: string;
  discoveryPlatformVersion?: string;
  discoveryFirmwareInfo?: string;
  discoveryInterfaceName?: string;
  discoveryAppVersion?: string;
  logTraffic?: boolean;
}

function pushU16(out: number[], value: number) {
  const v = value & 0xffff;
  out.push((v >> 8) & 0xff, v & 0xff);
}

function pushU32(out: number[], value: number) {
  const v = value >>> 0;
  out.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
}

function pushAscii(out: number[], value: string) {
  out.push(...Buffer.from(value, 'ascii'));
}

function pushSection(out: number[], id: number) {
  out.push(0x0c);
  pushU16(out, id);
}

function pushStringField(out: number[], id: number, value: string) {
  const payload = Buffer.from(value, 'ascii');
  out.push(0x0b);
  pushU16(out, id);
  pushU32(out, payload.length);
  out.push(...payload);
}

function pushIntField(out: number[], id: number, value: number) {
  out.push(0x08);
  pushU16(out, id);
  pushU32(out, value);
}

function parseIPv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return octets;
}

function inferGatewayAddress(ip: string): string {
  const octets = parseIPv4(ip);
  if (!octets) return '0.0.0.0';
  octets[3] = 1;
  return octets.join('.');
}

function extractDiscoveryClientToken(data: Buffer): string {
  const ascii = data
    .toString('latin1')
    .replace(/[^\x20-\x7E]+/g, ' ');
  const match = ascii.match(/ABTMobile:[0-9a-fA-F-]{36}/);
  return match?.[0] ?? 'ABTMobile:00000000-0000-0000-0000-000000000000';
}

function extractUnitSerial(data: Buffer): string | null {
  const ascii = data
    .toString('latin1')
    .replace(/[^\x20-\x7E]+/g, ' ');
  const dashed = ascii.match(/\b\d{6}-\d{6}\b/);
  if (dashed?.[0]) return dashed[0];

  const compact = ascii.match(/\b\d{12}\b/);
  if (!compact?.[0]) return null;
  const raw = compact[0];
  return `${raw.slice(0, 6)}-${raw.slice(6)}`;
}

function bindSocket(socket: dgram.Socket, port: number, bindAddress?: string) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    socket.once('error', onError);
    socket.bind(port, bindAddress, () => {
      socket.off('error', onError);
      resolve();
    });
  });
}

function isDiscoverRequest(payload: Buffer): boolean {
  if (payload.length >= 16 && payload.toString('ascii', 8, 16) === 'discover') return true;
  return payload.includes(Buffer.from('discover', 'ascii'));
}

function buildDiscoveryReply(options: DiscoveryResponderOptions): Buffer {
  // Keep fields parse-friendly for both serial + endpoint regexes.
  const fields = [
    options.deviceName,
    options.serial,
    `${options.advertiseAddress}:${options.bacnetPort}`,
    options.mac,
    `FW:${options.firmware}`,
    'MODE=PL',
  ];
  return Buffer.from(fields.join(' '), 'ascii');
}

function buildStructuredDiscoveryReply(options: DiscoveryResponderOptions, requestMessage: Buffer): Buffer {
  const discoveryClientToken = extractDiscoveryClientToken(requestMessage);
  const discoveryPlatformCode = options.discoveryPlatformCode ?? DEFAULT_DISCOVERY_PLATFORM_CODE;
  const discoveryPlatformVersion = options.discoveryPlatformVersion ?? DEFAULT_DISCOVERY_PLATFORM_VERSION;
  const discoveryInterfaceName = options.discoveryInterfaceName ?? DEFAULT_DISCOVERY_INTERFACE_NAME;
  const discoveryFirmwareInfo = options.discoveryFirmwareInfo ?? DEFAULT_DISCOVERY_FW_INFO;
  const appVersion = options.discoveryAppVersion ?? DEFAULT_DISCOVERY_APP_VERSION;
  const networkMask = options.networkMask ?? '255.255.255.0';
  const gateway = options.gateway ?? inferGatewayAddress(options.advertiseAddress);

  const payload: number[] = [];

  payload.push(0x80, 0x01, 0x00, 0x01);
  pushU32(payload, 14);
  pushAscii(payload, 'identification');
  pushU32(payload, 0);

  pushSection(payload, 1);
  pushStringField(payload, 1, '');
  pushStringField(payload, 2, discoveryClientToken);
  pushIntField(payload, 3, 0);

  pushSection(payload, 4);
  pushStringField(payload, 1, discoveryPlatformCode);
  pushStringField(payload, 2, discoveryPlatformVersion);
  payload.push(0x00);

  pushSection(payload, 5);
  pushIntField(payload, 1, 2);
  pushStringField(payload, 2, options.deviceName);
  pushIntField(payload, 3, 0);
  pushStringField(payload, 4, discoveryFirmwareInfo);
  pushStringField(payload, 5, `${options.advertiseAddress}:${options.bacnetPort}`);
  pushIntField(payload, 6, 0);
  payload.push(0x00);

  pushSection(payload, 6);
  pushStringField(payload, 1, options.serial);
  pushStringField(payload, 2, '~');
  pushStringField(payload, 3, options.serial);
  payload.push(0x00);

  pushSection(payload, 7);
  pushStringField(payload, 1, discoveryInterfaceName);
  pushIntField(payload, 2, 0);
  pushStringField(payload, 3, options.advertiseAddress);
  pushStringField(payload, 4, networkMask);
  pushStringField(payload, 5, gateway);
  pushStringField(payload, 7, options.mac);
  payload.push(0x00);

  pushSection(payload, 12);
  payload.push(0x00, 0x00);
  pushStringField(payload, 2, appVersion);
  payload.push(0x00);

  return Buffer.from(payload);
}

export class DiscoveryResponder {
  private readonly options: DiscoveryResponderOptions;

  private rx: dgram.Socket | null = null;

  private tx: dgram.Socket | null = null;

  private lastObservedExternalReplyHex: string | null = null;

  private readonly observedExternalSerials = new Set<string>();

  constructor(options: DiscoveryResponderOptions) {
    this.options = options;
  }

  private log(message: string) {
    if (this.options.logTraffic === false) return;
    console.log(message);
  }

  private isSelfAddress(address: string): boolean {
    if (address === '127.0.0.1') return true;
    if (this.options.bindAddress && address === this.options.bindAddress) return true;
    if (address === this.options.advertiseAddress) return true;
    return false;
  }

  private logObservedExternalReply(message: Buffer, rinfo: dgram.RemoteInfo) {
    if (this.isSelfAddress(rinfo.address)) return;

    const payloadHex = message.toString('hex');
    if (payloadHex === this.lastObservedExternalReplyHex) return;
    this.lastObservedExternalReplyHex = payloadHex;

    const ascii = message.toString('latin1').replace(/[^\x20-\x7E]+/g, '.');
    const serial = extractUnitSerial(message);

    this.log(
      `[FakeDiscovery] Observed external reply from ${rinfo.address}:${rinfo.port}`
      + ` bytes=${message.length} serial=${serial ?? 'unknown'}`,
    );

    if (serial && !this.observedExternalSerials.has(serial)) {
      this.observedExternalSerials.add(serial);
      this.log(`[FakeDiscovery] External unit serial detected: ${serial} (from ${rinfo.address}:${rinfo.port})`);
    }

    for (let offset = 0; offset < message.length; offset += 32) {
      const row = message.subarray(offset, offset + 32).toString('hex');
      this.log(`[FakeDiscovery] ext hex ${offset.toString(16).padStart(4, '0')}: ${row}`);
    }
    this.log(`[FakeDiscovery] ext ascii: ${ascii}`);
  }

  async start() {
    if (this.rx || this.tx) return;

    this.rx = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.tx = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    await bindSocket(this.rx, TX_PORT, this.options.bindAddress);
    await bindSocket(this.tx, RX_PORT, this.options.bindAddress);

    try {
      if (this.options.bindAddress) this.rx.addMembership(TX_GROUP, this.options.bindAddress);
      else this.rx.addMembership(TX_GROUP);
    } catch (error) {
      console.error('[FakeDiscovery] Failed to join TX multicast group:', error);
    }

    // Send replies from the same source port as real units (30000).
    this.rx.setMulticastTTL(1);
    this.rx.setMulticastLoopback(true);
    if (this.options.bindAddress) {
      try {
        this.rx.setMulticastInterface(this.options.bindAddress);
      } catch (error) {
        console.error('[FakeDiscovery] Failed to set multicast interface:', error);
      }
    }

    try {
      if (this.options.bindAddress) this.tx.addMembership(RX_GROUP, this.options.bindAddress);
      else this.tx.addMembership(RX_GROUP);
    } catch (error) {
      console.error('[FakeDiscovery] Failed to join RX multicast group:', error);
    }

    this.rx.on('error', (error) => {
      console.error('[FakeDiscovery] RX error:', error);
    });

    this.tx.on('error', (error) => {
      console.error('[FakeDiscovery] TX error:', error);
    });

    this.tx.on('message', (message, rinfo) => {
      this.logObservedExternalReply(message, rinfo);
    });

    this.log(
      `[FakeDiscovery] Listening on ${this.options.bindAddress ?? '0.0.0.0'}:${TX_PORT}`
      + ` group=${TX_GROUP} replying via ${RX_GROUP}:${RX_PORT} sourcePort=${TX_PORT}`
      + ` serial=${this.options.serial}`,
    );

    this.rx.on('message', (message, rinfo) => {
      this.log(`[FakeDiscovery] RX ${rinfo.address}:${rinfo.port} len=${message.length}`);
      if (!isDiscoverRequest(message)) {
        this.log('[FakeDiscovery] Ignored packet (not a discover request)');
        return;
      }

      const legacyReply = buildDiscoveryReply(this.options);
      const structuredReply = buildStructuredDiscoveryReply(this.options, message);

      // Reply from the socket bound to TX_PORT so the source port matches real units.
      this.rx?.send(structuredReply, RX_PORT, RX_GROUP);
      this.rx?.send(structuredReply, RX_PORT, rinfo.address);

      // Legacy/plain-text reply is optional; keep it unicast-only to reduce multicast noise.
      this.rx?.send(legacyReply, RX_PORT, rinfo.address);

      // Some implementations listen for replies on the sender port; keep best-effort.
      if (rinfo.port !== RX_PORT) {
        this.rx?.send(structuredReply, rinfo.port, rinfo.address);
        this.rx?.send(legacyReply, rinfo.port, rinfo.address);
      }
      this.log(
        `[FakeDiscovery] TX replies (legacy len=${legacyReply.length}, structured len=${structuredReply.length})`
        + ` to ${RX_GROUP}:${RX_PORT} and ${rinfo.address}:${RX_PORT}/${rinfo.port}`
        + ` fakeSerial=${this.options.serial}`,
      );
    });
  }

  stop() {
    if (this.rx) {
      this.rx.close();
      this.rx = null;
    }
    if (this.tx) {
      this.tx.close();
      this.tx = null;
    }
  }
}
