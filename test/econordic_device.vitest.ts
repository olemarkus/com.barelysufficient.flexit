import sinon from 'sinon';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeLogger, RuntimeLogger } from '../lib/logging';
import { findStructuredLog } from './logging_test_utils';

class MockExperimentalBaseDevice {
  log = sinon.stub();
  error = sinon.stub();
  onInitSpy = sinon.stub().resolves();
  private runtimeLogger?: RuntimeLogger;

  getLogger() {
    if (!this.runtimeLogger) {
      this.runtimeLogger = createRuntimeLogger(this, { component: 'device' });
    }
    return this.runtimeLogger;
  }

  async onInit() {
    await this.onInitSpy();
  }
}

vi.mock('../lib/FlexitBacnetDevice', () => ({
  FlexitBacnetDevice: MockExperimentalBaseDevice,
}));

vi.mock('../lib/FlexitCloudDevice', () => ({
  FlexitCloudDevice: MockExperimentalBaseDevice,
}));

describe('EcoNordic devices (vitest)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('warns that the local EcoNordic datapoint map is unverified before initializing', async () => {
    const mod = await import('../drivers/econordic/device.ts');
    const DeviceClass = mod.default ?? mod;
    const device = new DeviceClass();

    await device.onInit();

    const log = findStructuredLog(device.log, 'device.experimental');
    expect(log?.series).toBe('econordic');
    expect(log?.transport).toBe('bacnet');
    expect(device.onInitSpy.calledOnce).toBe(true);
  });

  it('warns that the cloud EcoNordic datapoint map is unverified before initializing', async () => {
    const mod = await import('../drivers/econordic-cloud/device.ts');
    const DeviceClass = mod.default ?? mod;
    const device = new DeviceClass();

    await device.onInit();

    const log = findStructuredLog(device.log, 'device.experimental');
    expect(log?.series).toBe('econordic');
    expect(log?.transport).toBe('cloud');
    expect(device.onInitSpy.calledOnce).toBe(true);
  });
});
