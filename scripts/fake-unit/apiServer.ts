import {
  createServer, IncomingMessage, Server, ServerResponse,
} from 'http';

import {
  FLEXIT_GO_PROPRIETARY_COMPAT,
  FanMode,
  PROPERTY_ID,
  SUPPORTED_DEVICE_PROPERTIES,
  SUPPORTED_POINT_PROPERTY_IDS,
} from './manifest';
import { BacnetFailure, FakeNordicUnitState } from './state';

export interface FakeApiServerOptions {
  host: string;
  port: number;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      length += chunk.length;
      if (length > 512_000) {
        reject(new Error('Request body too large'));
      }
    });

    req.on('error', reject);
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(body) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toFailureResponse(result: BacnetFailure) {
  return {
    ok: false,
    errorClass: result.errorClass,
    errorCode: result.errorCode,
    message: result.message,
  };
}

function sendResultState(
  res: ServerResponse,
  state: FakeNordicUnitState,
  result: { ok: true; value: null } | BacnetFailure,
) {
  if (!result.ok) {
    sendJson(res, 409, toFailureResponse(result));
    return;
  }
  sendJson(res, 200, { ok: true, state: state.snapshot() });
}

export class FakeApiServer {
  private readonly state: FakeNordicUnitState;

  private readonly options: FakeApiServerOptions;

  private server: Server | null = null;

  constructor(state: FakeNordicUnitState, options: FakeApiServerOptions) {
    this.state = state;
    this.options = options;
  }

  async start() {
    if (this.server) return;
    this.server = createServer((req, res) => {
      this.route(req, res).catch((error) => {
        if (error instanceof SyntaxError) {
          sendJson(res, 400, { ok: false, error: 'invalid_json' });
          return;
        }
        if (error instanceof Error && error.message === 'Request body too large') {
          sendJson(res, 413, { ok: false, error: 'request_too_large' });
          return;
        }
        // Avoid leaking stack traces/internal details to API clients.
        console.error('[FakeApiServer] route error', error);
        sendJson(res, 500, { ok: false, error: 'internal_error' });
      });
    });

    await new Promise<void>((resolve) => {
      this.server?.listen(this.options.port, this.options.host, () => resolve());
    });
  }

  stop() {
    if (!this.server) return;
    this.server.close();
    this.server = null;
  }

