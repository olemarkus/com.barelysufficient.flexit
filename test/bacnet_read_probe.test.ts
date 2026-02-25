import { expect } from 'chai';

const Bacnet = require('bacstack');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const probe = require('../scripts/bacnet-read-probe');

describe('bacnet-read-probe', () => {
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

  it('extracts readProperty nodes from packed values', () => {
    const nodes = probe.extractReadPropertyNodes({
      values: [{
        value: [{ type: Bacnet.enum.ApplicationTags.REAL, value: 1.5 }],
      }],
    });
    expect(nodes).to.deep.equal([{ type: Bacnet.enum.ApplicationTags.REAL, value: 1.5 }]);
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
      readPropertyMultiple: (ip: string, requestArray: any[], _opts: Record<string, unknown>, callback: (err: unknown, value: unknown) => void) => {
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
});
