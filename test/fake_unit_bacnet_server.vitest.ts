/* eslint-disable import/extensions */
import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

import Bacnet from 'bacstack';
const require = createRequire(import.meta.url);
const Bvlc = require('bacstack/lib/bvlc');
const Npdu = require('bacstack/lib/npdu');
const Apdu = require('bacstack/lib/apdu');
const Services = require('bacstack/lib/services');
import { FakeBacnetServer } from '../scripts/fake-unit/bacnetServer.ts';
import {
  DEFAULT_DEVICE_NAME,
  DEFAULT_FIRMWARE,
  FLEXIT_GO_COMPAT_DEVICE_INSTANCE,
  FLEXIT_GO_LOGIN_OBJECT_INSTANCE,
  FLEXIT_GO_LOGIN_OBJECT_TYPE,
  FLEXIT_GO_LOGIN_PROPERTY_ID,
  FLEXIT_GO_PRIORITY_HINT_PROPERTY_ID,
  DEFAULT_MODEL_NAME,
  OBJECT_TYPE,
  PROPERTY_ID,
  DEFAULT_VENDOR_ID,
  DEFAULT_VENDOR_NAME,
} from '../scripts/fake-unit/manifest.ts';
import { FakeNordicUnitState } from '../scripts/fake-unit/state.ts';

const BacnetEnums = Bacnet.enum;

