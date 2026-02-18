import { expect } from 'chai';
import { createRequire } from 'module';

// eslint-disable-next-line import/extensions
import { getFreePort, sleep } from './test_utils.ts';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/extensions
const fakeUnit = require('../scripts/fake-unit.ts');

describe('fake-unit runtime script', () => {
  it('derives stable device IDs from serials', () => {
    const a = fakeUnit.deriveDeviceIdFromSerial('800131-123456');
    const b = fakeUnit.deriveDeviceIdFromSerial('800131123456');
    expect(a).to.equal(b);
    expect(a).to.be.greaterThan(999);
  });

  it('parses cli options', () => {
    const options = fakeUnit.parseArgs([
      '--bind', '127.0.0.1',
      '--advertise-ip', '127.0.0.1',
      '--api-port', '19000',
      '--bacnet-port', '47999',
      '--serial', '800131-999999',
      '--device-id', '1234',
      '--quiet',
    ]);

    expect(options.bindAddress).to.equal('127.0.0.1');
    expect(options.advertiseAddress).to.equal('127.0.0.1');
    expect(options.apiPort).to.equal(19000);
    expect(options.bacnetPort).to.equal(47999);
    expect(options.serial).to.equal('800131-999999');
    expect(options.deviceId).to.equal(1234);
    expect(options.logTraffic).to.equal(false);
  });

  it('rejects missing values for value flags', () => {
    expect(() => fakeUnit.parseArgs(['--api-port', '--quiet']))
      .to.throw('Missing value for --api-port');
  });

  it('supports help mode without starting servers', async () => {
    const result = await fakeUnit.main(['--help']);
    expect(result).to.equal(null);
  });

  it('starts and stops full fake-unit runtime', async () => {
    const apiPort = await getFreePort();
    const bacnetPort = await getFreePort();
    const options = fakeUnit.parseArgs([
      '--bind', '127.0.0.1',
      '--advertise-ip', '127.0.0.1',
      '--api-port', String(apiPort),
      '--bacnet-port', String(bacnetPort),
      '--quiet',
      '--periodic-iam-ms', '0',
      '--tick-ms', '50',
    ]);

    const runtime = await fakeUnit.startFakeUnit(options, false);
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/health`);
      expect(response.status).to.equal(200);
      const json = await response.json();
      expect(json.ok).to.equal(true);
    } finally {
      runtime.shutdown();
      await sleep(50);
    }
  });
});
