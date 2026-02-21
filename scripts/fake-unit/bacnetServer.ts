import dgram from 'dgram';
import {
  APPLICATION_TAG,
  DEVICE_OBJECT_TYPE,
  FLEXIT_GO_COMPAT_DEVICE_INSTANCE,
  FLEXIT_GO_LOGIN_OBJECT_INSTANCE,
  FLEXIT_GO_LOGIN_OBJECT_TYPE,
  FLEXIT_GO_LOGIN_PROPERTY_ID,
  FLEXIT_GO_PROPRIETARY_PROPERTY_OVERLAYS,
  FLEXIT_GO_RANGE_MAX_PROPERTY_ID,
  FLEXIT_GO_RANGE_MIN_PROPERTY_ID,
  FLEXIT_GO_STATIC_COMPAT_OBJECTS,
  OBJECT_TYPE,
  PROPERTY_ID,
  SUPPORTED_DEVICE_PROPERTIES,
  SUPPORTED_POINT_PROPERTY_IDS,
  SUPPORTED_POINTS,
} from './manifest';
import { FakeNordicUnitState, valueTagForRead, valueToWriteNumber } from './state';

const Bacnet = require('bacstack');
const Bvlc = require('bacstack/lib/bvlc');
const Npdu = require('bacstack/lib/npdu');
const Apdu = require('bacstack/lib/apdu');
const Services = require('bacstack/lib/services');

const BacnetEnums = Bacnet.enum;

type BacnetClient = any;

type BacnetValue = { type: number; value: any };

const OBJECT_TYPE_NAME_BY_ID = new Map<number, string>();
for (const [name, value] of Object.entries(OBJECT_TYPE)) {
  if (typeof value === 'number') OBJECT_TYPE_NAME_BY_ID.set(value, name);
}

const PROPERTY_ID_NAME_BY_ID = new Map<number, string>();
for (const [name, value] of Object.entries(PROPERTY_ID)) {
  if (typeof value === 'number') PROPERTY_ID_NAME_BY_ID.set(value, name);
}

interface NpduAddress {
  net: number;
  adr?: number[];
}

interface PrivateTransferFrameInfo {
  bvlcFunction: number;
  bvlcLength: number;
  npduControl: number;
  npduLength: number;
  npduDestination?: NpduAddress;
  npduSource?: NpduAddress;
  npduHopCount: number;
  apduLength: number;
}

interface DecodedPrivateTransfer extends PrivateTransferFrameInfo {
  vendorId: number;
  serviceNumber: number;
  data: number[];
}

const FLEXIT_GO_BROADCAST = '255.255.255.255';
const FLEXIT_SIEMENS_VENDOR_ID = 7;
const FLEXIT_DISCOVERY_SERVICE = 515;
const FLEXIT_IDENTIFICATION_SERVICE = 516;
const DEFAULT_DISCOVERY_PLATFORM_CODE = '160100F2C5';
const DEFAULT_DISCOVERY_PLATFORM_VERSION = 'POS3.67';
const DEFAULT_DISCOVERY_INTERFACE_NAME = 'Eth';
const DEFAULT_DISCOVERY_FW_INFO = 'FW=03.39.03.38:BL=00.05.02.0003;SVS-300.4:SBC=13.24;';
const DEFAULT_DISCOVERY_APP_VERSION = '2.11.0';

function objectTypeName(type: number): string {
  return OBJECT_TYPE_NAME_BY_ID.get(type) ?? String(type);
}

function propertyIdName(propertyId: number): string {
  return PROPERTY_ID_NAME_BY_ID.get(propertyId) ?? String(propertyId);
}

function objectKey(type: number, instance: number): string {
  return `${type}:${instance}`;
}

const FLEXIT_GO_STATIC_COMPAT_OBJECTS_BY_KEY = new Map(
  FLEXIT_GO_STATIC_COMPAT_OBJECTS.map((objectDef) => [
    objectKey(objectDef.objectType, objectDef.instance),
    objectDef,
  ]),
);

const FLEXIT_GO_PROPERTY_OVERLAYS_BY_KEY = new Map(
  FLEXIT_GO_PROPRIETARY_PROPERTY_OVERLAYS.map((overlay) => [
    objectKey(overlay.objectType, overlay.instance),
    overlay,
  ]),
);

