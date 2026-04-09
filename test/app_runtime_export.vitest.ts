import { afterEach, describe, expect, it, vi } from 'vitest';

const createFlexitAppClass = vi.fn(() => ({ appExport: true }));
const installSourceMapSupport = vi.fn();

vi.mock('homey', () => ({
  default: {
    App: class MockHomeyApp {},
  },
}));

vi.mock('source-map-support', () => ({
  default: {
    install: installSourceMapSupport,
  },
}));

vi.mock('../lib/createAppClass', () => ({
  createFlexitAppClass,
}));

vi.mock('../lib/UnitRegistry', async () => {
  const actual = await vi.importActual<typeof import('../lib/UnitRegistry')>('../lib/UnitRegistry');
  return actual;
});

describe('app runtime export', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('builds the Homey app class through the injected factory', async () => {
    const appModule = await import('../app');
    const unitRegistry = await import('../lib/UnitRegistry');
    const homey = await import('homey');

    expect(createFlexitAppClass).toHaveBeenCalledTimes(1);
    expect(createFlexitAppClass).toHaveBeenCalledWith({
      HomeyApp: homey.default.App,
      registry: unitRegistry.Registry,
      isFanProfileMode: unitRegistry.isFanProfileMode,
      normalizeFanProfilePercent: unitRegistry.normalizeFanProfilePercent,
      normalizeFireplaceDurationMinutes: unitRegistry.normalizeFireplaceDurationMinutes,
      installSourceMapSupport: expect.any(Function),
    });

    expect(appModule.default).toEqual({ appExport: true });

    const options = createFlexitAppClass.mock.calls[0][0];
    options.installSourceMapSupport();
    expect(installSourceMapSupport).toHaveBeenCalledTimes(1);
  });
});
