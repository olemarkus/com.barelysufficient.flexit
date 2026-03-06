/* eslint-disable import/extensions */
import { expect } from 'chai';
import { createRequire } from 'module';

// eslint-disable-next-line import/extensions
import { getFreePort } from './test_utils.ts';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FakeApiServer } = require('../scripts/fake-unit/apiServer.ts');
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

describe('fake-unit api server', () => {
  it('serves feature and debug routes', async () => {
    const state = createState();
    const port = await getFreePort();
    const server = new FakeApiServer(state, { host: '127.0.0.1', port });
    await server.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      {
        const { response, json } = await request(baseUrl, 'GET', '/health');
        expect(response.status).to.equal(200);
        expect(json.ok).to.equal(true);
      }

      {
        const { response, json } = await request(baseUrl, 'GET', '/debug/state');
        expect(response.status).to.equal(200);
        expect(json.ok).to.equal(true);
        expect(json.state).to.be.an('object');
      }

      {
        const { response, json } = await request(baseUrl, 'GET', '/debug/points');
        expect(response.status).to.equal(200);
        expect(json.ok).to.equal(true);
        expect(json.points).to.be.an('array');
      }

      {
        const { response, json } = await request(baseUrl, 'GET', '/summary');
        expect(response.status).to.equal(200);
        expect(json.ok).to.equal(true);
        expect(json.summary).to.be.an('object');
      }

      {
        const { response, json } = await request(baseUrl, 'GET', '/debug/manifest');
        expect(response.status).to.equal(200);
        expect(json.ok).to.equal(true);
        expect(json.bacnet.documentedPoints).to.be.an('array');
        expect(json.bacnet.proprietaryCompatibility).to.be.an('object');
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/mode', { mode: 'invalid' });
        expect(response.status).to.equal(400);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/mode', { mode: 'home' });
        expect(response.status).to.equal(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/setpoint', { value: 'abc' });
        expect(response.status).to.equal(400);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/setpoint', { value: 21.5, target: 'away' });
        expect(response.status).to.equal(200);
      }

      {
        const { response, json } = await request(baseUrl, 'POST', '/feature/setpoint', { value: 20.5 });
        expect(response.status).to.equal(200);
        expect(json.state.points).to.be.an('array');
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/setpoint', { value: '21.5', target: 'away' });
        expect(response.status).to.equal(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/debug/write', { value: 12 });
        expect(response.status).to.equal(400);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/debug/write', {
          type: 2,
          instance: 1994,
          value: 22,
          priority: 13,
        });
        expect(response.status).to.equal(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/debug/write', {
          type: '2',
          instance: '1994',
          value: '22',
          priority: '13',
        });
        expect(response.status).to.equal(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/debug/advance', { seconds: 0 });
        expect(response.status).to.equal(400);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/debug/advance', { seconds: 120 });
        expect(response.status).to.equal(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/filter/set', {});
        expect(response.status).to.equal(400);
      }

      {
        const { response } = await request(
          baseUrl,
          'POST',
          '/feature/filter/set',
          { operatingHours: 200, limitHours: 4000 },
        );
        expect(response.status).to.equal(200);
      }

      {
        const { response } = await request(
          baseUrl,
          'POST',
          '/feature/filter/set',
          { operatingHours: -1 },
        );
        expect(response.status).to.equal(409);
      }

      {
        const { response } = await request(
          baseUrl,
          'POST',
          '/feature/filter/set',
          { limitHours: -1 },
        );
        expect(response.status).to.equal(409);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/filter/replace');
        expect(response.status).to.equal(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/rapid/start', { minutes: 'invalid' });
        expect(response.status).to.equal(400);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/rapid/start', { minutes: 10 });
        expect(response.status).to.equal(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/rapid/start', { minutes: '10' });
        expect(response.status).to.equal(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/rapid/start');
        expect(response.status).to.equal(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/fireplace/start', { minutes: 'invalid' });
        expect(response.status).to.equal(400);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/fireplace/start', { minutes: 15 });
        expect(response.status).to.equal(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/fireplace/start', { minutes: '15' });
        expect(response.status).to.equal(200);
      }

      {
        const { response } = await request(baseUrl, 'POST', '/feature/fireplace/start');
        expect(response.status).to.equal(200);
      }

      {
        const { response, json } = await request(baseUrl, 'GET', '/missing-route');
        expect(response.status).to.equal(404);
        expect(json.error).to.equal('not_found');
      }

      {
        const response = await fetch(`${baseUrl}/feature/mode`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"mode"',
        });
        expect(response.status).to.equal(400);
        const json = await response.json();
        expect(json).to.deep.equal({ ok: false, error: 'invalid_json' });
      }

      {
        const response = await fetch(`${baseUrl}/feature/mode`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: 'x'.repeat(512_100),
        });
        expect(response.status).to.equal(413);
        const json = await response.json();
        expect(json).to.deep.equal({ ok: false, error: 'request_too_large' });
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
      expect(response.status).to.equal(500);
      expect(await response.json()).to.deep.equal({ ok: false, error: 'internal_error' });
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
      expect((await request(baseUrl, 'POST', '/feature/mode', { mode: 'home' })).response.status).to.equal(409);
      expect((await request(baseUrl, 'POST', '/feature/setpoint', { value: 21, target: 'away' })).response.status)
        .to.equal(409);
      expect((await request(baseUrl, 'POST', '/feature/setpoint', { value: 21 })).response.status)
        .to.equal(409);
      expect((await request(baseUrl, 'POST', '/feature/rapid/start', { minutes: 10 })).response.status)
        .to.equal(409);
      expect((await request(baseUrl, 'POST', '/feature/fireplace/start', { minutes: 10 })).response.status)
        .to.equal(409);
    } finally {
      server.stop();
      server.stop();
    }
  });
});