function bitStringForBits(bitsUsed: number, setBits: number[]) {
  const used = Math.max(0, Math.floor(bitsUsed));
  const bytes = Math.ceil(used / 8);
  const value = new Array(bytes).fill(0);
  for (const bit of setBits) {
    if (!Number.isInteger(bit) || bit < 0 || bit >= used) continue;
    const byteIndex = Math.floor(bit / 8);
    const bitIndex = bit % 8;
    value[byteIndex] |= (1 << bitIndex);
  }
  return { bitsUsed: used, value };
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

function extractUnitSerial(data: number[] | Buffer): string | null {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const ascii = payload
    .toString('latin1')
    .replace(/[^\x20-\x7E]+/g, ' ');
  const dashed = ascii.match(/\b\d{6}-\d{6}\b/);
  if (dashed?.[0]) return dashed[0];

  const compact = ascii.match(/\b\d{12}\b/);
  if (!compact?.[0]) return null;
  const raw = compact[0];
  return `${raw.slice(0, 6)}-${raw.slice(6)}`;
}

function deriveFlexitGoLoginKey(serial: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let state = 0x811c9dc5;
  for (const byte of Buffer.from(serial, 'ascii')) {
    state ^= byte;
    state = Math.imul(state, 0x01000193) >>> 0;
  }

  let out = '';
  for (let i = 0; i < 25; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out += alphabet[state % alphabet.length];
    if ((i + 1) % 5 === 0 && i < 24) out += '-';
  }
  return out;
}

export interface FakeBacnetServerOptions {
  port: number;
  bindAddress?: string;
  advertiseAddress?: string;
  flexitGoLoginKey?: string;
  mac?: string;
  networkMask?: string;
  gateway?: string;
  discoveryPlatformCode?: string;
  discoveryPlatformVersion?: string;
  discoveryFirmwareInfo?: string;
  discoveryInterfaceName?: string;
  discoveryAppVersion?: string;
  logTraffic?: boolean;
  periodicIAmMs?: number;
}

function bacnetErrorValue(errorClass: number, errorCode: number) {
  return [{
    type: APPLICATION_TAG.ERROR,
    value: {
      type: 'BacnetError',
      errorClass,
      errorCode,
    },
  }];
}

type ReadPropertyResult =
  | { ok: true; values: BacnetValue[] }
  | { ok: false; errorClass: number; errorCode: number };

export class FakeBacnetServer {
  private readonly state: FakeNordicUnitState;

  private readonly options: FakeBacnetServerOptions;

  private readonly flexitGoLoginKey: string;

  private client: BacnetClient | null = null;

  private periodicIAmTimer: ReturnType<typeof setInterval> | null = null;

  private lastObservedExternalIdentificationHex: string | null = null;

  private learnedIdentificationFrameInfo: PrivateTransferFrameInfo | null = null;

  private readonly observedExternalSerials = new Set<string>();

  private readonly onRawMessage = (message: Buffer, rinfo: dgram.RemoteInfo) => {
    this.handleRawBacnetMessage(message, rinfo);
  };

  constructor(state: FakeNordicUnitState, options: FakeBacnetServerOptions) {
    this.state = state;
    this.options = options;
    this.flexitGoLoginKey = options.flexitGoLoginKey ?? deriveFlexitGoLoginKey(this.state.getIdentity().serial);
  }

  start() {
    if (this.client) return;

    this.client = new Bacnet({
      port: this.options.port,
      interface: this.options.bindAddress,
      apduTimeout: 3000,
      apduSize: 1476,
    });

    this.client.on('error', (error: unknown) => {
      console.error('[FakeBacnet] Client error:', error);
    });

    this.client.on('whoIs', (request: any) => this.handleWhoIs(request));
    this.client.on('readPropertyMultiple', (request: any) => this.handleReadPropertyMultiple(request));
    this.client.on('readProperty', (request: any) => this.handleReadProperty(request));
    this.client.on('writeProperty', (request: any) => this.handleWriteProperty(request));
    this.client.on('writePropertyMultiple', (request: any) => this.handleWritePropertyMultiple(request));

    const transportSocket = this.getTransportSocket();
    transportSocket?.on('message', this.onRawMessage);

    this.log(
      `[FakeBacnet] Listening on ${this.options.bindAddress ?? '0.0.0.0'}:${this.options.port}`
      + ' with Flexit GO private-transfer discovery support'
      + ` serial=${this.state.getIdentity().serial}`,
    );

    const periodicMs = this.options.periodicIAmMs ?? 0;
    if (periodicMs > 0) {
      this.periodicIAmTimer = setInterval(() => {
        const identity = this.state.getIdentity();
        this.client?.iAmResponse(identity.deviceId, BacnetEnums.Segmentation.NO_SEGMENTATION, identity.vendorId);
      }, periodicMs);
    }
  }

  stop() {
    if (this.periodicIAmTimer) {
      clearInterval(this.periodicIAmTimer);
      this.periodicIAmTimer = null;
    }

    const transportSocket = this.getTransportSocket();
    transportSocket?.off('message', this.onRawMessage);

    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  private log(message: string) {
    if (this.options.logTraffic === false) return;
    console.log(message);
  }

  private getTransportSocket(): dgram.Socket | null {
    const socket = this.client?._transport?._server;
    if (!socket || typeof socket.on !== 'function' || typeof socket.send !== 'function') return null;
    return socket as dgram.Socket;
  }

  private extractDiscoveryClientToken(data: number[]): string {
    const ascii = Buffer.from(data)
      .toString('latin1')
      .replace(/[^\x20-\x7E]+/g, ' ');
    const match = ascii.match(/ABTMobile:[0-9a-fA-F-]{36}/);
    return match?.[0] ?? 'ABTMobile:00000000-0000-0000-0000-000000000000';
  }

  private getDiscoveryFirmwareInfo(): string {
    if (this.options.discoveryFirmwareInfo) return this.options.discoveryFirmwareInfo;
    return DEFAULT_DISCOVERY_FW_INFO;
  }

  private getDiscoveryAppVersion(): string {
    if (this.options.discoveryAppVersion) return this.options.discoveryAppVersion;
    return DEFAULT_DISCOVERY_APP_VERSION;
  }

  private buildDiscoveryIdentityPayload(discoveryClientToken: string): number[] {
    const identity = this.state.getIdentity();
    const advertiseAddress = this.options.advertiseAddress
      ?? this.options.bindAddress
      ?? '127.0.0.1';
    const mac = this.options.mac ?? '00:00:00:00:00:00';
    const networkMask = this.options.networkMask ?? '255.255.255.0';
    const gateway = this.options.gateway ?? inferGatewayAddress(advertiseAddress);
    const discoveryPlatformCode = this.options.discoveryPlatformCode ?? DEFAULT_DISCOVERY_PLATFORM_CODE;
    const discoveryPlatformVersion = this.options.discoveryPlatformVersion ?? DEFAULT_DISCOVERY_PLATFORM_VERSION;
    const discoveryInterfaceName = this.options.discoveryInterfaceName ?? DEFAULT_DISCOVERY_INTERFACE_NAME;
    const firmwareInfo = this.getDiscoveryFirmwareInfo();
    const appVersion = this.getDiscoveryAppVersion();

    const payload: number[] = [];

    // This mirrors the proprietary Flexit GO identification payload shape.
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
    pushStringField(payload, 2, identity.deviceName);
    pushIntField(payload, 3, 0);
    pushStringField(payload, 4, firmwareInfo);
    pushStringField(payload, 5, `${advertiseAddress}:${this.options.port}`);
    pushIntField(payload, 6, 0);
    payload.push(0x00);

    pushSection(payload, 6);
    pushStringField(payload, 1, identity.serial);
    pushStringField(payload, 2, '~');
    pushStringField(payload, 3, identity.serial);
    payload.push(0x00);

    pushSection(payload, 7);
    pushStringField(payload, 1, discoveryInterfaceName);
    pushIntField(payload, 2, 0);
    pushStringField(payload, 3, advertiseAddress);
    pushStringField(payload, 4, networkMask);
    pushStringField(payload, 5, gateway);
    pushStringField(payload, 7, mac);
    payload.push(0x00);

    // Keep trailing section bytes in the same form as observed payloads.
    pushSection(payload, 12);
    payload.push(0x00, 0x00);
    pushStringField(payload, 2, appVersion);
    payload.push(0x00);

    return payload;
  }

  private decodeUnconfirmedPrivateTransfer(message: Buffer): DecodedPrivateTransfer | null {
    let bvlc: { len: number; func: number } | null = null;
    let npdu: {
      len: number;
      funct: number;
      destination?: NpduAddress;
      source?: NpduAddress;
      hopCount: number;
    } | null = null;
    let apdu: { len: number; type: number; service: number } | null = null;
    let transfer: { vendorId: number; serviceNumber: number; data: number[] } | null = null;

    try {
      bvlc = Bvlc.decode(message, 0);
      if (!bvlc) return null;

      npdu = Npdu.decode(message, bvlc.len);
      if (!npdu) return null;
      if ((npdu.funct & BacnetEnums.NpduControlBits.NETWORK_LAYER_MESSAGE) !== 0) return null;

      const apduOffset = bvlc.len + npdu.len;
      apdu = Apdu.decodeUnconfirmedServiceRequest(message, apduOffset);
      if (!apdu) return null;
      if ((apdu.type & BacnetEnums.PDU_TYPE_MASK) !== BacnetEnums.PduTypes.UNCONFIRMED_REQUEST) return null;
      if (apdu.service !== BacnetEnums.UnconfirmedServiceChoice.UNCONFIRMED_PRIVATE_TRANSFER) return null;

      const transferOffset = apduOffset + apdu.len;
      const transferLength = message.length - transferOffset;
      if (transferLength <= 0) return null;

      // bacstack's privateTransfer decoder expects the absolute buffer end offset,
      // not the remaining payload length.
      transfer = Services.privateTransfer.decode(message, transferOffset, message.length);
      if (!transfer) return null;
      if (typeof transfer.vendorId !== 'number' || typeof transfer.serviceNumber !== 'number') return null;
      if (!Array.isArray(transfer.data)) return null;
    } catch (_error) {
      return null;
    }

    return {
      bvlcFunction: bvlc.func,
      bvlcLength: bvlc.len,
      npduControl: npdu.funct,
      npduLength: npdu.len,
      npduDestination: npdu.destination,
      npduSource: npdu.source,
      npduHopCount: npdu.hopCount,
      apduLength: apdu.len,
      vendorId: transfer.vendorId,
      serviceNumber: transfer.serviceNumber,
      data: transfer.data,
    };
  }

  private sendUnconfirmedPrivateTransfer(
    address: string,
    port: number,
    bvlcFunction: number,
    vendorId: number,
    serviceNumber: number,
    data: number[],
    frameInfo?: PrivateTransferFrameInfo | null,
  ) {
    const socket = this.getTransportSocket();
    if (!socket) return;

    const packet = {
      buffer: Buffer.alloc(1482),
      offset: 4,
    };

    const learnedControl = frameInfo?.npduControl ?? BacnetEnums.NpduControlPriority.NORMAL_MESSAGE;
    const controlBase = learnedControl & ~(
      BacnetEnums.NpduControlBits.DESTINATION_SPECIFIED
      | BacnetEnums.NpduControlBits.SOURCE_SPECIFIED
    );
    Npdu.encode(
      packet,
      controlBase,
      frameInfo?.npduDestination,
      frameInfo?.npduSource,
      frameInfo?.npduHopCount ?? 0xff,
    );
    Apdu.encodeUnconfirmedServiceRequest(
      packet,
      BacnetEnums.PduTypes.UNCONFIRMED_REQUEST,
      BacnetEnums.UnconfirmedServiceChoice.UNCONFIRMED_PRIVATE_TRANSFER,
    );
    Services.privateTransfer.encode(packet, vendorId, serviceNumber, data);
    Bvlc.encode(packet.buffer, bvlcFunction, packet.offset);

    socket.send(packet.buffer, 0, packet.offset, port, address);
    this.log(
      `[FakeBacnet] TX private transfer ${vendorId}:${serviceNumber}`
      + ` to ${address}:${port} len=${packet.offset} bvlc=${bvlcFunction}`
      + ` npdu=0x${controlBase.toString(16)}`,
    );
  }

  private handleRawBacnetMessage(message: Buffer, rinfo: dgram.RemoteInfo) {
    const transfer = this.decodeUnconfirmedPrivateTransfer(message);
    if (!transfer) {
      try {
        const bvlc = Bvlc.decode(message, 0);
        const npdu = bvlc ? Npdu.decode(message, bvlc.len) : null;
        const apduOffset = bvlc && npdu ? (bvlc.len + npdu.len) : 0;
        const pduType = (apduOffset < message.length)
          ? (message[apduOffset] & BacnetEnums.PDU_TYPE_MASK)
          : -1;
        this.log(
          `[FakeBacnet] RX frame from ${rinfo.address}:${rinfo.port}`
          + ` len=${message.length}`
          + ` bvlc=${bvlc?.func ?? '-'}`
          + ` npdu=0x${npdu ? npdu.funct.toString(16) : '-'}`
          + ` pduType=${pduType}`,
        );
      } catch (_error) {
        this.log(
          `[FakeBacnet] RX frame from ${rinfo.address}:${rinfo.port}`
          + ` len=${message.length} (unparsed)`,
        );
      }
      return;
    }
    const serial = transfer.serviceNumber === FLEXIT_IDENTIFICATION_SERVICE
      ? extractUnitSerial(transfer.data)
      : null;

    this.log(
      `[FakeBacnet] RX private transfer ${transfer.vendorId}:${transfer.serviceNumber}`
      + ` from ${rinfo.address}:${rinfo.port} len=${message.length}`
      + ` bvlc=${transfer.bvlcFunction}`
      + ` npdu=0x${transfer.npduControl.toString(16)}`
      + ` npduLen=${transfer.npduLength}`
      + ` bvlcLen=${transfer.bvlcLength}`
      + `${serial ? ` serial=${serial}` : ''}`,
    );

    if (
      transfer.vendorId === FLEXIT_SIEMENS_VENDOR_ID
      && transfer.serviceNumber === FLEXIT_IDENTIFICATION_SERVICE
    ) {
      if (!this.isSelfAddress(rinfo.address)) {
        this.learnedIdentificationFrameInfo = {
          bvlcFunction: transfer.bvlcFunction,
          bvlcLength: transfer.bvlcLength,
          npduControl: transfer.npduControl,
          npduLength: transfer.npduLength,
          npduDestination: transfer.npduDestination,
          npduSource: transfer.npduSource,
          npduHopCount: transfer.npduHopCount,
          apduLength: transfer.apduLength,
        };
        this.logObservedExternalIdentification(rinfo.address, transfer);
      }
    }

    if (
      transfer.vendorId !== FLEXIT_SIEMENS_VENDOR_ID
      || transfer.serviceNumber !== FLEXIT_DISCOVERY_SERVICE
    ) {
      return;
    }

    const discoveryClientToken = this.extractDiscoveryClientToken(transfer.data);
    const responsePayload = this.buildDiscoveryIdentityPayload(discoveryClientToken);

    this.sendUnconfirmedPrivateTransfer(
      rinfo.address,
      rinfo.port,
      BacnetEnums.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
      FLEXIT_SIEMENS_VENDOR_ID,
      FLEXIT_IDENTIFICATION_SERVICE,
      responsePayload,
      this.learnedIdentificationFrameInfo,
    );

    this.sendUnconfirmedPrivateTransfer(
      FLEXIT_GO_BROADCAST,
      this.options.port,
      BacnetEnums.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU,
      FLEXIT_SIEMENS_VENDOR_ID,
      FLEXIT_IDENTIFICATION_SERVICE,
      responsePayload,
      this.learnedIdentificationFrameInfo,
    );

    this.log(
      '[FakeBacnet] TX discovery identification'
      + ` to ${rinfo.address}:${rinfo.port} and ${FLEXIT_GO_BROADCAST}:${this.options.port}`
      + ` fakeSerial=${this.state.getIdentity().serial}`,
    );
  }

  private isSelfAddress(address: string): boolean {
    if (address === '127.0.0.1') return true;
    if (this.options.bindAddress && address === this.options.bindAddress) return true;
    if (this.options.advertiseAddress && address === this.options.advertiseAddress) return true;
    return false;
  }

  private logObservedExternalIdentification(sourceAddress: string, transfer: DecodedPrivateTransfer) {
    if (this.isSelfAddress(sourceAddress)) return;

    const payload = Buffer.from(transfer.data);
    this.log(
      `[FakeBacnet] Learned framing from external 7:516: bvlc=${transfer.bvlcFunction}`
      + ` npdu=0x${transfer.npduControl.toString(16)}`
      + ` npduLen=${transfer.npduLength}`
      + ` hop=${transfer.npduHopCount}`
      + ` dest=${this.formatNpduAddress(transfer.npduDestination)}`
      + ` src=${this.formatNpduAddress(transfer.npduSource)}`,
    );

    const payloadHex = payload.toString('hex');
    if (payloadHex === this.lastObservedExternalIdentificationHex) return;
    this.lastObservedExternalIdentificationHex = payloadHex;

    const ascii = payload.toString('latin1').replace(/[^\x20-\x7E]+/g, '.');
    const serial = extractUnitSerial(payload);

    this.log(
      `[FakeBacnet] Observed external 7:516 payload from ${sourceAddress}`
      + ` bytes=${payload.length} serial=${serial ?? 'unknown'}`,
    );

    if (serial && !this.observedExternalSerials.has(serial)) {
      this.observedExternalSerials.add(serial);
      this.log(`[FakeBacnet] External unit serial detected: ${serial} (from ${sourceAddress})`);
    }

    for (let offset = 0; offset < payload.length; offset += 32) {
      const row = payload.subarray(offset, offset + 32).toString('hex');
      this.log(`[FakeBacnet] 516 hex ${offset.toString(16).padStart(4, '0')}: ${row}`);
    }
    this.log(`[FakeBacnet] 516 ascii: ${ascii}`);
  }

  private formatNpduAddress(address?: NpduAddress): string {
    if (!address) return '-';
    const adr = address.adr && address.adr.length > 0
      ? address.adr.map((part) => part.toString(16).padStart(2, '0')).join('')
      : '-';
    return `${address.net}:${adr}`;
  }

  private handleWhoIs(request: any) {
    if (!this.client) return;
    const identity = this.state.getIdentity();
    const requestPort = typeof request?.port === 'number' ? request.port : undefined;
    const remote = `${request?.address ?? '?'}${requestPort ? `:${requestPort}` : ''}`;

    this.log(`[FakeBacnet] RX whoIs from ${remote} low=${request?.lowLimit ?? '-'} high=${request?.highLimit ?? '-'}`);

    const lowLimit = Number(request?.lowLimit);
    const highLimit = Number(request?.highLimit);
    const hasLow = Number.isFinite(lowLimit);
    const hasHigh = Number.isFinite(highLimit);
    if (hasLow && identity.deviceId < lowLimit) {
      this.log(`[FakeBacnet] whoIs ignored for ${remote}: deviceId ${identity.deviceId} < low ${lowLimit}`);
      return;
    }
    if (hasHigh && identity.deviceId > highLimit) {
      this.log(`[FakeBacnet] whoIs ignored for ${remote}: deviceId ${identity.deviceId} > high ${highLimit}`);
      return;
    }

    this.client.iAmResponse(identity.deviceId, BacnetEnums.Segmentation.NO_SEGMENTATION, identity.vendorId);
    this.log(`[FakeBacnet] TX iAmResponse to ${remote} deviceId=${identity.deviceId} vendorId=${identity.vendorId}`);
  }

  private handleReadPropertyMultiple(request: any) {
    if (!this.client) return;
    this.state.tick();

    const properties = request?.request?.properties ?? [];
    const requestPort = typeof request?.port === 'number' ? request.port : undefined;
    const remote = `${request.address}${requestPort ? `:${requestPort}` : ''}`;

    this.log(`[FakeBacnet] RX readPropertyMultiple from ${remote} objects=${properties.length}`);
    for (const spec of properties) {
      const objectId = spec?.objectId;
      const propList = spec?.properties ?? [];
      const propsText = Array.isArray(propList)
        ? propList.map((prop: any) => {
          const propId = typeof prop?.id === 'number' ? prop.id : -1;
          const idx = typeof prop?.index === 'number' ? prop.index : BacnetEnums.ASN1_ARRAY_ALL;
          return `${propertyIdName(propId)}(${propId})[${idx === BacnetEnums.ASN1_ARRAY_ALL ? 'all' : idx}]`;
        }).join(', ')
        : '';
      if (objectId) {
        this.log(`[FakeBacnet]  RPM obj=${objectTypeName(objectId.type)}:${objectId.instance} props=${propsText}`);
      } else {
        this.log(`[FakeBacnet]  RPM obj=? props=${propsText}`);
      }
    }

    const responseValues = properties.map((spec: any) => this.buildReadAccessResult(spec));

    const errors: string[] = [];
    for (const obj of responseValues) {
      for (const entry of obj?.values ?? []) {
        const value = entry?.value?.[0];
        if (value?.type !== APPLICATION_TAG.ERROR) continue;
        const err = value.value ?? {};
        const errClass = typeof err.errorClass === 'number' ? err.errorClass : -1;
        const errCode = typeof err.errorCode === 'number' ? err.errorCode : -1;
        errors.push(
          `${objectTypeName(obj.objectId?.type)}:${obj.objectId?.instance} `
          + `${propertyIdName(entry?.property?.id)}(${entry?.property?.id})`
          + `[${entry?.property?.index === BacnetEnums.ASN1_ARRAY_ALL ? 'all' : entry?.property?.index}]`
          + ` -> ${errClass}:${errCode}`,
        );
      }
    }

    if (errors.length > 0) {
      this.log(`[FakeBacnet]  RPM would return ${errors.length} error(s):`);
      for (const line of errors.slice(0, 10)) this.log(`[FakeBacnet]   ${line}`);
      if (errors.length > 10) this.log(`[FakeBacnet]   ... (${errors.length - 10} more)`);
    }

    this.client.readPropertyMultipleResponse(request.address, request.invokeId, responseValues);
    this.log(`[FakeBacnet] TX readPropertyMultipleResponse to ${remote} invokeId=${request.invokeId}`);
  }

  private handleReadProperty(request: any) {
    if (!this.client) return;
    this.state.tick();

    const requestPort = typeof request?.port === 'number' ? request.port : undefined;
    const remote = `${request.address}${requestPort ? `:${requestPort}` : ''}`;
    const objectId = request?.request?.objectId;
    const property = request?.request?.property;
    const objectText = objectId ? `${objectTypeName(objectId.type)}:${objectId.instance}` : '-';
    const propertyId = typeof property?.id === 'number' ? property.id : -1;
    const index = typeof property?.index === 'number' ? property.index : BacnetEnums.ASN1_ARRAY_ALL;
    this.log(
      `[FakeBacnet] RX readProperty from ${remote}`
      + ` obj=${objectText}`
      + ` prop=${propertyIdName(propertyId)}(${propertyId})`
      + ` idx=${index === BacnetEnums.ASN1_ARRAY_ALL ? 'all' : index}`,
    );

    if (!objectId || !property) {
      this.client.errorResponse(
        request.address,
        BacnetEnums.ConfirmedServiceChoice.READ_PROPERTY,
        request.invokeId,
        BacnetEnums.ErrorClass.SERVICES,
        BacnetEnums.ErrorCode.INVALID_TAG,
      );
      this.log(
        `[FakeBacnet] TX errorResponse readProperty to ${remote}`
        + ` invokeId=${request.invokeId} err=${BacnetEnums.ErrorClass.SERVICES}:${BacnetEnums.ErrorCode.INVALID_TAG}`,
      );
      return;
    }

    const result = this.readPropertyValue(objectId, property.id, property.index);
    if (!result.ok) {
      this.log(
        `[FakeBacnet] readProperty rejected obj=${objectTypeName(objectId.type)}:${objectId.instance}`
        + ` prop=${propertyIdName(property.id)}(${property.id})`
        + ` idx=${property.index === BacnetEnums.ASN1_ARRAY_ALL ? 'all' : property.index}`
        + ` -> ${result.errorClass}:${result.errorCode}`,
      );
      this.client.errorResponse(
        request.address,
        BacnetEnums.ConfirmedServiceChoice.READ_PROPERTY,
        request.invokeId,
        result.errorClass,
        result.errorCode,
      );
      this.log(
        `[FakeBacnet] TX errorResponse readProperty to ${remote}`
        + ` invokeId=${request.invokeId} err=${result.errorClass}:${result.errorCode}`,
      );
      return;
    }

    this.client.readPropertyResponse(
      request.address,
      request.invokeId,
      objectId,
      property,
      result.values,
    );
    const first = result.values?.[0];
    this.log(
      `[FakeBacnet] TX readPropertyResponse to ${remote}`
      + ` invokeId=${request.invokeId}`
      + ` tag=${first?.type ?? '-'}`
      + ` value=${typeof first?.value === 'number' ? first.value : JSON.stringify(first?.value)}`,
    );
  }

  private handleWriteProperty(request: any) {
    if (!this.client) return;

    const requestPort = typeof request?.port === 'number' ? request.port : undefined;
    const remote = `${request.address}${requestPort ? `:${requestPort}` : ''}`;
    const objectId = request?.request?.objectId;
    const payload = request?.request?.value;
    const propertyId = payload?.property?.id;
    const valueNode = payload?.value?.[0];
    const priority = typeof payload?.priority === 'number' ? payload.priority : undefined;
    const valueTag = typeof valueNode?.type === 'number' ? valueNode.type : -1;
    const valueRaw = valueNode?.value;

    this.log(
      `[FakeBacnet] RX writeProperty from ${remote}`
      + ` obj=${objectTypeName(objectId?.type)}:${objectId?.instance ?? '-'}`
      + ` prop=${propertyIdName(propertyId)}(${propertyId ?? '-'})`
      + ` tag=${valueTag}`
      + ` value=${typeof valueRaw === 'number' ? valueRaw : JSON.stringify(valueRaw)}`
      + ` priority=${priority ?? '-'}`,
    );

    if (!objectId || typeof propertyId !== 'number') {
      this.log('[FakeBacnet]  writeProperty rejected: invalid tag/object/property');
      this.client.errorResponse(
        request.address,
        BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY,
        request.invokeId,
        BacnetEnums.ErrorClass.SERVICES,
        BacnetEnums.ErrorCode.INVALID_TAG,
      );
      this.log(
        `[FakeBacnet] TX errorResponse writeProperty to ${remote}`
        + ` invokeId=${request.invokeId} err=${BacnetEnums.ErrorClass.SERVICES}:${BacnetEnums.ErrorCode.INVALID_TAG}`,
      );
      return;
    }

    const numeric = valueToWriteNumber(valueNode);
    if (numeric === null) {
      this.log('[FakeBacnet]  writeProperty rejected: invalid data type');
      this.client.errorResponse(
        request.address,
        BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY,
        request.invokeId,
        BacnetEnums.ErrorClass.PROPERTY,
        BacnetEnums.ErrorCode.INVALID_DATA_TYPE,
      );
      this.log(
        `[FakeBacnet] TX errorResponse writeProperty to ${remote}`
        + ` invokeId=${request.invokeId} err=${BacnetEnums.ErrorClass.PROPERTY}:${BacnetEnums.ErrorCode.INVALID_DATA_TYPE}`,
      );
      return;
    }

    const write = this.state.writePresentValue(
      objectId.type,
      objectId.instance,
      propertyId,
      numeric,
      priority,
    );

    if (!write.ok) {
      this.log(
        `[FakeBacnet]  writeProperty rejected: ${write.errorClass}:${write.errorCode}`
        + ` (${write.message ?? 'no details'})`,
      );
      this.client.errorResponse(
        request.address,
        BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY,
        request.invokeId,
        write.errorClass,
        write.errorCode,
      );
      this.log(
        `[FakeBacnet] TX errorResponse writeProperty to ${remote}`
        + ` invokeId=${request.invokeId} err=${write.errorClass}:${write.errorCode}`,
      );
      return;
    }

    this.client.simpleAckResponse(
      request.address,
      BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY,
      request.invokeId,
    );
    this.log(`[FakeBacnet] TX simpleAck writeProperty to ${remote} invokeId=${request.invokeId}`);
  }

  private handleWritePropertyMultiple(request: any) {
    if (!this.client) return;

    const requestPort = typeof request?.port === 'number' ? request.port : undefined;
    const remote = `${request.address}${requestPort ? `:${requestPort}` : ''}`;
    const objectId = request?.request?.objectId;
    const values = request?.request?.values ?? [];

    this.log(
      `[FakeBacnet] RX writePropertyMultiple from ${remote}`
      + ` obj=${objectTypeName(objectId?.type)}:${objectId?.instance ?? '-'}`
      + ` entries=${values.length}`,
    );
    for (const entry of values) {
      const propId = entry?.property?.id;
      const valueNode = entry?.value?.[0];
      const tag = typeof valueNode?.type === 'number' ? valueNode.type : -1;
      const raw = valueNode?.value;
      const priority = entry?.priority === BacnetEnums.ASN1_NO_PRIORITY ? undefined : entry?.priority;
      this.log(
        `[FakeBacnet]  WPM prop=${propertyIdName(propId)}(${propId ?? '-'})`
        + ` tag=${tag}`
        + ` value=${typeof raw === 'number' ? raw : JSON.stringify(raw)}`
        + ` priority=${priority ?? '-'}`,
      );
    }

    if (!objectId || values.length === 0) {
      this.log('[FakeBacnet]  writePropertyMultiple rejected: invalid tag/object/values');
      this.client.errorResponse(
        request.address,
        BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE,
        request.invokeId,
        BacnetEnums.ErrorClass.SERVICES,
        BacnetEnums.ErrorCode.INVALID_TAG,
      );
      this.log(
        `[FakeBacnet] TX errorResponse writePropertyMultiple to ${remote}`
        + ` invokeId=${request.invokeId} err=${BacnetEnums.ErrorClass.SERVICES}:${BacnetEnums.ErrorCode.INVALID_TAG}`,
      );
      return;
    }

    for (const entry of values) {
      const propertyId = entry?.property?.id;
      const valueNode = entry?.value?.[0];
      const priority = entry?.priority === BacnetEnums.ASN1_NO_PRIORITY ? undefined : entry?.priority;
      if (typeof propertyId !== 'number') {
        this.log('[FakeBacnet]  writePropertyMultiple rejected: unknown property id');
        this.client.errorResponse(
          request.address,
          BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE,
          request.invokeId,
          BacnetEnums.ErrorClass.PROPERTY,
          BacnetEnums.ErrorCode.UNKNOWN_PROPERTY,
        );
        this.log(
          `[FakeBacnet] TX errorResponse writePropertyMultiple to ${remote}`
          + ` invokeId=${request.invokeId} err=${BacnetEnums.ErrorClass.PROPERTY}:${BacnetEnums.ErrorCode.UNKNOWN_PROPERTY}`,
        );
        return;
      }

      const numeric = valueToWriteNumber(valueNode);
      if (numeric === null) {
        this.log('[FakeBacnet]  writePropertyMultiple rejected: invalid data type');
        this.client.errorResponse(
          request.address,
          BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE,
          request.invokeId,
          BacnetEnums.ErrorClass.PROPERTY,
          BacnetEnums.ErrorCode.INVALID_DATA_TYPE,
        );
        this.log(
          `[FakeBacnet] TX errorResponse writePropertyMultiple to ${remote}`
          + ` invokeId=${request.invokeId} err=${BacnetEnums.ErrorClass.PROPERTY}:${BacnetEnums.ErrorCode.INVALID_DATA_TYPE}`,
        );
        return;
      }

      const result = this.state.writePresentValue(
        objectId.type,
        objectId.instance,
        propertyId,
        numeric,
        priority,
      );
      if (!result.ok) {
        this.log(
          `[FakeBacnet]  writePropertyMultiple rejected: ${result.errorClass}:${result.errorCode}`
          + ` (${result.message ?? 'no details'})`,
        );
        this.client.errorResponse(
          request.address,
          BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE,
          request.invokeId,
          result.errorClass,
          result.errorCode,
        );
        this.log(
          `[FakeBacnet] TX errorResponse writePropertyMultiple to ${remote}`
          + ` invokeId=${request.invokeId} err=${result.errorClass}:${result.errorCode}`,
        );
        return;
      }
    }

    this.client.simpleAckResponse(
      request.address,
      BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE,
      request.invokeId,
    );
    this.log(`[FakeBacnet] TX simpleAck writePropertyMultiple to ${remote} invokeId=${request.invokeId}`);
  }

  private buildReadAccessResult(spec: any) {
    const { objectId } = spec;
    const properties = Array.isArray(spec.properties) ? spec.properties : [];
    const expandedProperties = this.expandReadPropertyMultiplePropertyRefs(objectId, properties);
    const values = expandedProperties.map((property) => {
      const propertyId = typeof property?.id === 'number' ? property.id : -1;
      const index = typeof property?.index === 'number' ? property.index : BacnetEnums.ASN1_ARRAY_ALL;
      const result = this.readPropertyValue(objectId, propertyId, index);
      if (!result.ok) {
        return {
          property: {
            id: propertyId,
            index,
          },
          value: bacnetErrorValue(result.errorClass, result.errorCode),
        };
      }

      return {
        property: {
          id: propertyId,
          index,
        },
        value: result.values,
      };
    });

    return { objectId, values };
  }

  private expandReadPropertyMultiplePropertyRefs(objectId: any, properties: any[]): any[] {
    const expanded: any[] = [];
    const seen = new Set<string>();

    const add = (propertyId: number, index: number) => {
      const key = `${propertyId}:${index}`;
      if (seen.has(key)) return;
      seen.add(key);
      expanded.push({ id: propertyId, index });
    };

    const expandSpecial = () => {
      const ids = objectId?.type === DEVICE_OBJECT_TYPE
        ? SUPPORTED_DEVICE_PROPERTIES.map((property) => property.id)
        : SUPPORTED_POINT_PROPERTY_IDS;
      for (const id of ids) add(id, BacnetEnums.ASN1_ARRAY_ALL);
    };

    for (const property of properties) {
      const propertyId = typeof property?.id === 'number' ? property.id : -1;
      const index = typeof property?.index === 'number' ? property.index : BacnetEnums.ASN1_ARRAY_ALL;

      if (propertyId === PROPERTY_ID.ALL || propertyId === PROPERTY_ID.REQUIRED || propertyId === PROPERTY_ID.OPTIONAL) {
        expandSpecial();
        continue;
      }

      add(propertyId, index);
    }

    return expanded;
  }

  private engineeringUnitsForPoint(units?: string): number | null {
    if (!units) return null;
    switch (units) {
      case 'degC':
        return BacnetEnums.EngineeringUnits.DEGREES_CELSIUS;
      case '%':
        return BacnetEnums.EngineeringUnits.PERCENT;
      case 'rpm':
        return BacnetEnums.EngineeringUnits.REVOLUTIONS_PER_MINUTE;
      case 'Pa':
        return BacnetEnums.EngineeringUnits.PASCALS;
      case 'min':
        return BacnetEnums.EngineeringUnits.MINUTES;
      case 'h':
        return BacnetEnums.EngineeringUnits.HOURS;
      case 'kW':
        return BacnetEnums.EngineeringUnits.KILOWATTS;
      case 'ppm':
        return BacnetEnums.EngineeringUnits.PARTS_PER_MILLION;
      default:
        return null;
    }
  }

  private readPropertyValue(
    objectId: { type: number; instance: number },
    propertyId: number,
    arrayIndex = BacnetEnums.ASN1_ARRAY_ALL,
  ): ReadPropertyResult {
    if (objectId.type === DEVICE_OBJECT_TYPE) {
      return this.readDeviceProperty(objectId.instance, propertyId, arrayIndex);
    }

    if (
      objectId.type === FLEXIT_GO_LOGIN_OBJECT_TYPE
      && objectId.instance === FLEXIT_GO_LOGIN_OBJECT_INSTANCE
    ) {
      // Proprietary Flexit GO compatibility object; intentionally outside documented points.
      return this.readFlexitGoLoginProperty(objectId, propertyId, arrayIndex);
    }

    const staticCompat = this.readFlexitGoStaticCompatProperty(objectId, propertyId, arrayIndex);
    if (staticCompat) {
      // Proprietary Flexit GO compatibility object; intentionally outside documented points.
      return staticCompat;
    }

    const overlayCompat = this.readFlexitGoPropertyOverlay(objectId, propertyId, arrayIndex);
    if (overlayCompat) {
      // Proprietary Flexit GO property overlay on documented points.
      return overlayCompat;
    }

    const point = this.state.getPoint(objectId.type, objectId.instance);
    if (!point) {
      return {
        ok: false as const,
        errorClass: BacnetEnums.ErrorClass.OBJECT,
        errorCode: BacnetEnums.ErrorCode.UNKNOWN_OBJECT,
      };
    }

    switch (propertyId) {
      case PROPERTY_ID.OBJECT_IDENTIFIER:
        return {
          ok: true as const,
          values: [{
            type: APPLICATION_TAG.OBJECTIDENTIFIER,
            value: { type: objectId.type, instance: objectId.instance },
          }],
        };
      case PROPERTY_ID.OBJECT_NAME:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.CHARACTER_STRING, value: point.name }] };
      case PROPERTY_ID.OBJECT_TYPE:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.ENUMERATED, value: objectId.type }] };
      case PROPERTY_ID.DESCRIPTION:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.CHARACTER_STRING, value: point.description }] };
      case PROPERTY_ID.STATUS_FLAGS:
        return {
          ok: true as const,
          values: [{
            type: APPLICATION_TAG.BIT_STRING,
            value: { bitsUsed: 4, value: [0] },
          }],
        };
      case PROPERTY_ID.OUT_OF_SERVICE:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.BOOLEAN, value: false }] };
      case PROPERTY_ID.RELIABILITY:
        return {
          ok: true as const,
          values: [{ type: APPLICATION_TAG.ENUMERATED, value: BacnetEnums.Reliability.NO_FAULT_DETECTED }],
        };
      case PROPERTY_ID.EVENT_STATE:
        return {
          ok: true as const,
          values: [{ type: APPLICATION_TAG.ENUMERATED, value: BacnetEnums.EventState.NORMAL }],
        };
      case PROPERTY_ID.UNITS: {
        const engineeringUnits = this.engineeringUnitsForPoint(point.units);
        if (engineeringUnits === null) {
          return {
            ok: false as const,
            errorClass: BacnetEnums.ErrorClass.PROPERTY,
            errorCode: BacnetEnums.ErrorCode.UNKNOWN_PROPERTY,
          };
        }
        return { ok: true as const, values: [{ type: APPLICATION_TAG.ENUMERATED, value: engineeringUnits }] };
      }
      case PROPERTY_ID.MIN_PRES_VALUE: {
        if (typeof point.min !== 'number' || (point.kind !== 'real' && point.kind !== 'unsigned')) {
          return {
            ok: false as const,
            errorClass: BacnetEnums.ErrorClass.PROPERTY,
            errorCode: BacnetEnums.ErrorCode.UNKNOWN_PROPERTY,
          };
        }
        return {
          ok: true as const,
          values: [{ type: valueTagForRead(point), value: point.min }],
        };
      }
      case PROPERTY_ID.MAX_PRES_VALUE: {
        if (typeof point.max !== 'number' || (point.kind !== 'real' && point.kind !== 'unsigned')) {
          return {
            ok: false as const,
            errorClass: BacnetEnums.ErrorClass.PROPERTY,
            errorCode: BacnetEnums.ErrorCode.UNKNOWN_PROPERTY,
          };
        }
        return {
          ok: true as const,
          values: [{ type: valueTagForRead(point), value: point.max }],
        };
      }
      default:
        break;
    }

    if (propertyId !== PROPERTY_ID.PRESENT_VALUE) {
      return {
        ok: false as const,
        errorClass: BacnetEnums.ErrorClass.PROPERTY,
        errorCode: BacnetEnums.ErrorCode.UNKNOWN_PROPERTY,
      };
    }

    // No array support for presentValue.
    if (arrayIndex !== BacnetEnums.ASN1_ARRAY_ALL) {
      return {
        ok: false as const,
        errorClass: BacnetEnums.ErrorClass.PROPERTY,
        errorCode: BacnetEnums.ErrorCode.PROPERTY_IS_NOT_AN_ARRAY,
      };
    }

    const stateRead = this.state.readPresentValue(objectId.type, objectId.instance, propertyId);
    if (!stateRead.ok) return stateRead;
    return {
      ok: true as const,
      values: [{
        type: valueTagForRead(stateRead.value.point),
        value: stateRead.value.value,
      }],
    };
  }

  private readFlexitGoLoginProperty(
    _objectId: { type: number; instance: number },
    propertyId: number,
    arrayIndex: number,
  ): ReadPropertyResult {
    if (arrayIndex !== BacnetEnums.ASN1_ARRAY_ALL) {
      return {
        ok: false as const,
        errorClass: BacnetEnums.ErrorClass.PROPERTY,
        errorCode: BacnetEnums.ErrorCode.PROPERTY_IS_NOT_AN_ARRAY,
      };
    }

    switch (propertyId) {
      case PROPERTY_ID.OBJECT_IDENTIFIER:
        return {
          ok: true as const,
          values: [{
            type: APPLICATION_TAG.OBJECTIDENTIFIER,
            value: { type: FLEXIT_GO_LOGIN_OBJECT_TYPE, instance: FLEXIT_GO_LOGIN_OBJECT_INSTANCE },
          }],
        };
      case PROPERTY_ID.OBJECT_NAME:
        return {
          ok: true as const,
          values: [{ type: APPLICATION_TAG.CHARACTER_STRING, value: 'FlexitGoLogin' }],
        };
      case PROPERTY_ID.OBJECT_TYPE:
        return {
          ok: true as const,
          values: [{ type: APPLICATION_TAG.ENUMERATED, value: FLEXIT_GO_LOGIN_OBJECT_TYPE }],
        };
      case PROPERTY_ID.DESCRIPTION:
        return {
          ok: true as const,
          values: [{ type: APPLICATION_TAG.CHARACTER_STRING, value: 'Flexit GO login compatibility object' }],
        };
      case FLEXIT_GO_LOGIN_PROPERTY_ID:
        // Placeholder proprietary value so Flexit GO can continue the auth flow.
        return {
          ok: true as const,
          values: [{ type: APPLICATION_TAG.CHARACTER_STRING, value: this.flexitGoLoginKey }],
        };
      default:
        return {
          ok: false as const,
          errorClass: BacnetEnums.ErrorClass.PROPERTY,
          errorCode: BacnetEnums.ErrorCode.UNKNOWN_PROPERTY,
        };
    }
  }

  private readFlexitGoStaticCompatProperty(
    objectId: { type: number; instance: number },
    propertyId: number,
    arrayIndex: number,
  ): ReadPropertyResult | null {
    const compatObject = FLEXIT_GO_STATIC_COMPAT_OBJECTS_BY_KEY.get(objectKey(objectId.type, objectId.instance));
    if (!compatObject) return null;

    if (arrayIndex !== BacnetEnums.ASN1_ARRAY_ALL) {
      return {
        ok: false as const,
        errorClass: BacnetEnums.ErrorClass.PROPERTY,
        errorCode: BacnetEnums.ErrorCode.PROPERTY_IS_NOT_AN_ARRAY,
      };
    }

    switch (propertyId) {
      case PROPERTY_ID.OBJECT_IDENTIFIER:
        return {
          ok: true as const,
          values: [{
            type: APPLICATION_TAG.OBJECTIDENTIFIER,
            value: { type: compatObject.objectType, instance: compatObject.instance },
          }],
        };
      case PROPERTY_ID.OBJECT_NAME:
        return {
          ok: true as const,
          values: [{ type: APPLICATION_TAG.CHARACTER_STRING, value: compatObject.objectName }],
        };
      case PROPERTY_ID.OBJECT_TYPE:
        return {
          ok: true as const,
          values: [{ type: APPLICATION_TAG.ENUMERATED, value: compatObject.objectType }],
        };
      case PROPERTY_ID.DESCRIPTION:
        return {
          ok: true as const,
          values: [{ type: APPLICATION_TAG.CHARACTER_STRING, value: compatObject.description }],
        };
      default:
        break;
    }

    if (propertyId === PROPERTY_ID.PRESENT_VALUE) {
      const livePointValue = this.state.readPresentValue(objectId.type, objectId.instance, PROPERTY_ID.PRESENT_VALUE);
      if (livePointValue.ok) {
        return {
          ok: true as const,
          values: [{ type: valueTagForRead(livePointValue.value.point), value: livePointValue.value.value }],
        };
      }
    }

    if (propertyId === PROPERTY_ID.HIGH_LIMIT || propertyId === PROPERTY_ID.LOW_LIMIT) {
      const rangePropertyId = propertyId === PROPERTY_ID.HIGH_LIMIT
        ? FLEXIT_GO_RANGE_MAX_PROPERTY_ID
        : FLEXIT_GO_RANGE_MIN_PROPERTY_ID;
      const rangeProperty = compatObject.properties.find((property) => property.id === rangePropertyId);
      if (rangeProperty) {
        return {
          ok: true as const,
          values: [{ type: rangeProperty.tag, value: rangeProperty.value }],
        };
      }
    }

    const valueProperty = compatObject.properties.find((property) => property.id === propertyId);
    if (!valueProperty) {
      return {
        ok: false as const,
        errorClass: BacnetEnums.ErrorClass.PROPERTY,
        errorCode: BacnetEnums.ErrorCode.UNKNOWN_PROPERTY,
      };
    }

    return {
      ok: true as const,
      values: [{ type: valueProperty.tag, value: valueProperty.value }],
    };
  }

  private readFlexitGoPropertyOverlay(
    objectId: { type: number; instance: number },
    propertyId: number,
    arrayIndex: number,
  ): ReadPropertyResult | null {
    const overlay = FLEXIT_GO_PROPERTY_OVERLAYS_BY_KEY.get(objectKey(objectId.type, objectId.instance));
    if (!overlay) return null;

    const valueProperty = overlay.properties.find((property) => property.id === propertyId);
    if (!valueProperty) return null;

    if (arrayIndex !== BacnetEnums.ASN1_ARRAY_ALL) {
      return {
        ok: false as const,
        errorClass: BacnetEnums.ErrorClass.PROPERTY,
        errorCode: BacnetEnums.ErrorCode.PROPERTY_IS_NOT_AN_ARRAY,
      };
    }

    return {
      ok: true as const,
      values: [{ type: valueProperty.tag, value: valueProperty.value }],
    };
  }

  private buildObjectList(deviceId: number): Array<{ type: number; instance: number }> {
    const objects = [
      { type: DEVICE_OBJECT_TYPE, instance: deviceId },
      ...SUPPORTED_POINTS.map((point) => ({ type: point.type, instance: point.instance })),
    ];
    const seen = new Set<string>();
    const out: Array<{ type: number; instance: number }> = [];
    for (const obj of objects) {
      const key = `${obj.type}:${obj.instance}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(obj);
    }
    return out;
  }

  private readDeviceProperty(instance: number, propertyId: number, arrayIndex: number): ReadPropertyResult {
    const identity = this.state.getIdentity();
    if (instance !== identity.deviceId && instance !== FLEXIT_GO_COMPAT_DEVICE_INSTANCE) {
      return {
        ok: false as const,
        errorClass: BacnetEnums.ErrorClass.OBJECT,
        errorCode: BacnetEnums.ErrorCode.UNKNOWN_OBJECT,
      };
    }
    const isFlexitGoAlias = instance === FLEXIT_GO_COMPAT_DEVICE_INSTANCE;

    switch (propertyId) {
      case PROPERTY_ID.OBJECT_IDENTIFIER:
        return {
          ok: true as const,
          values: [{
            type: APPLICATION_TAG.OBJECTIDENTIFIER,
            value: { type: OBJECT_TYPE.DEVICE, instance },
          }],
        };
      case PROPERTY_ID.OBJECT_NAME:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.CHARACTER_STRING, value: identity.deviceName }] };
      case PROPERTY_ID.OBJECT_TYPE:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.ENUMERATED, value: OBJECT_TYPE.DEVICE }] };
      case PROPERTY_ID.DESCRIPTION:
        return {
          ok: true as const,
          values: [{
            type: APPLICATION_TAG.CHARACTER_STRING,
            value: isFlexitGoAlias ? identity.serial : `Nordic unit ${identity.serial}`,
          }],
        };
      case PROPERTY_ID.MODEL_NAME:
        return {
          ok: true as const,
          values: [{
            type: APPLICATION_TAG.CHARACTER_STRING,
            value: isFlexitGoAlias
              ? (this.options.discoveryPlatformVersion ?? DEFAULT_DISCOVERY_PLATFORM_VERSION)
              : identity.modelName,
          }],
        };
      case PROPERTY_ID.VENDOR_NAME:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.CHARACTER_STRING, value: identity.vendorName }] };
      case PROPERTY_ID.FIRMWARE_REVISION:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.CHARACTER_STRING, value: identity.firmware }] };
      case PROPERTY_ID.APPLICATION_SOFTWARE_VERSION:
        return {
          ok: true as const,
          values: [{
            type: APPLICATION_TAG.CHARACTER_STRING,
            value: isFlexitGoAlias ? this.getDiscoveryAppVersion() : identity.firmware,
          }],
        };
      case PROPERTY_ID.PROTOCOL_VERSION:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.UNSIGNED_INTEGER, value: 1 }] };
      case PROPERTY_ID.PROTOCOL_REVISION:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.UNSIGNED_INTEGER, value: 22 }] };
      case PROPERTY_ID.PROTOCOL_SERVICES_SUPPORTED: {
        const supported = [
          BacnetEnums.ServicesSupported.I_AM,
          BacnetEnums.ServicesSupported.WHO_IS,
          BacnetEnums.ServicesSupported.READ_PROPERTY,
          BacnetEnums.ServicesSupported.READ_PROPERTY_MULTIPLE,
          BacnetEnums.ServicesSupported.WRITE_PROPERTY,
          BacnetEnums.ServicesSupported.WRITE_PROPERTY_MULTIPLE,
          BacnetEnums.ServicesSupported.UNCONFIRMED_PRIVATE_TRANSFER,
        ];
        const bitsUsed = Math.max(...supported) + 1;
        return {
          ok: true as const,
          values: [{
            type: APPLICATION_TAG.BIT_STRING,
            value: bitStringForBits(bitsUsed, supported),
          }],
        };
      }
      case PROPERTY_ID.PROTOCOL_OBJECT_TYPES_SUPPORTED: {
        const types = new Set<number>([DEVICE_OBJECT_TYPE]);
        for (const point of SUPPORTED_POINTS) types.add(point.type);
        const supported = Array.from(types.values());
        const bitsUsed = Math.max(...supported) + 1;
        return {
          ok: true as const,
          values: [{
            type: APPLICATION_TAG.BIT_STRING,
            value: bitStringForBits(bitsUsed, supported),
          }],
        };
      }
      case PROPERTY_ID.MAX_APDU_LENGTH_ACCEPTED:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.UNSIGNED_INTEGER, value: 1476 }] };
      case PROPERTY_ID.SEGMENTATION_SUPPORTED:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.ENUMERATED, value: BacnetEnums.Segmentation.NO_SEGMENTATION }] };
      case PROPERTY_ID.VENDOR_IDENTIFIER:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.UNSIGNED_INTEGER, value: identity.vendorId }] };
      case PROPERTY_ID.SYSTEM_STATUS:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.ENUMERATED, value: BacnetEnums.DeviceStatus.OPERATIONAL }] };
      case PROPERTY_ID.APDU_TIMEOUT:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.UNSIGNED_INTEGER, value: 3000 }] };
      case PROPERTY_ID.NUMBER_OF_APDU_RETRIES:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.UNSIGNED_INTEGER, value: 3 }] };
      case PROPERTY_ID.DATABASE_REVISION:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.UNSIGNED_INTEGER, value: 1 }] };
      case PROPERTY_ID.MAX_INFO_FRAMES:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.UNSIGNED_INTEGER, value: 1 }] };
      case PROPERTY_ID.MAX_MASTER:
        return { ok: true as const, values: [{ type: APPLICATION_TAG.UNSIGNED_INTEGER, value: 127 }] };
      case PROPERTY_ID.OBJECT_LIST: {
        // For DEVICE:2 compatibility, mirror object identifiers against the requested
        // device instance rather than the fake's internal deviceId.
        const objects = this.buildObjectList(instance);
        if (arrayIndex === BacnetEnums.ASN1_ARRAY_ALL) {
          return {
            ok: true as const,
            values: objects.map((obj) => ({
              type: APPLICATION_TAG.OBJECTIDENTIFIER,
              value: { type: obj.type, instance: obj.instance },
            })),
          };
        }
        if (arrayIndex === 0) {
          return { ok: true as const, values: [{ type: APPLICATION_TAG.UNSIGNED_INTEGER, value: objects.length }] };
        }
        if (arrayIndex > 0 && arrayIndex <= objects.length) {
          const obj = objects[arrayIndex - 1];
          return {
            ok: true as const,
            values: [{ type: APPLICATION_TAG.OBJECTIDENTIFIER, value: { type: obj.type, instance: obj.instance } }],
          };
        }
        return {
          ok: false as const,
          errorClass: BacnetEnums.ErrorClass.PROPERTY,
          errorCode: BacnetEnums.ErrorCode.INVALID_ARRAY_INDEX,
        };
      }
      default:
        return {
          ok: false as const,
          errorClass: BacnetEnums.ErrorClass.PROPERTY,
          errorCode: BacnetEnums.ErrorCode.UNKNOWN_PROPERTY,
        };
    }
  }
}
