import sinon from 'sinon';
import { afterEach, describe, expect, it } from 'vitest';
import { FlexitCloudClient } from '../lib/flexitCloudClient';
import { createRuntimeLogger } from '../lib/logging';
import { findStructuredLog } from './logging_test_utils';

describe('FlexitCloudClient logging', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    sinon.restore();
    global.fetch = originalFetch;
  });

  function createClientWithSink() {
    const sink = { log: sinon.stub(), error: sinon.stub() };
    const client = new FlexitCloudClient({
      logger: createRuntimeLogger(sink, { component: 'cloud_client' }),
    });
    return { client, sink };
  }

  it('logs plant discovery results', async () => {
    const { client, sink } = createClientWithSink();
    client.restoreToken({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 2 * 60 * 60 * 1000,
    });
    global.fetch = sinon.stub().resolves({
      ok: true,
      json: async () => ({
        items: [
          { id: 'plant-1', name: 'Living Room', serialNumber: '800131-000001', isOnline: true },
        ],
      }),
    } as any);

    const plants = await client.findPlants();

    expect(plants).toHaveLength(1);
    expect(findStructuredLog(sink.log, 'cloud.plants.listed')?.plantCount).toBe(1);
  });

  it('logs datapoint reads', async () => {
    const { client, sink } = createClientWithSink();
    client.restoreToken({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 2 * 60 * 60 * 1000,
    });
    global.fetch = sinon.stub().resolves({
      ok: true,
      json: async () => ({
        values: { 'PLANT_123;1!0020007CA000055': { value: { value: 22 } } },
      }),
    } as any);

    const values = await client.readDatapoints('PLANT_123', [';1!0020007CA000055']);

    expect(values['PLANT_123;1!0020007CA000055'].value.value).toBe(22);
    expect(findStructuredLog(sink.log, 'cloud.datapoints.read')).toBeUndefined();
    expect(findStructuredLog(sink.log, 'cloud.http.request.succeeded')).toBeUndefined();
  });

  it('logs unsuccessful datapoint writes when stateTexts are missing', async () => {
    const { client, sink } = createClientWithSink();
    client.restoreToken({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 2 * 60 * 60 * 1000,
    });
    global.fetch = sinon.stub().resolves({
      ok: true,
      json: async () => ({}),
    } as any);

    const success = await client.writeDatapoint('PLANT_123', ';1!0020007CA000055', null);

    expect(success).toBe(false);
    const log = findStructuredLog(sink.log, 'cloud.datapoint.write');
    expect(log?.success).toBe(false);
    expect(log?.value).toBe(null);
  });

  it('logs cloud request failures without dumping the encoded filter payload', async () => {
    const { client, sink } = createClientWithSink();
    client.restoreToken({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 2 * 60 * 60 * 1000,
    });
    global.fetch = sinon.stub().resolves({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as any);

    await expect(
      client.readDatapoints('PLANT_123', [';1!0020007CA000055', ';1!0020007C1000055']),
    ).rejects.toThrow('HTTP 404: Not Found');

    expect(findStructuredLog(sink.error, 'cloud.http.request.failed')).toBeUndefined();
    const log = findStructuredLog(sink.error, 'cloud.http.request.error');
    expect(log?.endpoint).toBe('/DataPoints/Values');
    expect(log?.requestedDatapointCount).toBe(2);
    expect(log?.requestedPointsSample).toEqual(['2:1994', '2:1985']);
    expect(log?.url).toBeUndefined();
    expect(log?.status).toBe(404);
  });

  it('logs refresh-token success and reuses the existing refresh token when the response omits it', async () => {
    const { client, sink } = createClientWithSink();
    global.fetch = sinon.stub().resolves({
      ok: true,
      json: async () => ({
        access_token: 'next-access-token',
        expires_in: 3600,
      }),
    } as any);

    const token = await client.authenticateWithRefreshToken('existing-refresh-token');

    expect(token.refreshToken).toBe('existing-refresh-token');
    expect(findStructuredLog(sink.log, 'cloud.auth.refresh.succeeded')?.hasRefreshToken).toBe(true);
  });

  it('does not include the username in password-auth start logs', async () => {
    const { client, sink } = createClientWithSink();
    global.fetch = sinon.stub().resolves({
      ok: true,
      json: async () => ({
        access_token: 'next-access-token',
        refresh_token: 'next-refresh-token',
        expires_in: 3600,
      }),
    } as any);

    await client.authenticateWithPassword('user@example.com', 'secret');

    const log = findStructuredLog(sink.log, 'cloud.auth.password.start');
    expect(log?.msg).toBe('Starting cloud password authentication');
    expect(log?.username).toBeUndefined();
  });

  it('logs client destruction', () => {
    const { client, sink } = createClientWithSink();

    client.destroy();

    expect(findStructuredLog(sink.log, 'cloud.client.destroyed')?.msg).toBe('Destroyed cloud client state');
  });
});
