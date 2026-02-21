/* eslint-disable import/extensions */
import { expect } from 'chai';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Bacnet = require('bacstack');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Bvlc = require('bacstack/lib/bvlc');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Npdu = require('bacstack/lib/npdu');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Apdu = require('bacstack/lib/apdu');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Services = require('bacstack/lib/services');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FakeBacnetServer } = require('../scripts/fake-unit/bacnetServer.ts');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  DEFAULT_DEVICE_NAME,
  DEFAULT_FIRMWARE,
  DEFAULT_MODEL_NAME,
  DEFAULT_VENDOR_ID,
  DEFAULT_VENDOR_NAME,
} = require('../scripts/fake-unit/manifest.ts');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FakeNordicUnitState } = require('../scripts/fake-unit/state.ts');

const BacnetEnums = Bacnet.enum;

type CapturedResponse = {
  readPropertyMultiple: Array<{ address: string; invokeId: number; values: any[] }>;
  readProperty: Array<{ address: string; invokeId: number; objectId: any; property: any; values: any[] }>;
  errors: Array<{ address: string; serviceChoice: number; invokeId: number; errorClass: number; errorCode: number }>;
  acks: Array<{ address: string; serviceChoice: number; invokeId: number }>;
};

type UdpSend = {
  buffer: Buffer;
  offset: number;
  length: number;
  port: number;
  address: string;
};

function createState() {
  return new FakeNordicUnitState({
    identity: {
      deviceId: 2222,
      serial: '800131-123456',
      modelName: DEFAULT_MODEL_NAME,
      deviceName: DEFAULT_DEVICE_NAME,
      firmware: DEFAULT_FIRMWARE,
      vendorName: DEFAULT_VENDOR_NAME,
      vendorId: DEFAULT_VENDOR_ID,
    },
    timeScale: 10,
  });
}

function findNode(result: any[], objectType: number, instance: number, propertyId: number) {
  const object = (result || []).find(
    (entry: any) => entry.objectId?.type === objectType && entry.objectId?.instance === instance,
  );
  const property = (object?.values || []).find(
    (entry: any) => (entry.property?.id ?? entry.id) === propertyId,
  );
  return property?.value?.[0];
}

function createHarness() {
  const state = createState();
  const server = new FakeBacnetServer(state, {
    port: 47808,
    bindAddress: '127.0.0.1',
    advertiseAddress: '127.0.0.1',
    logTraffic: false,
    periodicIAmMs: 0,
  });

  const captured: CapturedResponse = {
    readPropertyMultiple: [],
    readProperty: [],
    errors: [],
    acks: [],
  };
  const udpSends: UdpSend[] = [];

  const fakeSocket = {
    on: () => undefined,
    off: () => undefined,
    send: (buffer: Buffer, offset: number, length: number, port: number, address: string) => {
      udpSends.push({
        buffer: Buffer.from(buffer),
        offset,
        length,
        port,
        address,
      });
    },
  };

  // Directly inject a stubbed bacstack client to exercise server handlers without socket flakiness.
  (server as any).client = {
    readPropertyMultipleResponse: (address: string, invokeId: number, values: any[]) => {
      captured.readPropertyMultiple.push({ address, invokeId, values });
    },
    readPropertyResponse: (address: string, invokeId: number, objectId: any, property: any, values: any[]) => {
      captured.readProperty.push({
        address,
        invokeId,
        objectId,
        property,
        values,
      });
    },
    errorResponse: (
      address: string,
      serviceChoice: number,
      invokeId: number,
      errorClass: number,
      errorCode: number,
    ) => {
      captured.errors.push({
        address,
        serviceChoice,
        invokeId,
        errorClass,
        errorCode,
      });
    },
    simpleAckResponse: (address: string, serviceChoice: number, invokeId: number) => {
      captured.acks.push({ address, serviceChoice, invokeId });
    },
    _transport: {
      _server: fakeSocket,
    },
  };

  return { server, captured, udpSends };
}

