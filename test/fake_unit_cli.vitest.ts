import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sinon from 'sinon';

import * as cli from '../scripts/fake-unit-cli.ts';

function sampleSummaryPayload() {
  return {
    summary: {
      mode: 'home',
      setpoints: { home: 20, away: 18 },
      temperatures: {
        supply: 19.5,
        extract: 21,
        outdoor: 2,
        room: 21.5,
      },
      humidity: {
        extract: 35,
        room: 36,
      },
      fan: {
        supplyPercent: 80,
        extractPercent: 79,
        supplyRpm: 3100,
        extractRpm: 3000,
      },
      filter: {
        operatingHours: 1200,
        limitHours: 4380,
        remainingPercent: 72.6,
      },
      timers: {
        rapidMinutes: 0,
        fireplaceMinutes: 0,
        awayDelayMinutes: 0,
      },
    },
  };
}

describe('fake-unit cli', () => {
  const originalFetch = global.fetch;
  let consoleLogStub: sinon.SinonStub;

  beforeEach(() => {
    consoleLogStub = sinon.stub(console, 'log');
  });

  afterEach(() => {
    consoleLogStub.restore();
    global.fetch = originalFetch;
  });

  it('parses api base flag and fallback env', () => {
    const parsed = cli.parseApiBase(['mode', 'home', '--api', 'http://localhost:9999']);
    expect(parsed.args).toEqual(['mode', 'home']);
    expect(parsed.apiBase).toBe('http://localhost:9999');

    process.env.FLEXIT_FAKE_API = 'http://localhost:18080';
    const parsedFromEnv = cli.parseApiBase(['status']);
    expect(parsedFromEnv.apiBase).toBe('http://localhost:18080');
    delete process.env.FLEXIT_FAKE_API;
  });

  it('does not consume the next flag when --api has no value', () => {
    const parsed = cli.parseApiBase(['status', '--api', '--help']);
    expect(parsed.apiBase).toBe('http://127.0.0.1:18080');
    expect(parsed.args).toEqual(['status', '--help']);
  });

  it('uses the default API base when no flag or env override is present', () => {
    delete process.env.FLEXIT_FAKE_API;
    const parsed = cli.parseApiBase(['status']);
    expect(parsed.apiBase).toBe('http://127.0.0.1:18080');
  });

  it('returns informative API errors and parse failures', async () => {
    global.fetch = (async () => new Response('upstream boom', { status: 500 })) as typeof fetch;
    let didThrow = false;
    try {
      await cli.callApi('http://127.0.0.1:18080', { method: 'GET', path: '/summary' });
    } catch (error: any) {
      didThrow = true;
      expect(String(error.message)).toContain('HTTP 500: upstream boom');
    }
    expect(didThrow).toBe(true);

    global.fetch = (async () => new Response('not-json', { status: 200 })) as typeof fetch;
    didThrow = false;
    try {
      await cli.callApi('http://127.0.0.1:18080', { method: 'GET', path: '/summary' });
    } catch (error: any) {
      didThrow = true;
      expect(String(error.message)).toContain('Failed to parse API response as JSON');
      expect(String(error.message)).toContain('not-json');
    }
    expect(didThrow).toBe(true);

    global.fetch = (async () => new Response('', { status: 200 })) as typeof fetch;
    const empty = await cli.callApi('http://127.0.0.1:18080', { method: 'GET', path: '/summary' });
    expect(empty).toBe(null);
  });

  it('runs feature commands through the API', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: String(init?.method || 'GET') });

      if (url.endsWith('/summary')) {
        return new Response(JSON.stringify(sampleSummaryPayload()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const base = 'http://127.0.0.1:18080';

    expect(await cli.runFeatureCommand(base, 'status', [])).toBe(true);
    expect(await cli.runFeatureCommand(base, 'mode', ['home'])).toBe(true);
    expect(await cli.runFeatureCommand(base, 'setpoint', ['21.5', 'away'])).toBe(true);
    expect(await cli.runFeatureCommand(base, 'rapid', ['15'])).toBe(true);
    expect(await cli.runFeatureCommand(base, 'fireplace', ['20'])).toBe(true);
    expect(await cli.runFeatureCommand(base, 'filter', ['status'])).toBe(true);
    expect(await cli.runFeatureCommand(base, 'filter', ['replace'])).toBe(true);
    expect(await cli.runFeatureCommand(base, 'filter', ['age', '1500'])).toBe(true);
    expect(await cli.runFeatureCommand(base, 'filter', ['limit', '5000'])).toBe(true);
    expect(await cli.runFeatureCommand(base, 'unknown', [])).toBe(false);

    expect(calls.some((entry) => entry.url.endsWith('/feature/mode'))).toBe(true);
    expect(calls.some((entry) => entry.url.endsWith('/feature/filter/set'))).toBe(true);
  });

  it('prints raw payloads when summary or filter details are unavailable', async () => {
    cli.printSummary({ ok: true });
    expect(consoleLogStub.calledOnce).toBe(true);
    expect(consoleLogStub.firstCall.args[0]).toBe(JSON.stringify({ ok: true }, null, 2));

    consoleLogStub.resetHistory();
    global.fetch = (async () => new Response(JSON.stringify({ summary: { mode: 'home' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    const handled = await cli.runFeatureCommand('http://127.0.0.1:18080', 'filter', ['status']);
    expect(handled).toBe(true);
    expect(consoleLogStub.calledOnce).toBe(true);
    expect(consoleLogStub.firstCall.args[0]).toBe(JSON.stringify({ summary: { mode: 'home' } }, null, 2));
  });

  it('defaults setpoint target to home and supports omitted rapid or fireplace minutes', async () => {
    const requests: Array<{ path: string; body?: any }> = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ path: url.pathname, body });
      if (url.pathname === '/summary') {
        return new Response(JSON.stringify(sampleSummaryPayload()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    expect(await cli.runFeatureCommand('http://127.0.0.1:18080', 'setpoint', ['22.5'])).toBe(true);
    expect(await cli.runFeatureCommand('http://127.0.0.1:18080', 'rapid', [])).toBe(true);
    expect(await cli.runFeatureCommand('http://127.0.0.1:18080', 'fireplace', [])).toBe(true);

    expect(requests.find((request) => request.path === '/feature/setpoint')?.body).toEqual({
      value: 22.5,
      target: 'home',
    });
    expect(requests.find((request) => request.path === '/feature/rapid/start')?.body).toEqual({});
    expect(requests.find((request) => request.path === '/feature/fireplace/start')?.body).toEqual({});
  });

  it('routes debug commands through main()', async () => {
    const requests: Array<{ path: string; body?: any }> = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({
        path: url.pathname,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await cli.main(['state']);
    await cli.main(['points']);
    await cli.main(['advance', '120']);
    await cli.main(['write', '2', '1994', '21.5']);
    await cli.main(['write', '2', '1994', '21.5', '13']);

    expect(requests.map((request) => request.path)).toEqual([
      '/debug/state',
      '/debug/points',
      '/debug/advance',
      '/debug/write',
      '/debug/write',
    ]);
    expect(requests[2].body).toEqual({ seconds: 120 });
    expect(requests[3].body).toEqual({ type: 2, instance: 1994, value: 21.5 });
    expect(requests[4].body).toEqual({
      type: 2,
      instance: 1994,
      value: 21.5,
      priority: 13,
    });
  });

  it('prints usage for help and rejects missing or unknown commands', async () => {
    await cli.main(['help']);
    expect(consoleLogStub.called).toBe(true);

    let missingModeError: Error | null = null;
    try {
      await cli.runFeatureCommand('http://127.0.0.1:18080', 'mode', []);
    } catch (error) {
      missingModeError = error as Error;
    }

    let unknownCommandError: Error | null = null;
    try {
      await cli.main(['unknown']);
    } catch (error) {
      unknownCommandError = error as Error;
    }

    expect(missingModeError?.message).toBe('mode is required');
    expect(unknownCommandError?.message).toBe('Unknown command: unknown');
  });

  it('errors on invalid arguments', async () => {
    expect(() => cli.parseNumber('abc', 'hours')).toThrow('hours must be numeric');

    let didThrow = false;
    try {
      await cli.runFeatureCommand('http://127.0.0.1:18080', 'filter', ['unknown']);
    } catch (error: any) {
      didThrow = true;
      expect(String(error.message)).toContain('Unknown filter command');
    }
    expect(didThrow).toBe(true);
  });
});