type CapturedResponse = {
  readPropertyMultiple: Array<{ address: string; invokeId: number; values: any[] }>;
  readProperty: Array<{ address: string; invokeId: number; objectId: any; property: any; values: any[] }>;
  errors: Array<{ address: string; serviceChoice: number; invokeId: number; errorClass: number; errorCode: number }>;
  acks: Array<{ address: string; serviceChoice: number; invokeId: number }>;
  iams: Array<{ deviceId: number; segmentation: number; vendorId: number }>;
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
    iams: [],
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
    iAmResponse: (deviceId: number, segmentation: number, vendorId: number) => {
      captured.iams.push({ deviceId, segmentation, vendorId });
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
            objectId: { type: BacnetEnums.ObjectType.BINARY_VALUE, instance: 445 },
            properties: [
              { id: BacnetEnums.PropertyIdentifier.PRESENT_VALUE, index: BacnetEnums.ASN1_ARRAY_ALL },
              { id: 5093, index: BacnetEnums.ASN1_ARRAY_ALL },
            ],
          },
          {
            objectId: { type: BacnetEnums.ObjectType.ANALOG_VALUE, instance: 1921 },
            properties: [{ id: BacnetEnums.PropertyIdentifier.PRESENT_VALUE, index: BacnetEnums.ASN1_ARRAY_ALL }],
          },
          {
            objectId: { type: BacnetEnums.ObjectType.ANALOG_VALUE, instance: 1987 },
            properties: [{ id: BacnetEnums.PropertyIdentifier.PRESENT_VALUE, index: BacnetEnums.ASN1_ARRAY_ALL }],
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
            properties: [{
              id: BacnetEnums.PropertyIdentifier.APPLICATION_SOFTWARE_VERSION,
              index: BacnetEnums.ASN1_ARRAY_ALL,
            }],
          },
        ],
      },
    });

    expect(captured.readPropertyMultiple).toHaveLength(1);
    const rpmResult = captured.readPropertyMultiple[0].values;
    expect(findNode(rpmResult, 264, 2, 4743)?.type)
      .toBe(BacnetEnums.ApplicationTags.CHARACTER_STRING);
    expect(
      findNode(
        rpmResult,
        BacnetEnums.ObjectType.ANALOG_VALUE,
        2275,
        BacnetEnums.PropertyIdentifier.PRESENT_VALUE,
      )?.type,
    )
      .toBe(BacnetEnums.ApplicationTags.REAL);
    expect(findNode(rpmResult, BacnetEnums.ObjectType.MULTI_STATE_VALUE, 42, 5093)?.type)
      .toBe(BacnetEnums.ApplicationTags.UNSIGNED_INTEGER);
    expect(
      findNode(
        rpmResult,
        BacnetEnums.ObjectType.BINARY_VALUE,
        445,
        BacnetEnums.PropertyIdentifier.PRESENT_VALUE,
      )?.type,
    )
      .toBe(BacnetEnums.ApplicationTags.ENUMERATED);
    expect(findNode(rpmResult, BacnetEnums.ObjectType.BINARY_VALUE, 445, 5093)?.type)
      .toBe(BacnetEnums.ApplicationTags.UNSIGNED_INTEGER);
    expect(
      findNode(
        rpmResult,
        BacnetEnums.ObjectType.ANALOG_VALUE,
        1921,
        BacnetEnums.PropertyIdentifier.PRESENT_VALUE,
      )?.type,
    )
      .toBe(BacnetEnums.ApplicationTags.REAL);
    expect(
      findNode(
        rpmResult,
        BacnetEnums.ObjectType.ANALOG_VALUE,
        1987,
        BacnetEnums.PropertyIdentifier.PRESENT_VALUE,
      )?.type,
    )
      .toBe(BacnetEnums.ApplicationTags.REAL);
    expect(
      findNode(
        rpmResult,
        BacnetEnums.ObjectType.ANALOG_VALUE,
        1837,
        BacnetEnums.PropertyIdentifier.PRESENT_VALUE,
      )?.type,
    )
      .toBe(BacnetEnums.ApplicationTags.REAL);
    expect(findNode(rpmResult, BacnetEnums.ObjectType.ANALOG_VALUE, 1837, 5037)?.type)
      .toBe(BacnetEnums.ApplicationTags.REAL);
    expect(findNode(rpmResult, BacnetEnums.ObjectType.ANALOG_VALUE, 1837, 5036)?.type)
      .toBe(BacnetEnums.ApplicationTags.REAL);
    expect(
      findNode(
        rpmResult,
        BacnetEnums.ObjectType.DEVICE,
        2,
        BacnetEnums.PropertyIdentifier.APPLICATION_SOFTWARE_VERSION,
      )?.type,
    )
      .toBe(BacnetEnums.ApplicationTags.CHARACTER_STRING);

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

    expect(captured.readPropertyMultiple).toHaveLength(2);
    const unknownResult = captured.readPropertyMultiple[1].values;
    expect(
      findNode(
        unknownResult,
        BacnetEnums.ObjectType.ANALOG_VALUE,
        999999,
        BacnetEnums.PropertyIdentifier.PRESENT_VALUE,
      )?.type,
    )
      .toBe(BacnetEnums.ApplicationTags.ERROR);

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

    expect(captured.acks).toHaveLength(1);
    expect(captured.acks[0].serviceChoice).toBe(BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY);

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
    expect(
      findNode(
        afterWriteResult,
        BacnetEnums.ObjectType.ANALOG_VALUE,
        1994,
        BacnetEnums.PropertyIdentifier.PRESENT_VALUE,
      )?.value,
    )
      .toBe(22.5);

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
    ))).toBe(true);

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
    ))).toBe(true);

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
    expect(highLimitResponse?.values[0]?.type).toBe(BacnetEnums.ApplicationTags.REAL);
    expect(highLimitResponse?.values[0]?.value).toBe(100);
    expect(lowLimitResponse?.values[0]?.type).toBe(BacnetEnums.ApplicationTags.REAL);
    expect(lowLimitResponse?.values[0]?.value).toBe(30);
    expect(captured.errors.some((error) => error.invokeId === 7 || error.invokeId === 8)).toBe(false);

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

    expect(udpSends).toHaveLength(2);
    expect(udpSends[0].address).toBe('192.0.2.10');
    expect(udpSends[0].port).toBe(47808);
    expect(udpSends[1].address).toBe('255.255.255.255');
    expect(udpSends[1].port).toBe(47808);

    const firstPayloadAscii = udpSends[0].buffer
      .subarray(0, udpSends[0].length)
      .toString('latin1')
      .replace(/[^\x20-\x7E]+/g, '.');
    expect(firstPayloadAscii.includes('identification') || firstPayloadAscii.includes('ABTMobile')).toBe(true);
  });

  it('responds to whoIs only when the device id is within the requested range', () => {
    const { server, captured } = createHarness();
    const identity = (server as any).state.getIdentity();

    (server as any).handleWhoIs({
      address: '127.0.0.1',
      lowLimit: identity.deviceId + 1,
    });
    (server as any).handleWhoIs({
      address: '127.0.0.1',
      highLimit: identity.deviceId - 1,
    });
    expect(captured.iams).toHaveLength(0);

    (server as any).handleWhoIs({
      address: '127.0.0.1',
      lowLimit: identity.deviceId,
      highLimit: identity.deviceId,
    });
    expect(captured.iams).toEqual([{
      deviceId: identity.deviceId,
      segmentation: BacnetEnums.Segmentation.NO_SEGMENTATION,
      vendorId: identity.vendorId,
    }]);
  });

  it('reads documented, alias, overlay, and login object properties directly', () => {
    const { server } = createHarness();
    const identity = (server as any).state.getIdentity();

    const objectName = (server as any).readPropertyValue(
      { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1994 },
      PROPERTY_ID.OBJECT_NAME,
    );
    expect(objectName.ok).toBe(true);

    const units = (server as any).readPropertyValue(
      { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1994 },
      PROPERTY_ID.UNITS,
    );
    expect(units.ok).toBe(true);

    const minValue = (server as any).readPropertyValue(
      { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1994 },
      PROPERTY_ID.MIN_PRES_VALUE,
    );
    expect(minValue.ok).toBe(true);

    const minUnsupported = (server as any).readPropertyValue(
      { type: OBJECT_TYPE.BINARY_VALUE, instance: 445 },
      PROPERTY_ID.MIN_PRES_VALUE,
    );
    expect(minUnsupported.ok).toBe(false);

    const nonArrayPresentValue = (server as any).readPropertyValue(
      { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1994 },
      PROPERTY_ID.PRESENT_VALUE,
      1,
    );
    expect(nonArrayPresentValue.ok).toBe(false);
    expect(nonArrayPresentValue.errorCode).toBe(BacnetEnums.ErrorCode.PROPERTY_IS_NOT_AN_ARRAY);

    const aliasDescription = (server as any).readPropertyValue(
      { type: OBJECT_TYPE.DEVICE, instance: FLEXIT_GO_COMPAT_DEVICE_INSTANCE },
      PROPERTY_ID.DESCRIPTION,
    );
    expect(aliasDescription.ok).toBe(true);
    expect(aliasDescription.values[0].value).toBe(identity.serial);

    const objectList = (server as any).readPropertyValue(
      { type: OBJECT_TYPE.DEVICE, instance: identity.deviceId },
      PROPERTY_ID.OBJECT_LIST,
      BacnetEnums.ASN1_ARRAY_ALL,
    );
    expect(objectList.ok).toBe(true);
    expect(objectList.values.length).toBeGreaterThan(1);

    const objectListCount = (server as any).readPropertyValue(
      { type: OBJECT_TYPE.DEVICE, instance: identity.deviceId },
      PROPERTY_ID.OBJECT_LIST,
      0,
    );
    expect(objectListCount.ok).toBe(true);
    expect(objectListCount.values[0].value).toBe(objectList.values.length);

    const objectListEntry = (server as any).readPropertyValue(
      { type: OBJECT_TYPE.DEVICE, instance: identity.deviceId },
      PROPERTY_ID.OBJECT_LIST,
      1,
    );
    expect(objectListEntry.ok).toBe(true);

    const objectListInvalid = (server as any).readPropertyValue(
      { type: OBJECT_TYPE.DEVICE, instance: identity.deviceId },
      PROPERTY_ID.OBJECT_LIST,
      99999,
    );
    expect(objectListInvalid.ok).toBe(false);
    expect(objectListInvalid.errorCode).toBe(BacnetEnums.ErrorCode.INVALID_ARRAY_INDEX);

    const loginProperty = (server as any).readPropertyValue(
      { type: FLEXIT_GO_LOGIN_OBJECT_TYPE, instance: FLEXIT_GO_LOGIN_OBJECT_INSTANCE },
      FLEXIT_GO_LOGIN_PROPERTY_ID,
    );
    expect(loginProperty.ok).toBe(true);

    const loginArrayError = (server as any).readPropertyValue(
      { type: FLEXIT_GO_LOGIN_OBJECT_TYPE, instance: FLEXIT_GO_LOGIN_OBJECT_INSTANCE },
      FLEXIT_GO_LOGIN_PROPERTY_ID,
      1,
    );
    expect(loginArrayError.ok).toBe(false);

    const overlayValue = (server as any).readPropertyValue(
      { type: OBJECT_TYPE.BINARY_VALUE, instance: 445 },
      FLEXIT_GO_PRIORITY_HINT_PROPERTY_ID,
    );
    expect(overlayValue.ok).toBe(true);

    const overlayArrayError = (server as any).readPropertyValue(
      { type: OBJECT_TYPE.BINARY_VALUE, instance: 445 },
      FLEXIT_GO_PRIORITY_HINT_PROPERTY_ID,
      1,
    );
    expect(overlayArrayError.ok).toBe(false);
  });

  it('returns readProperty errors for malformed and unsupported requests', () => {
    const { server, captured } = createHarness();

    (server as any).handleReadProperty({
      address: '127.0.0.1',
      invokeId: 1,
      request: {},
    });
    expect(captured.errors.pop()).to.deep.include({
      serviceChoice: BacnetEnums.ConfirmedServiceChoice.READ_PROPERTY,
      errorClass: BacnetEnums.ErrorClass.SERVICES,
      errorCode: BacnetEnums.ErrorCode.INVALID_TAG,
    });

    (server as any).handleReadProperty({
      address: '127.0.0.1',
      invokeId: 2,
      request: {
        objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 999999 },
        property: { id: PROPERTY_ID.PRESENT_VALUE, index: BacnetEnums.ASN1_ARRAY_ALL },
      },
    });
    expect(captured.errors.pop()).to.deep.include({
      serviceChoice: BacnetEnums.ConfirmedServiceChoice.READ_PROPERTY,
      errorClass: BacnetEnums.ErrorClass.OBJECT,
      errorCode: BacnetEnums.ErrorCode.UNKNOWN_OBJECT,
    });

    (server as any).handleReadProperty({
      address: '127.0.0.1',
      invokeId: 3,
      request: {
        objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1994 },
        property: { id: PROPERTY_ID.PRESENT_VALUE, index: 1 },
      },
    });
    expect(captured.errors.pop()).to.deep.include({
      serviceChoice: BacnetEnums.ConfirmedServiceChoice.READ_PROPERTY,
      errorClass: BacnetEnums.ErrorClass.PROPERTY,
      errorCode: BacnetEnums.ErrorCode.PROPERTY_IS_NOT_AN_ARRAY,
    });

    (server as any).handleReadProperty({
      address: '127.0.0.1',
      invokeId: 4,
      request: {
        objectId: { type: OBJECT_TYPE.DEVICE, instance: 2222 },
        property: { id: PROPERTY_ID.OBJECT_NAME, index: BacnetEnums.ASN1_ARRAY_ALL },
      },
    });
    expect(captured.readProperty).toHaveLength(1);
    expect(captured.readProperty[0].values[0].value).toBe(DEFAULT_DEVICE_NAME);
  });

  it('returns writeProperty errors for malformed, invalid, and denied writes', () => {
    const { server, captured } = createHarness();

    (server as any).handleWriteProperty({
      address: '127.0.0.1',
      invokeId: 1,
      request: {
        value: {
          property: { id: PROPERTY_ID.PRESENT_VALUE },
          value: [{ type: BacnetEnums.ApplicationTags.REAL, value: 22 }],
        },
      },
    });
    expect(captured.errors.pop()).to.deep.include({
      serviceChoice: BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY,
      errorClass: BacnetEnums.ErrorClass.SERVICES,
      errorCode: BacnetEnums.ErrorCode.INVALID_TAG,
    });

    (server as any).handleWriteProperty({
      address: '127.0.0.1',
      invokeId: 2,
      request: {
        objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1994 },
        value: {
          property: { id: PROPERTY_ID.PRESENT_VALUE },
          value: [{ type: BacnetEnums.ApplicationTags.CHARACTER_STRING, value: 'bad' }],
        },
      },
    });
    expect(captured.errors.pop()).to.deep.include({
      serviceChoice: BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY,
      errorClass: BacnetEnums.ErrorClass.PROPERTY,
      errorCode: BacnetEnums.ErrorCode.INVALID_DATA_TYPE,
    });

    (server as any).handleWriteProperty({
      address: '127.0.0.1',
      invokeId: 3,
      request: {
        objectId: { type: OBJECT_TYPE.ANALOG_INPUT, instance: 4 },
        value: {
          property: { id: PROPERTY_ID.PRESENT_VALUE },
          value: [{ type: BacnetEnums.ApplicationTags.REAL, value: 22 }],
          priority: 13,
        },
      },
    });
    expect(captured.errors.pop()).to.deep.include({
      serviceChoice: BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY,
      errorClass: BacnetEnums.ErrorClass.PROPERTY,
      errorCode: BacnetEnums.ErrorCode.WRITE_ACCESS_DENIED,
    });
  });

  it('returns writePropertyMultiple errors and acknowledges valid multi-writes', () => {
    const { server, captured } = createHarness();

    (server as any).handleWritePropertyMultiple({
      address: '127.0.0.1',
      invokeId: 1,
      request: {
        objectId: null,
        values: [],
      },
    });
    expect(captured.errors.pop()).to.deep.include({
      serviceChoice: BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE,
      errorClass: BacnetEnums.ErrorClass.SERVICES,
      errorCode: BacnetEnums.ErrorCode.INVALID_TAG,
    });

    (server as any).handleWritePropertyMultiple({
      address: '127.0.0.1',
      invokeId: 2,
      request: {
        objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1994 },
        values: [{ value: [{ type: BacnetEnums.ApplicationTags.REAL, value: 22 }] }],
      },
    });
    expect(captured.errors.pop()).to.deep.include({
      serviceChoice: BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE,
      errorClass: BacnetEnums.ErrorClass.PROPERTY,
      errorCode: BacnetEnums.ErrorCode.UNKNOWN_PROPERTY,
    });

    (server as any).handleWritePropertyMultiple({
      address: '127.0.0.1',
      invokeId: 3,
      request: {
        objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1994 },
        values: [{
          property: { id: PROPERTY_ID.PRESENT_VALUE },
          value: [{ type: BacnetEnums.ApplicationTags.CHARACTER_STRING, value: 'bad' }],
        }],
      },
    });
    expect(captured.errors.pop()).to.deep.include({
      serviceChoice: BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE,
      errorClass: BacnetEnums.ErrorClass.PROPERTY,
      errorCode: BacnetEnums.ErrorCode.INVALID_DATA_TYPE,
    });

    (server as any).handleWritePropertyMultiple({
      address: '127.0.0.1',
      invokeId: 4,
      request: {
        objectId: { type: OBJECT_TYPE.ANALOG_INPUT, instance: 4 },
        values: [{
          property: { id: PROPERTY_ID.PRESENT_VALUE },
          value: [{ type: BacnetEnums.ApplicationTags.REAL, value: 22 }],
          priority: 13,
        }],
      },
    });
    expect(captured.errors.pop()).to.deep.include({
      serviceChoice: BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE,
      errorClass: BacnetEnums.ErrorClass.PROPERTY,
      errorCode: BacnetEnums.ErrorCode.WRITE_ACCESS_DENIED,
    });

    (server as any).handleWritePropertyMultiple({
      address: '127.0.0.1',
      invokeId: 5,
      request: {
        objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1994 },
        values: [{
          property: { id: PROPERTY_ID.PRESENT_VALUE },
          value: [{ type: BacnetEnums.ApplicationTags.REAL, value: 21.5 }],
          priority: 13,
        }],
      },
    });
    expect(captured.acks.pop()).toEqual({
      address: '127.0.0.1',
      serviceChoice: BacnetEnums.ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE,
      invokeId: 5,
    });
  });
});
