import { expect } from 'chai';
import sinon from 'sinon';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Bacnet = require('bacstack');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const probe = require('../scripts/bacnet-read-probe');

describe('bacnet-read-probe', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('parses numeric proprietary query specs', () => {
    const query = probe.parseQuerySpec('264:2:4743');
    expect(query).to.deep.equal({
      objectType: 264,
      instance: 2,
      propertyId: 4743,
      index: probe.ASN1_ARRAY_ALL,
    });
  });

  it('parses symbolic query specs with explicit all index', () => {
    const query = probe.parseQuerySpec('DEVICE:2:MODEL_NAME:all');
    expect(query.objectType).to.equal(Bacnet.enum.ObjectType.DEVICE);
    expect(query.instance).to.equal(2);
    expect(query.propertyId).to.equal(Bacnet.enum.PropertyIdentifier.MODEL_NAME);
    expect(query.index).to.equal(probe.ASN1_ARRAY_ALL);
  });

  it('parses explicit numeric array indexes and rejects malformed queries', () => {
    const indexed = probe.parseQuerySpec('DEVICE:2:MODEL_NAME:3');
    expect(indexed.index).to.equal(3);

    expect(() => probe.parseQuerySpec('DEVICE:2')).to.throw('Invalid query');
    expect(() => probe.parseQuerySpec('DEVICE:2:UNKNOWN_PROPERTY')).to.throw('Unknown property id');
  });

  it('parses positional ip and queries', () => {
    const parsed = probe.parseArgs(['192.168.1.20', '264:2:4743', '--json']);
    expect(parsed.ip).to.equal('192.168.1.20');
    expect(parsed.json).to.equal(true);
    expect(parsed.queries).to.have.length(1);
    expect(parsed.queries[0].objectType).to.equal(264);
  });

  it('parses watch options and interval', () => {
    const parsed = probe.parseArgs([
      '--ip',
      '192.0.2.15',
      '--query',
      '264:2:4743',
      '--watch',
      '--interval',
      '250',
      '--changes-only',
    ]);
    expect(parsed.watch).to.equal(true);
    expect(parsed.intervalMs).to.equal(250);
    expect(parsed.changesOnly).to.equal(true);
  });

  it('parses print-baseline for watch mode', () => {
    const parsed = probe.parseArgs([
      '--ip',
      '192.0.2.15',
      '--query',
      '264:2:4743',
      '--watch',
      '--changes-only',
      '--print-baseline',
    ]);
    expect(parsed.watch).to.equal(true);
    expect(parsed.changesOnly).to.equal(true);
    expect(parsed.printBaseline).to.equal(true);
  });

  it('enables watch when changes-only is set', () => {
    const parsed = probe.parseArgs([
      '--ip',
      '192.0.2.15',
      '--query',
      '264:2:4743',
      '--changes-only',
    ]);
    expect(parsed.watch).to.equal(true);
    expect(parsed.changesOnly).to.equal(true);
  });

  it('rejects invalid mode values', () => {
    expect(() => probe.parseArgs(['--ip', '127.0.0.1', '--mode', 'bad', '--query', '264:2:4743']))
      .to.throw('Invalid mode');
  });

  it('rejects invalid numeric arguments and unknown flags', () => {
    expect(() => probe.parseNumber('1.5', 'target port')).to.throw('target port must be an integer');
    expect(() => probe.parseNumber('0', 'timeout', 1)).to.throw('timeout must be >= 1');
    expect(() => probe.parseArgs(['--ip', '127.0.0.1', '--query', '264:2:4743', '--bogus']))
      .to.throw('Unknown argument "--bogus"');
    expect(() => probe.parseArgs(['--query', '264:2:4743'])).to.throw('Missing --ip');
    expect(() => probe.parseArgs(['--ip', '127.0.0.1'])).to.throw('At least one --query is required');
  });

  it('supports help mode parsing by exiting cleanly', () => {
    const exitStub = sinon.stub(process, 'exit').callsFake(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const logStub = sinon.stub(console, 'log');

    expect(() => probe.parseArgs(['--help'])).to.throw('exit:0');
    expect(exitStub.calledOnceWithExactly(0)).to.equal(true);
    expect(logStub.called).to.equal(true);
  });

  it('rejects missing values for required flags', () => {
    expect(() => probe.parseArgs(['--ip', '--query', '264:2:4743']))
      .to.throw('Missing value after --ip');
    expect(() => probe.parseArgs(['--ip', '127.0.0.1', '--query', '--json']))
      .to.throw('Missing value after --query');
  });

  it('normalizes BACnet error values', () => {
    const normalized = probe.normalizeBacnetValue({
      type: Bacnet.enum.ApplicationTags.ERROR,
      value: { errorClass: 1, errorCode: 31 },
    });
    expect(normalized).to.deep.equal({
      type: 'ERROR',
      errorClass: 1,
      errorCode: 31,
    });
  });

  it('renders normalized values and helper names across fallback paths', () => {
    expect(probe.objectTypeName(99999)).to.equal('99999');
    expect(probe.propertyName(88888)).to.equal('88888');
    expect(probe.appTagName(77777)).to.equal('77777');
    expect(probe.formatIndex(5)).to.equal('5');
    expect(probe.normalizedValueText(null)).to.equal('<no-value>');
    expect(probe.normalizedValueText({ type: 'ERROR', errorClass: 1, errorCode: 31 }))
      .to.equal('ERROR(1:31)');
    expect(probe.renderNormalizedValues([])).to.equal('<empty>');
  });

  it('extracts readProperty nodes from packed values', () => {
    const nodes = probe.extractReadPropertyNodes({
      values: [{
        value: [{ type: Bacnet.enum.ApplicationTags.REAL, value: 1.5 }],
      }],
    });
    expect(nodes).to.deep.equal([{ type: Bacnet.enum.ApplicationTags.REAL, value: 1.5 }]);
  });

  it('covers direct and empty readProperty node extraction branches', () => {
    const direct = probe.extractReadPropertyNodes({
      values: [{ type: Bacnet.enum.ApplicationTags.REAL, value: 9.5 }],
    });
    expect(direct).to.deep.equal([{ type: Bacnet.enum.ApplicationTags.REAL, value: 9.5 }]);
    expect(probe.extractReadPropertyNodes({ values: [] })).to.deep.equal([]);
    expect(probe.extractReadPropertyNodes(null)).to.deep.equal([]);
  });

  it('groups readPropertyMultiple requests by object id', async () => {
    const queries = [
      {
        objectType: Bacnet.enum.ObjectType.ANALOG_VALUE,
        instance: 60,
        propertyId: Bacnet.enum.PropertyIdentifier.PRESENT_VALUE,
        index: probe.ASN1_ARRAY_ALL,
      },
      {
        objectType: Bacnet.enum.ObjectType.ANALOG_VALUE,
        instance: 60,
        propertyId: 5093,
        index: probe.ASN1_ARRAY_ALL,
      },
      {
        objectType: Bacnet.enum.ObjectType.DEVICE,
        instance: 2,
        propertyId: Bacnet.enum.PropertyIdentifier.MODEL_NAME,
        index: probe.ASN1_ARRAY_ALL,
      },
    ];

    let capturedIp = '';
    let capturedRequest: any[] = [];
    const client = {
      readPropertyMultiple: (
        ip: string,
        requestArray: any[],
        _opts: Record<string, unknown>,
        callback: (err: unknown, value: unknown) => void,
      ) => {
        capturedIp = ip;
        capturedRequest = requestArray;
        callback(null, { values: [] });
      },
    };

    const result = await probe.readPropertyMultiple(client, '192.0.2.10', queries);

    expect(capturedIp).to.equal('192.0.2.10');
    expect(capturedRequest).to.have.length(2);
    expect(capturedRequest[0].objectId).to.deep.equal({
      type: Bacnet.enum.ObjectType.ANALOG_VALUE,
      instance: 60,
    });
    expect(capturedRequest[0].properties).to.have.length(2);
    expect(result.requestArray).to.have.length(2);
  });

  it('rejects readProperty and readPropertyMultiple failures', async () => {
    const query = {
      objectType: Bacnet.enum.ObjectType.ANALOG_VALUE,
      instance: 60,
      propertyId: Bacnet.enum.PropertyIdentifier.PRESENT_VALUE,
      index: probe.ASN1_ARRAY_ALL,
    };

    let rpError: Error | null = null;
    try {
      await probe.readProperty({
        readProperty: (
          _ip: string,
          _objectId: Record<string, number>,
          _propertyId: number,
          _options: Record<string, unknown>,
          callback: (err: unknown) => void,
        ) => callback(new Error('rp failed')),
      }, '192.0.2.10', query);
    } catch (error) {
      rpError = error as Error;
    }

    let rpmError: Error | null = null;
    try {
      await probe.readPropertyMultiple({
        readPropertyMultiple: (
          _ip: string,
          _requestArray: any[],
          _options: Record<string, unknown>,
          callback: (err: unknown) => void,
        ) => callback(new Error('rpm failed')),
      }, '192.0.2.10', [query]);
    } catch (error) {
      rpmError = error as Error;
    }

    expect(rpError?.message).to.equal('rp failed');
    expect(rpmError?.message).to.equal('rpm failed');
  });

  it('forwards explicit array index in readProperty mode', async () => {
    const query = {
      objectType: Bacnet.enum.ObjectType.ANALOG_VALUE,
      instance: 60,
      propertyId: Bacnet.enum.PropertyIdentifier.PRESENT_VALUE,
      index: 3,
    };

    let capturedOptions: Record<string, unknown> = {};
    const client = {
      readProperty: (
        ip: string,
        objectId: { type: number; instance: number },
        propertyId: number,
        options: Record<string, unknown>,
        callback: (err: unknown, value: unknown) => void,
      ) => {
        expect(ip).to.equal('192.0.2.10');
        expect(objectId).to.deep.equal({ type: Bacnet.enum.ObjectType.ANALOG_VALUE, instance: 60 });
        expect(propertyId).to.equal(Bacnet.enum.PropertyIdentifier.PRESENT_VALUE);
        capturedOptions = options;
        callback(null, { values: [{ type: Bacnet.enum.ApplicationTags.REAL, value: 70 }] });
      },
    };

    const value = await probe.readProperty(client, '192.0.2.10', query);
    expect(capturedOptions).to.deep.equal({ arrayIndex: 3 });
    expect(value).to.deep.equal({ values: [{ type: Bacnet.enum.ApplicationTags.REAL, value: 70 }] });
  });

  it('formats helper output for index and values', () => {
    expect(probe.formatIndex(probe.ASN1_ARRAY_ALL)).to.equal('all');
    expect(probe.renderBacnetValue({ type: Bacnet.enum.ApplicationTags.REAL, value: 1.25 }))
      .to.include('REAL=');
  });

  it('renders BACnet values across no-value and error branches', () => {
    expect(probe.renderBacnetValue(null)).to.equal('<no-value>');
    expect(probe.renderBacnetValue({
      type: Bacnet.enum.ApplicationTags.ERROR,
      value: { errorClass: 1, errorCode: 31 },
    })).to.equal('ERROR(1:31)');
    expect(probe.normalizeBacnetValue(null)).to.equal(null);
  });

  it('normalizes rpm property/object results and composes snapshot keys', () => {
    const rawProp = {
      property: { id: Bacnet.enum.PropertyIdentifier.PRESENT_VALUE, index: probe.ASN1_ARRAY_ALL },
      value: [{ type: Bacnet.enum.ApplicationTags.REAL, value: 42.5 }],
    };
    const normalizedProp = probe.normalizePropertyResult(rawProp);
    expect(normalizedProp).to.deep.equal({
      property: { id: Bacnet.enum.PropertyIdentifier.PRESENT_VALUE, index: probe.ASN1_ARRAY_ALL },
      value: [{ type: 'REAL', value: 42.5 }],
    });

    const normalizedObjects = probe.normalizeRpmObjects([
      {
        objectId: { type: Bacnet.enum.ObjectType.ANALOG_VALUE, instance: 60 },
        values: [rawProp],
      },
    ]);
    expect(normalizedObjects).to.deep.equal([
      {
        objectId: { type: Bacnet.enum.ObjectType.ANALOG_VALUE, instance: 60 },
        values: [normalizedProp],
      },
    ]);

    expect(
      probe.snapshotEntryKey(
        { type: Bacnet.enum.ObjectType.ANALOG_VALUE, instance: 60 },
        { id: Bacnet.enum.PropertyIdentifier.PRESENT_VALUE, index: probe.ASN1_ARRAY_ALL },
      ),
    ).to.equal('ANALOG_VALUE:60 PRESENT_VALUE(85)[all]');
  });

  it('computes snapshot diffs for changed, added, and removed entries', () => {
    const previous = new Map<string, any>([
      ['ANALOG_VALUE:60 PRESENT_VALUE(85)[all]', [{ type: 'REAL', value: 10 }]],
      ['ANALOG_VALUE:61 PRESENT_VALUE(85)[all]', [{ type: 'REAL', value: 20 }]],
    ]);
    const current = new Map<string, any>([
      ['ANALOG_VALUE:60 PRESENT_VALUE(85)[all]', [{ type: 'REAL', value: 11 }]],
      ['ANALOG_VALUE:62 PRESENT_VALUE(85)[all]', [{ type: 'REAL', value: 30 }]],
    ]);

    const changes = probe.diffSnapshots(previous, current);
    expect(changes).to.deep.equal([
      {
        key: 'ANALOG_VALUE:60 PRESENT_VALUE(85)[all]',
        kind: 'changed',
        before: [{ type: 'REAL', value: 10 }],
        after: [{ type: 'REAL', value: 11 }],
      },
      {
        key: 'ANALOG_VALUE:61 PRESENT_VALUE(85)[all]',
        kind: 'removed',
        before: [{ type: 'REAL', value: 20 }],
        after: undefined,
      },
      {
        key: 'ANALOG_VALUE:62 PRESENT_VALUE(85)[all]',
        kind: 'added',
        before: undefined,
        after: [{ type: 'REAL', value: 30 }],
      },
    ]);
  });

  it('builds empty snapshots for nullish or empty rp/rpm inputs', () => {
    const rpFromNull = probe.buildSnapshotFromRpResponses(null as any);
    const rpFromUndefined = probe.buildSnapshotFromRpResponses(undefined as any);
    const rpFromEmpty = probe.buildSnapshotFromRpResponses([]);
    const rpmFromNull = probe.buildSnapshotFromRpmResponse(null as any);
    const rpmFromUndefined = probe.buildSnapshotFromRpmResponse(undefined as any);
    const rpmFromEmpty = probe.buildSnapshotFromRpmResponse([]);

    expect(rpFromNull).to.be.instanceOf(Map);
    expect(rpFromUndefined).to.be.instanceOf(Map);
    expect(rpFromEmpty).to.be.instanceOf(Map);
    expect(rpmFromNull).to.be.instanceOf(Map);
    expect(rpmFromUndefined).to.be.instanceOf(Map);
    expect(rpmFromEmpty).to.be.instanceOf(Map);
    expect((rpFromNull as Map<unknown, unknown>).size).to.equal(0);
    expect((rpFromUndefined as Map<unknown, unknown>).size).to.equal(0);
    expect((rpFromEmpty as Map<unknown, unknown>).size).to.equal(0);
    expect((rpmFromNull as Map<unknown, unknown>).size).to.equal(0);
    expect((rpmFromUndefined as Map<unknown, unknown>).size).to.equal(0);
    expect((rpmFromEmpty as Map<unknown, unknown>).size).to.equal(0);
  });

  it('builds snapshots with stable keys for rp and rpm normalized payloads', () => {
    const rpSnapshot = probe.buildSnapshotFromRpResponses([
      {
        objectId: { type: Bacnet.enum.ObjectType.ANALOG_VALUE, instance: 60 },
        property: { id: Bacnet.enum.PropertyIdentifier.PRESENT_VALUE, index: probe.ASN1_ARRAY_ALL },
        values: [{ type: 'REAL', value: 50 }],
      },
    ]);
    const rpmSnapshot = probe.buildSnapshotFromRpmResponse([
      {
        objectId: { type: Bacnet.enum.ObjectType.ANALOG_VALUE, instance: 60 },
        values: [
          {
            property: { id: Bacnet.enum.PropertyIdentifier.PRESENT_VALUE, index: probe.ASN1_ARRAY_ALL },
            value: [{ type: 'REAL', value: 50 }],
          },
        ],
      },
    ]);
    const expectedKey = 'ANALOG_VALUE:60 PRESENT_VALUE(85)[all]';
    expect(Array.from(rpSnapshot.keys())).to.deep.equal([expectedKey]);
    expect(Array.from(rpmSnapshot.keys())).to.deep.equal([expectedKey]);
  });

  it('compares values deeply independent of key order and with float tolerance', () => {
    expect(probe.valuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).to.equal(true);
    expect(probe.valuesEqual(
      [{ type: 'REAL', value: 10.0000001 }],
      [{ type: 'REAL', value: 10.0000002 }],
    )).to.equal(true);
    expect(probe.valuesEqual(
      [{ type: 'REAL', value: 10.0001 }],
      [{ type: 'REAL', value: 10.0002 }],
    )).to.equal(false);
  });

  it('covers strict comparison branches for valuesEqual', () => {
    expect(probe.valuesEqual(NaN, NaN)).to.equal(true);
    expect(probe.valuesEqual(null, undefined)).to.equal(false);
    expect(probe.valuesEqual([1, 2], [1])).to.equal(false);
    expect(probe.valuesEqual([1], { 0: 1 })).to.equal(false);
    expect(probe.valuesEqual({ a: 1 }, { a: 1, b: 2 })).to.equal(false);
    expect(probe.valuesEqual({ a: 1 }, { b: 1 })).to.equal(false);
  });

  it('creates a baseline payload that nests the initial poll values', () => {
    const timestamp = '2026-03-07T12:00:00.000Z';
    expect(probe.createWatchBaselinePayload(
      {
        mode: 'rp',
        responses: [{
          objectId: { type: Bacnet.enum.ObjectType.ANALOG_INPUT, instance: 5 },
          property: { id: Bacnet.enum.PropertyIdentifier.PRESENT_VALUE, index: probe.ASN1_ARRAY_ALL },
          values: [{ type: 'REAL', value: 1234 }],
        }],
      },
      timestamp,
      1,
      1,
    )).to.deep.equal({
      mode: 'watch',
      kind: 'baseline',
      timestamp,
      iteration: 1,
      size: 1,
      payload: {
        mode: 'rp',
        responses: [{
          objectId: { type: Bacnet.enum.ObjectType.ANALOG_INPUT, instance: 5 },
          property: { id: Bacnet.enum.PropertyIdentifier.PRESENT_VALUE, index: probe.ASN1_ARRAY_ALL },
          values: [{ type: 'REAL', value: 1234 }],
        }],
      },
    });
  });
});
