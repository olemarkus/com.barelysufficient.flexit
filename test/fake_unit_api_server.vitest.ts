/* eslint-disable import/extensions */
import { describe, expect, it } from 'vitest';

import { getFreePort } from './test_utils.ts';
import { FakeApiServer } from '../scripts/fake-unit/apiServer.ts';
import {
  DEFAULT_DEVICE_NAME,
  DEFAULT_FIRMWARE,
  DEFAULT_MODEL_NAME,
  DEFAULT_VENDOR_ID,
  DEFAULT_VENDOR_NAME,
} from '../scripts/fake-unit/manifest.ts';
import { FakeNordicUnitState } from '../scripts/fake-unit/state.ts';

function createState() {
  return new FakeNordicUnitState({
    identity: {
      deviceId: 2,
      serial: '800131-123456',
      modelName: DEFAULT_MODEL_NAME,
      deviceName: DEFAULT_DEVICE_NAME,
      firmware: DEFAULT_FIRMWARE,
      vendorName: DEFAULT_VENDOR_NAME,
      vendorId: DEFAULT_VENDOR_ID,
    },
    timeScale: 30,
  });
}

async function request(
  baseUrl: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await response.json();
  } catch (_error) {
  }
  return { response, json };
}

describe('fake-unit api server (vitest)', () => {
  it('serves feature and debug routes', async () => {
    const state = createState();
    const port = await getFreePort();
    const server = new FakeApiServer(state, { host: '127.0.0.1', port });
    await server.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      {
        const { response, json } = await request(baseUrl, 'GET', '/health');
        expect(response.status).toBe(200);
        expect(json.ok).toBe(true);
      }

      {
        const { response, json } = await request(baseUrl, 'GET', '/debug/state');
        expect(response.status).toBe(200);
        expect(json.ok).toBe(true);
        expect(json.state).toEqual(expect.any(Object));
      }

      {
        const { response, json } = await request(baseUrl, 'GET', '/debug/points');
        expect(response.status).toBe(200);
        expect(json.ok).toBe(true);
        expect(json.points).toEqual(expect.any(Array));
      }

      {
        const { response, json } = await request(baseUrl, 'GET', '/summary');
        expect(response.status).toBe(200);
        expect(json.ok).toBe(true);
        expect(json.summary).toEqual(expect.any(Object));
      }

      {
        const { response, json } = await request(baseUrl, 'GET', '/debug/manifest');
        expect(response.status).toBe(200);
        expect(json.ok).toBe(true);
        expect(json.bacnet.documentedPoints).toEqual(expect.any(Array));
        expect(json.bacnet.proprietaryCompatibility).toEqual(expect.any(Object));
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/mode', { mode: 'invalid' });
        expect(response.status).toBe(400);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/mode', { mode: 'home' });
        expect(response.status).toBe(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/setpoint', { value: 'abc' });
        expect(response.status).toBe(400);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/setpoint', { value: 21.5, target: 'away' });
        expect(response.status).toBe(200);
      }

      {
        const { response, json } = await request(baseUrl, 'POST', '/feature/setpoint', { value: 20.5 });
        expect(response.status).toBe(200);
        expect(json.state.points).toEqual(expect.any(Array));
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/setpoint', { value: '21.5', target: 'away' });
        expect(response.status).toBe(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/debug/write', { value: 12 });
        expect(response.status).toBe(400);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/debug/write', {
          type: 2,
          instance: 1994,
          value: 22,
          priority: 13,
        });
        expect(response.status).toBe(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/debug/write', {
          type: '2',
          instance: '1994',
          value: '22',
          priority: '13',
        });
        expect(response.status).toBe(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/debug/advance', { seconds: 0 });
        expect(response.status).toBe(400);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/debug/advance', { seconds: 120 });
        expect(response.status).toBe(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/filter/set', {});
        expect(response.status).toBe(400);
      }

      {
        const { response } = await request(
          baseUrl,
          'POST',
          '/feature/filter/set',
          { operatingHours: 200, limitHours: 4000 },
        );
        expect(response.status).toBe(200);
      }

      {
        const { response } = await request(
          baseUrl,
          'POST',
          '/feature/filter/set',
          { operatingHours: -1 },
        );
        expect(response.status).toBe(409);
      }

      {
        const { response } = await request(
          baseUrl,
          'POST',
          '/feature/filter/set',
          { limitHours: -1 },
        );
        expect(response.status).toBe(409);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/filter/replace');
        expect(response.status).toBe(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/rapid/start', { minutes: 'invalid' });
        expect(response.status).toBe(400);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/rapid/start', { minutes: 10 });
        expect(response.status).toBe(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/rapid/start', { minutes: '10' });
        expect(response.status).toBe(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/rapid/start');
        expect(response.status).toBe(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/fireplace/start', { minutes: 'invalid' });
        expect(response.status).toBe(400);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/fireplace/start', { minutes: 15 });
        expect(response.status).toBe(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/fireplace/start', { minutes: '15' });
        expect(response.status).toBe(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/fireplace/start');
        expect(response.status).toBe(200);
      }

      {
        const { response, json } = await request(baseUrl, 'GET', '/missing-route');
        expect(response.status).toBe(404);
        expect(json.error).toBe('not_found');
      }

      {
        const response = await fetch(`${baseUrl}/feature/mode`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"mode"',
        });
        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ ok: false, error: 'invalid_json' });
      }

      {
        const response = await fetch(`${baseUrl}/feature/mode`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: 'x'.repeat(512_100),
        });
        expect(response.status).toBe(413);
        const json = await response.json();
        expect(json).toEqual({ ok: false, error: 'request_too_large' });
      }
    } finally {
      server.stop();
    }
  });

  it('returns internal_error when state methods throw unexpectedly', async () => {
    const state = {
      summary: () => {
        throw new Error('boom');
      },
    } as any;
    const port = await getFreePort();
    const server = new FakeApiServer(state, { host: '127.0.0.1', port });
    await server.start();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/summary`);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ ok: false, error: 'internal_error' });
    } finally {
      server.stop();
    }
  });

  it('keeps fireplace active when the start endpoint is called repeatedly', async () => {
    const state = createState();
    const port = await getFreePort();
    const server = new FakeApiServer(state, { host: '127.0.0.1', port });
    await server.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const firstStart = await request(baseUrl, 'POST', '/feature/fireplace/start', { minutes: 18 });
      expect(firstStart.response.status).toBe(200);
      expect(firstStart.json.state.mode).toBe('fireplace');
      expect(firstStart.json.state.timers.fireplaceMinutes).toBeCloseTo(18, 1);

      state.advanceSimulatedSeconds(60);
      const activeRemaining = state.summary().timers.fireplaceMinutes;
      expect(activeRemaining).toBeLessThan(17.5);

      const secondStart = await request(baseUrl, 'POST', '/feature/fireplace/start', { minutes: 12 });
      expect(secondStart.response.status).toBe(200);
      expect(secondStart.json.state.mode).toBe('fireplace');
      expect(secondStart.json.state.timers.fireplaceMinutes).toBeCloseTo(12, 1);
    } finally {
      server.stop();
    }
  });

  it('returns 409 for action routes when state operations fail and start/stop stay idempotent', async () => {
    const failure = {
      ok: false,
      errorClass: 1,
      errorCode: 31,
      message: 'denied',
    };
    const state = {
      setFanMode: () => failure,
      setAwaySetpoint: () => failure,
      setHomeSetpoint: () => failure,
      startRapid: () => failure,
      startFireplace: () => failure,
    } as any;
    const port = await getFreePort();
    const server = new FakeApiServer(state, { host: '127.0.0.1', port });
    await server.start();
    await server.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      expect((await request(baseUrl, 'POST', '/feature/mode', { mode: 'home' })).response.status).toBe(409);
      expect((await request(baseUrl, 'POST', '/feature/setpoint', { value: 21, target: 'away' })).response.status)
        .toBe(409);
      expect((await request(baseUrl, 'POST', '/feature/setpoint', { value: 21 })).response.status)
        .toBe(409);
      expect((await request(baseUrl, 'POST', '/feature/rapid/start', { minutes: 10 })).response.status)
        .toBe(409);
      expect((await request(baseUrl, 'POST', '/feature/fireplace/start', { minutes: 10 })).response.status)
        .toBe(409);
    } finally {
      server.stop();
      server.stop();
    }
  });
});