  private async route(req: IncomingMessage, res: ServerResponse) {
    const method = req.method ?? 'GET';
    const pathname = (req.url ?? '/').split('?')[0];

    if (method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === 'GET' && pathname === '/debug/state') {
      sendJson(res, 200, { ok: true, state: this.state.snapshot() });
      return;
    }

    if (method === 'GET' && pathname === '/summary') {
      sendJson(res, 200, { ok: true, summary: this.state.summary() });
      return;
    }

    if (method === 'GET' && pathname === '/debug/points') {
      this.state.tick();
      sendJson(res, 200, { ok: true, points: this.state.getPointSnapshots() });
      return;
    }

    if (method === 'GET' && pathname === '/debug/manifest') {
      const points = this.state.getPointSnapshots().map((point) => ({
        key: point.key,
        type: point.type,
        instance: point.instance,
        access: point.access,
        source: point.source,
        units: point.units,
        min: point.min,
        max: point.max,
        requiresPriority13: point.requiresPriority13 ?? false,
      }));
      sendJson(res, 200, {
        ok: true,
        bacnet: {
          // Documented surface intended for Homey app/device emulation.
          supportedDeviceProperties: SUPPORTED_DEVICE_PROPERTIES.map((property) => ({
            id: property.id,
            name: property.name,
          })),
          supportedPointProperties: SUPPORTED_POINT_PROPERTY_IDS,
          presentValuePropertyId: PROPERTY_ID.PRESENT_VALUE,
          points,
          documentedPoints: points,
          // Compatibility-only proprietary surface used by Flexit GO.
          proprietaryCompatibility: FLEXIT_GO_PROPRIETARY_COMPAT,
        },
      });
      return;
    }

    if (method === 'POST' && pathname === '/feature/mode') {
      const body = await readJson(req);
      const mode = typeof body.mode === 'string' ? body.mode as FanMode : null;
      if (!mode || !['away', 'home', 'high', 'fireplace'].includes(mode)) {
        sendJson(res, 400, { ok: false, error: 'mode must be one of away|home|high|fireplace' });
        return;
      }
      const result = this.state.setFanMode(mode);
      sendResultState(res, this.state, result);
      return;
    }

    if (method === 'POST' && pathname === '/feature/setpoint') {
      const body = await readJson(req);
      const value = toNumber(body.value);
      const target = body.target === 'away' ? 'away' : 'home';
      if (value === null) {
        sendJson(res, 400, { ok: false, error: 'value must be numeric' });
        return;
      }
      const result = target === 'away' ? this.state.setAwaySetpoint(value) : this.state.setHomeSetpoint(value);
      sendResultState(res, this.state, result);
      return;
    }

    if (method === 'POST' && pathname === '/debug/write') {
      const body = await readJson(req);
      const type = toNumber(body.type);
      const instance = toNumber(body.instance);
      const propertyId = toNumber(body.propertyId) ?? PROPERTY_ID.PRESENT_VALUE;
      const value = toNumber(body.value);
      const priority = body.priority === undefined ? undefined : toNumber(body.priority);
      if (type === null || instance === null || value === null) {
        sendJson(res, 400, { ok: false, error: 'type, instance and value must be numeric' });
        return;
      }
      const result = this.state.writePresentValue(type, instance, propertyId, value, priority === null ? undefined : priority);
      sendResultState(res, this.state, result);
      return;
    }

    if (method === 'POST' && pathname === '/debug/advance') {
      const body = await readJson(req);
      const seconds = toNumber(body.seconds);
      if (seconds === null || seconds <= 0) {
        sendJson(res, 400, { ok: false, error: 'seconds must be > 0' });
        return;
      }
      this.state.advanceSimulatedSeconds(seconds);
      sendJson(res, 200, { ok: true, state: this.state.snapshot() });
      return;
    }

    if (method === 'POST' && pathname === '/feature/filter/replace') {
      sendResultState(res, this.state, this.state.replaceFilter());
      return;
    }

    if (method === 'POST' && pathname === '/feature/filter/set') {
      const body = await readJson(req);
      const operatingHours = toNumber(body.operatingHours);
      const limitHours = toNumber(body.limitHours);
      if (operatingHours === null && limitHours === null) {
        sendJson(res, 400, { ok: false, error: 'operatingHours and/or limitHours must be numeric' });
        return;
      }

      if (operatingHours !== null) {
        const setAge = this.state.setFilterOperatingHours(operatingHours);
        if (!setAge.ok) {
          sendJson(res, 409, toFailureResponse(setAge));
          return;
        }
      }

      if (limitHours !== null) {
        const setLimit = this.state.setFilterLimitHours(limitHours);
        if (!setLimit.ok) {
          sendJson(res, 409, toFailureResponse(setLimit));
          return;
        }
      }

      sendJson(res, 200, {
        ok: true,
        state: this.state.snapshot(),
        filter: this.state.getFilterStatus(),
      });
      return;
    }

    if (method === 'POST' && pathname === '/feature/rapid/start') {
      const body = await readJson(req);
      const minutes = body.minutes === undefined ? undefined : toNumber(body.minutes);
      if (body.minutes !== undefined && minutes === null) {
        sendJson(res, 400, { ok: false, error: 'minutes must be numeric when provided' });
        return;
      }
      sendResultState(res, this.state, this.state.startRapid(minutes === null ? undefined : minutes));
      return;
    }

    if (method === 'POST' && pathname === '/feature/fireplace/start') {
      const body = await readJson(req);
      const minutes = body.minutes === undefined ? undefined : toNumber(body.minutes);
      if (body.minutes !== undefined && minutes === null) {
        sendJson(res, 400, { ok: false, error: 'minutes must be numeric when provided' });
        return;
      }
      sendResultState(res, this.state, this.state.startFireplace(minutes === null ? undefined : minutes));
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not_found' });
  }
}