describe('fake-unit bacnet server', () => {
  it('handles rpm/rp/write and private-transfer discovery compatibility', () => {
    const { server, captured, udpSends } = createHarness();

    (server as any).handleReadPropertyMultiple({
      address: '127.0.0.1',
      port: 47808,
      invokeId: 1,
      request: {
        properties: [
          {
            objectId: { type: 264, instance: 2 },
            properties: [{ id: 4743, index: BacnetEnums.ASN1_ARRAY_ALL }],
          },
          {
            objectId: { type: BacnetEnums.ObjectType.ANALOG_VALUE, instance: 2275 },
            properties: [{ id: BacnetEnums.PropertyIdentifier.PRESENT_VALUE, index: BacnetEnums.ASN1_ARRAY_ALL }],
          },
          {
            objectId: { type: BacnetEnums.ObjectType.ANALOG_VALUE, instance: 2113 },
            properties: [{ id: BacnetEnums.PropertyIdentifier.PRESENT_VALUE, index: BacnetEnums.ASN1_ARRAY_ALL }],
          },
          {
            objectId: { type: BacnetEnums.ObjectType.MULTI_STATE_VALUE, instance: 42 },
            properties: [{ id: 5093, index: BacnetEnums.ASN1_ARRAY_ALL }],
          },
          {
            objectId: { type: BacnetEnums.ObjectType.BINARY_VALUE, instance: 50 },
            properties: [{ id: 5093, index: BacnetEnums.ASN1_ARRAY_ALL }],
          },
          {
            objectId: { type: BacnetEnums.ObjectType.ANALOG_VALUE, instance: 1837 },
            properties: [
              { id: BacnetEnums.PropertyIdentifier.PRESENT_VALUE, index: BacnetEnums.ASN1_ARRAY_ALL },
              { id: 5037, index: BacnetEnums.ASN1_ARRAY_ALL },
              { id: 5036, index: BacnetEnums.ASN1_ARRAY_ALL },
            ],
          },
          {
            objectId: { type: BacnetEnums.ObjectType.DEVICE, instance: 2 },
            properties: [{ id: BacnetEnums.PropertyIdentifier.APPLICATION_SOFTWARE_VERSION, index: BacnetEnums.ASN1_ARRAY_ALL }],
          },
        ],
      },
    });

    expect(captured.readPropertyMultiple).to.have.length(1);
    const rpmResult = captured.readPropertyMultiple[0].values;
    expect(findNode(rpmResult, 264, 2, 4743)?.type).to.equal(BacnetEnums.ApplicationTags.CHARACTER_STRING);
    expect(findNode(rpmResult, BacnetEnums.ObjectType.ANALOG_VALUE, 2275, BacnetEnums.PropertyIdentifier.PRESENT_VALUE)?.type)
      .to.equal(BacnetEnums.ApplicationTags.REAL);
    expect(findNode(rpmResult, BacnetEnums.ObjectType.MULTI_STATE_VALUE, 42, 5093)?.type)
      .to.equal(BacnetEnums.ApplicationTags.UNSIGNED_INTEGER);
    expect(findNode(rpmResult, BacnetEnums.ObjectType.ANALOG_VALUE, 1837, BacnetEnums.PropertyIdentifier.PRESENT_VALUE)?.type)
      .to.equal(BacnetEnums.ApplicationTags.REAL);
    expect(findNode(rpmResult, BacnetEnums.ObjectType.ANALOG_VALUE, 1837, 5037)?.type)
      .to.equal(BacnetEnums.ApplicationTags.REAL);
    expect(findNode(rpmResult, BacnetEnums.ObjectType.ANALOG_VALUE, 1837, 5036)?.type)
      .to.equal(BacnetEnums.ApplicationTags.REAL);
    expect(findNode(rpmResult, BacnetEnums.ObjectType.DEVICE, 2, BacnetEnums.PropertyIdentifier.APPLICATION_SOFTWARE_VERSION)?.type)
      .to.equal(BacnetEnums.ApplicationTags.CHARACTER_STRING);

    (server as any).handleReadPropertyMultiple({
      address: '127.0.0.1',
      invokeId: 2,
      request: {
        properties: [{
          objectId: { type: BacnetEnums.ObjectType.ANALOG_VALUE, instance: 999999 },
          properties: [{ id: BacnetEnums.PropertyIdentifier.PRESENT_VALUE, index: BacnetEnums.ASN1_ARRAY_ALL }],
        }],
      },
    });

    expect(captured.readPropertyMultiple).to.have.length(2);
    const unknownResult = captured.readPropertyMultiple[1].values;
    expect(findNode(unknownResult, BacnetEnums.ObjectType.ANALOG_VALUE, 999999, BacnetEnums.PropertyIdentifier.PRESENT_VALUE)?.type)
      .to.equal(BacnetEnums.ApplicationTags.ERROR);

    (server as any).handleWriteProperty({
      address: '127.0.0.1',
      invokeId: 3,
      request: {
        objectId: {
          type: BacnetEnums.ObjectType.ANALOG_VALUE,
          instance: 1994,
        },
        value: {
          property: { id: BacnetEnums.PropertyIdentifier.PRESENT_VALUE },
          value: [{ type: BacnetEnums.ApplicationTags.REAL, value: 22.5 }],
          priority: 13,
        },
      },
    });

    expect(captured.acks).to.have.length(1);
    expect(captured.acks[0].serviceChoice).to.equal(BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY);

    (server as any).handleReadPropertyMultiple({
      address: '127.0.0.1',
      invokeId: 4,
      request: {
        properties: [{
          objectId: { type: BacnetEnums.ObjectType.ANALOG_VALUE, instance: 1994 },
          properties: [{ id: BacnetEnums.PropertyIdentifier.PRESENT_VALUE, index: BacnetEnums.ASN1_ARRAY_ALL }],
        }],
      },
    });
    const afterWriteResult = captured.readPropertyMultiple[2].values;
    expect(findNode(afterWriteResult, BacnetEnums.ObjectType.ANALOG_VALUE, 1994, BacnetEnums.PropertyIdentifier.PRESENT_VALUE)?.value)
      .to.equal(22.5);

    (server as any).handleWriteProperty({
      address: '127.0.0.1',
      invokeId: 5,
      request: {
        objectId: {
          type: BacnetEnums.ObjectType.ANALOG_VALUE,
          instance: 1994,
        },
        value: {
          property: { id: BacnetEnums.PropertyIdentifier.PRESENT_VALUE },
          value: [{ type: BacnetEnums.ApplicationTags.REAL, value: 21 }],
          priority: 12,
        },
      },
    });
    expect(captured.errors.some((error) => (
      error.invokeId === 5 && error.serviceChoice === BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY
    ))).to.equal(true);

    (server as any).handleReadProperty({
      address: '127.0.0.1',
      invokeId: 6,
      request: {
        objectId: {
          type: BacnetEnums.ObjectType.ANALOG_VALUE,
          instance: 1994,
        },
        property: {
          id: 9999,
          index: BacnetEnums.ASN1_ARRAY_ALL,
        },
      },
    });

    expect(captured.errors.some((error) => (
      error.invokeId === 6 && error.serviceChoice === BacnetEnums.ConfirmedServiceChoice.READ_PROPERTY
    ))).to.equal(true);

    (server as any).handleReadProperty({
      address: '127.0.0.1',
      invokeId: 7,
      request: {
        objectId: {
          type: BacnetEnums.ObjectType.ANALOG_VALUE,
          instance: 1844,
        },
        property: {
          id: BacnetEnums.PropertyIdentifier.HIGH_LIMIT,
          index: BacnetEnums.ASN1_ARRAY_ALL,
        },
      },
    });

    (server as any).handleReadProperty({
      address: '127.0.0.1',
      invokeId: 8,
      request: {
        objectId: {
          type: BacnetEnums.ObjectType.ANALOG_VALUE,
          instance: 1844,
        },
        property: {
          id: BacnetEnums.PropertyIdentifier.LOW_LIMIT,
          index: BacnetEnums.ASN1_ARRAY_ALL,
        },
      },
    });

    const highLimitResponse = captured.readProperty.find((entry) => entry.invokeId === 7);
    const lowLimitResponse = captured.readProperty.find((entry) => entry.invokeId === 8);
    expect(highLimitResponse?.values[0]?.type).to.equal(BacnetEnums.ApplicationTags.REAL);
    expect(highLimitResponse?.values[0]?.value).to.equal(100);
    expect(lowLimitResponse?.values[0]?.type).to.equal(BacnetEnums.ApplicationTags.REAL);
    expect(lowLimitResponse?.values[0]?.value).to.equal(30);
    expect(captured.errors.some((error) => error.invokeId === 7 || error.invokeId === 8)).to.equal(false);

    const packet = {
      buffer: Buffer.alloc(1482),
      offset: 4,
    };
    Npdu.encode(packet, BacnetEnums.NpduControlPriority.NORMAL_MESSAGE, undefined, undefined, 0xff);
    Apdu.encodeUnconfirmedServiceRequest(
      packet,
      BacnetEnums.PduTypes.UNCONFIRMED_REQUEST,
      BacnetEnums.UnconfirmedServiceChoice.UNCONFIRMED_PRIVATE_TRANSFER,
    );
    const discoverToken = 'ABTMobile:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    Services.privateTransfer.encode(
      packet,
      7,
      515,
      Array.from(Buffer.from(discoverToken, 'ascii')),
    );
    Bvlc.encode(packet.buffer, BacnetEnums.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, packet.offset);

    (server as any).handleRawBacnetMessage(
      packet.buffer.subarray(0, packet.offset),
      {
        address: '192.0.2.10',
        family: 'IPv4',
        port: 47808,
        size: packet.offset,
      },
    );

    expect(udpSends).to.have.length(2);
    expect(udpSends[0].address).to.equal('192.0.2.10');
    expect(udpSends[0].port).to.equal(47808);
    expect(udpSends[1].address).to.equal('255.255.255.255');
    expect(udpSends[1].port).to.equal(47808);

    const firstPayloadAscii = udpSends[0].buffer
      .subarray(0, udpSends[0].length)
      .toString('latin1')
      .replace(/[^\x20-\x7E]+/g, '.');
    expect(firstPayloadAscii.includes('identification') || firstPayloadAscii.includes('ABTMobile')).to.equal(true);
  });
});
