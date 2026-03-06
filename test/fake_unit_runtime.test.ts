import { expect } from 'chai';
import { createRequire } from 'module';
import sinon from 'sinon';
import os from 'os';

// eslint-disable-next-line import/extensions
import { getFreePort, sleep } from './test_utils.ts';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const proxyquire = require('proxyquire');
// eslint-disable-next-line import/extensions
const fakeUnit = require('../scripts/fake-unit.ts');

const proxyquireStrict = proxyquire.noCallThru().noPreserveCache();

describe('fake-unit runtime script', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('derives stable device IDs from serials', () => {
    const a = fakeUnit.deriveDeviceIdFromSerial('800131-123456');
    const b = fakeUnit.deriveDeviceIdFromSerial('800131123456');
    expect(a).to.equal(b);
    expect(a).to.be.greaterThan(999);
  });

  it('falls back to the minimum device id for invalid serials', () => {
    expect(fakeUnit.deriveDeviceIdFromSerial('invalid')).to.equal(1000);
  });

  it('falls back when parseNumber receives invalid input', () => {
    expect(fakeUnit.parseNumber('invalid', 42)).to.equal(42);
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

  it('uses detected interface defaults when explicit values are omitted', () => {
    sinon.stub(os, 'networkInterfaces').returns({
      eth0: [{
        address: '192.0.2.20',
        netmask: '255.255.255.0',
        mac: '00:11:22:33:44:55',
        family: 'IPv4',
        internal: false,
        cidr: '192.0.2.20/24',
      } as any],
      lo: [{
        address: '127.0.0.1',
        netmask: '255.0.0.0',
        mac: '00:00:00:00:00:00',
        family: 'IPv4',
        internal: true,
        cidr: '127.0.0.1/8',
      } as any],
    } as any);

    const options = fakeUnit.parseArgs([]);

    expect(options.advertiseAddress).to.equal('192.0.2.20');
    expect(options.networkMask).to.equal('255.255.255.0');
    expect(options.mac).to.equal('00:11:22:33:44:55');
    expect(options.deviceId).to.equal(fakeUnit.deriveDeviceIdFromSerial(options.serial));
  });

  it('rejects missing values for value flags', () => {
    expect(() => fakeUnit.parseArgs(['--api-port', '--quiet']))
      .to.throw('Missing value for --api-port');
  });

  it('supports help mode without starting servers', async () => {
    const result = await fakeUnit.main(['--help']);
    expect(result).to.equal(null);
  });

  it('respects explicit overrides for interface-derived defaults', () => {
    sinon.stub(os, 'networkInterfaces').returns({} as any);

    const options = fakeUnit.parseArgs([
      '--advertise-ip', '198.51.100.20',
      '--netmask', '255.255.0.0',
      '--mac', 'aa:bb:cc:dd:ee:ff',
      '--vendor-id', '42',
      '--time-scale', '120',
      '--periodic-iam-ms', '5000',
      '--tick-ms', '250',
    ]);

    expect(options.advertiseAddress).to.equal('198.51.100.20');
    expect(options.networkMask).to.equal('255.255.0.0');
    expect(options.mac).to.equal('aa:bb:cc:dd:ee:ff');
    expect(options.vendorId).to.equal(42);
    expect(options.timeScale).to.equal(120);
    expect(options.periodicIAmMs).to.equal(5000);
    expect(options.tickMs).to.equal(250);
  });

  it('falls back to bind address and ignores positional argv entries in parseArgs', () => {
    sinon.stub(os, 'networkInterfaces').returns({} as any);

    const options = fakeUnit.parseArgs([
      'positional',
      '--bind', '198.51.100.40',
      '--quiet',
    ]);

    expect(options.bindAddress).to.equal('198.51.100.40');
    expect(options.advertiseAddress).to.equal('198.51.100.40');
    expect(options.logTraffic).to.equal(false);
  });

  it('starts with signal handlers enabled and shutdown is idempotent', async () => {
    const discoveryStart = sinon.stub().resolves();
    const discoveryStop = sinon.stub();
    const bacnetStart = sinon.stub();
    const bacnetStop = sinon.stub();
    const apiStart = sinon.stub().resolves();
    const apiStop = sinon.stub();
    const tick = sinon.stub();
    const processOn = sinon.stub(process, 'on');
    const processOff = sinon.stub(process, 'off');
    const clock = sinon.useFakeTimers();
    const logStub = sinon.stub(console, 'log');

    let stateOptions: any;
    let discoveryOptions: any;

    function MockState(this: any, options: any) {
      stateOptions = options;
      this.tick = tick;
      this.getIdentity = () => ({
        serial: '800131-654321',
        deviceId: 4242,
        modelName: 'Mock Nordic',
      });
    }

    function MockDiscoveryResponder(this: any, options: any) {
      discoveryOptions = options;
      this.start = discoveryStart;
      this.stop = discoveryStop;
    }

    function MockBacnetServer(this: any) {
      this.start = bacnetStart;
      this.stop = bacnetStop;
    }

    function MockApiServer(this: any) {
      this.start = apiStart;
      this.stop = apiStop;
    }

    const runtimeModule = proxyquireStrict('../scripts/fake-unit.ts', {
      os: { networkInterfaces: () => ({}) },
      './fake-unit/state': { FakeNordicUnitState: MockState },
      './fake-unit/discoveryResponder': { DiscoveryResponder: MockDiscoveryResponder },
      './fake-unit/bacnetServer': { FakeBacnetServer: MockBacnetServer },
      './fake-unit/apiServer': { FakeApiServer: MockApiServer },
    });

    const runtime = await runtimeModule.startFakeUnit({
      apiHost: '127.0.0.1',
      apiPort: 18080,
      bacnetPort: 47808,
      bindAddress: undefined,
      advertiseAddress: undefined,
      logTraffic: true,
      serial: '800131-654321',
      deviceId: 4242,
      deviceName: 'Mock Device',
      modelName: 'Mock Nordic',
      firmware: '1.2.3',
      mac: 'aa:bb:cc:dd:ee:ff',
      vendorName: 'Flexit',
      vendorId: 783,
      timeScale: 30,
      periodicIAmMs: 0,
      tickMs: 1000,
    }, true);

    expect(stateOptions.identity.deviceId).to.equal(4242);
    expect(discoveryOptions.advertiseAddress).to.equal('127.0.0.1');
    expect(processOn.calledWith('SIGINT')).to.equal(true);
    expect(processOn.calledWith('SIGTERM')).to.equal(true);

    clock.tick(1000);
    expect(tick.called).to.equal(true);

    runtime.shutdown();
    runtime.shutdown();

    expect(processOff.calledWith('SIGINT')).to.equal(true);
    expect(processOff.calledWith('SIGTERM')).to.equal(true);
    expect(discoveryStop.calledOnce).to.equal(true);
    expect(bacnetStop.calledOnce).to.equal(true);
    expect(apiStop.calledOnce).to.equal(true);
    expect(logStub.calledWithMatch('[FakeUnit] BACnet listening on 0.0.0.0:47808')).to.equal(true);

    logStub.restore();
    clock.restore();
  });

  it('starts via main() when help flags are absent', async () => {
    const fakeRuntime = { shutdown: sinon.stub() };

    function MockState(this: any) {
      this.tick = () => undefined;
      this.getIdentity = () => ({ serial: '800131-654321', deviceId: 42, modelName: 'Mock' });
    }

    function MockDiscoveryResponder(this: any) {
      this.start = () => Promise.resolve();
      this.stop = () => undefined;
    }

    function MockBacnetServer(this: any) {
      this.start = () => undefined;
      this.stop = () => undefined;
    }

    function MockApiServer(this: any) {
      this.start = () => Promise.resolve();
      this.stop = () => undefined;
    }

    const runtimeModule = proxyquireStrict('../scripts/fake-unit.ts', {
      os: { networkInterfaces: () => ({}) },
      './fake-unit/state': { FakeNordicUnitState: MockState },
      './fake-unit/discoveryResponder': { DiscoveryResponder: MockDiscoveryResponder },
      './fake-unit/bacnetServer': { FakeBacnetServer: MockBacnetServer },
      './fake-unit/apiServer': { FakeApiServer: MockApiServer },
    });

    const runtime = await runtimeModule.main(['--quiet']);
    expect(runtime).to.be.an('object');
    (runtime ?? fakeRuntime).shutdown();
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
