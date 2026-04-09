/* eslint-disable max-classes-per-file */
import { RuntimeLogger } from './logging';
/**
 * Flexit Cloud API client.
 * Communicates with the Flexit ClimatixIC cloud API (https://api.climatixic.com).
 *
 * Auth strategy:
 *   - Password grant at pairing time (with include_refresh_token=true)
 *   - Refresh-token grant for ongoing renewal
 *   - If refresh fails, device is marked unavailable (re-pair required)
 *
 * Reference: localdocs/ha-flexit — used only for auth flow, endpoints, and transport mechanics.
 */

const API_URL = 'https://api.climatixic.com';
const TOKEN_URL = `${API_URL}/Token`;
const PLANTS_URL = `${API_URL}/Plants`;
const DATAPOINTS_URL = `${API_URL}/DataPoints`;
const FILTER_URL = `${DATAPOINTS_URL}/Values?filterId=`;

// Public Azure API Management key for the ClimatixIC API.
// Shared by all consumers (Flexit GO app, Home Assistant, OpenHAB).
const API_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'en-us',
  'Content-Type': 'application/json; charset=utf-8',
  'Ocp-Apim-Subscription-Key': 'c3fc1f14ce8747588212eda5ae3b439e',
};

const TOKEN_REFRESH_MARGIN_MS = 3_600_000; // refresh 1 h before expiry
const FETCH_TIMEOUT_MS = 30_000;

export interface CloudToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

export interface CloudPlant {
  id: string;
  name: string;
  serialNumber: string;
  isOnline: boolean;
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;

  constructor(status: number, statusText: string) {
    super(`HTTP ${status}: ${statusText}`);
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
  }
}

interface CloudRequestLogContext {
  endpoint?: string;
  requestedDatapointCount?: number;
  requestedPointsSample?: string[];
}

/**
 * Encode a BACnet object reference as a cloud API datapoint path.
 *
 * Path format: `;1!{objectType:03X}{instance:06X}{property:06X}`
 * Property 85 (0x55) = PRESENT_VALUE.
 */
export function bacnetObjectToCloudPath(
  objectType: number,
  instance: number,
  property = 85,
): string {
  const t = objectType.toString(16).toUpperCase().padStart(3, '0');
  const i = instance.toString(16).toUpperCase().padStart(6, '0');
  const p = property.toString(16).toUpperCase().padStart(6, '0');
  return `;1!${t}${i}${p}`;
}

/**
 * Decode a cloud API path back to BACnet object type and instance.
 */
export function cloudPathToBacnetObject(path: string): { type: number; instance: number } {
  const hex = path.replace(/^;1!/, '');
  return {
    type: parseInt(hex.substring(0, 3), 16),
    instance: parseInt(hex.substring(3, 9), 16),
  };
}

function getEndpointFromUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch (_error) {
    return url;
  }
}

function formatCloudPointForLog(path: string): string {
  const { type, instance } = cloudPathToBacnetObject(path);
  if (!Number.isFinite(type) || !Number.isFinite(instance)) return path;
  return `${type}:${instance}`;
}

function buildCloudRequestLogContext(
  paths?: string[],
): CloudRequestLogContext {
  const safePaths = paths ?? [];
  return {
    requestedDatapointCount: safePaths.length,
    requestedPointsSample: safePaths.slice(0, 5).map(formatCloudPointForLog),
  };
}

export class FlexitCloudClient {
  private token: CloudToken | null = null;
  private _tokenRefreshCallbacks: ((token: CloudToken) => void)[] = [];
  private readonly logger?: RuntimeLogger;

  constructor(options?: { logger?: RuntimeLogger }) {
    this.logger = options?.logger;
  }

  // -------------------------------------------------------------------
  // HTTP helpers
  // -------------------------------------------------------------------

  private async fetchJson(
    url: string,
    options: RequestInit = {},
    logContext: CloudRequestLogContext = {},
  ): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          ...API_HEADERS,
          ...(options.headers as Record<string, string> || {}),
        },
      });
      if (!response.ok) {
        throw new HttpError(response.status, response.statusText);
      }
      return await response.json();
    } catch (error) {
      this.logger?.error('cloud.http.request.error', 'Cloud API request failed', error, {
        endpoint: logContext.endpoint ?? getEndpointFromUrl(url),
        method: options.method ?? 'GET',
        elapsedMs: Date.now() - startedAt,
        ...(error instanceof HttpError
          ? { status: error.status, statusText: error.statusText }
          : {}),
        ...logContext,
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async authenticatedFetch(
    url: string,
    options: RequestInit = {},
    logContext: CloudRequestLogContext = {},
  ): Promise<any> {
    const accessToken = await this.ensureToken();
    return this.fetchJson(url, {
      ...options,
      headers: {
        ...API_HEADERS,
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers as Record<string, string> || {}),
      },
    }, logContext);
  }

  // -------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------

  /**
   * Authenticate with username/password. Used only during pairing.
   * Requests a refresh token for ongoing renewal.
   */
  async authenticateWithPassword(
    username: string,
    password: string,
  ): Promise<CloudToken> {
    this.logger?.info('cloud.auth.password.start', 'Starting cloud password authentication');
    const body = `grant_type=password&username=${encodeURIComponent(username)}`
      + `&password=${encodeURIComponent(password)}&include_refresh_token=true`;

    const data = await this.fetchJson(TOKEN_URL, {
      method: 'POST',
      body,
      headers: {
        ...API_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    this.token = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };
    this.logger?.info('cloud.auth.password.succeeded', 'Cloud password authentication succeeded', {
      hasRefreshToken: Boolean(this.token.refreshToken),
      expiresAt: this.token.expiresAt,
    });
    this.notifyTokenRefreshed();
    return this.token;
  }

  /**
   * Authenticate using a stored refresh token.
   * Throws AuthenticationError if the refresh token is invalid/expired.
   */
  async authenticateWithRefreshToken(refreshToken: string): Promise<CloudToken> {
    this.logger?.info('cloud.auth.refresh.start', 'Starting cloud refresh-token authentication');
    const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
      + '&include_refresh_token=true';

    let data: any;
    try {
      data = await this.fetchJson(TOKEN_URL, {
        method: 'POST',
        body,
        headers: {
          ...API_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
    } catch (err: any) {
      if (err instanceof HttpError && (err.status === 400 || err.status === 401)) {
        this.logger?.error('cloud.auth.refresh.invalid', 'Cloud refresh token was rejected', err, {
          status: err.status,
        });
        throw new AuthenticationError(
          `Refresh token authentication failed: ${err.message}`,
        );
      }
      this.logger?.error('cloud.auth.refresh.failed', 'Cloud refresh-token authentication failed', err);
      throw err;
    }

    this.token = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };
    this.logger?.info('cloud.auth.refresh.succeeded', 'Cloud refresh-token authentication succeeded', {
      hasRefreshToken: Boolean(this.token.refreshToken),
      expiresAt: this.token.expiresAt,
    });
    this.notifyTokenRefreshed();
    return this.token;
  }

  /**
   * Restore a previously persisted token without making a network call.
   * The token will be refreshed on the next API call if expired.
   */
  restoreToken(token: CloudToken) {
    this.token = { ...token };
    this.logger?.info('cloud.token.restored', 'Restored cloud token from persisted device state', {
      hasAccessToken: Boolean(token.accessToken),
      hasRefreshToken: Boolean(token.refreshToken),
      expiresAt: token.expiresAt,
    });
  }

  private async ensureToken(): Promise<string> {
    if (!this.token) {
      throw new AuthenticationError('No token available. Re-pair the device.');
    }
    if (Date.now() >= this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
      if (!this.token.refreshToken) {
        throw new AuthenticationError('Token expired and no refresh token available. Re-pair the device.');
      }
      this.logger?.info('cloud.token.refresh_needed', 'Cloud token refresh is required before the next request', {
        expiresAt: this.token.expiresAt,
      });
      await this.authenticateWithRefreshToken(this.token.refreshToken);
    }
    return this.token!.accessToken;
  }

  hasValidToken(): boolean {
    return this.token !== null
      && Date.now() < this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS;
  }

  getToken(): CloudToken | null {
    return this.token ? { ...this.token } : null;
  }

  /**
   * Register a callback invoked whenever the token is refreshed.
   * The device uses this to persist the new refresh token.
   */
  onTokenRefreshed(callback: (token: CloudToken) => void) {
    this._tokenRefreshCallbacks.push(callback);
  }

  private notifyTokenRefreshed() {
    if (this.token && this._tokenRefreshCallbacks.length > 0) {
      this.logger?.info('cloud.token.refreshed', 'Notifying cloud token refresh subscribers', {
        subscriberCount: this._tokenRefreshCallbacks.length,
        expiresAt: this.token.expiresAt,
      });
      const snapshot = { ...this.token };
      for (const cb of this._tokenRefreshCallbacks) cb(snapshot);
    }
  }

  // -------------------------------------------------------------------
  // Plant / device discovery
  // -------------------------------------------------------------------

  async findPlants(): Promise<CloudPlant[]> {
    const data = await this.authenticatedFetch(PLANTS_URL, {}, {
      endpoint: '/Plants',
    });
    const plants = (data.items || []).map((item: any) => ({
      id: item.id,
      name: item.name || item.customerPlantId || item.id,
      serialNumber: item.serialNumber || item.customerPlantId || '',
      isOnline: item.isOnline === 'True' || item.isOnline === true,
    }));
    this.logger?.info('cloud.plants.listed', 'Retrieved plants from cloud API', {
      plantCount: plants.length,
    });
    return plants;
  }

  // -------------------------------------------------------------------
  // Datapoint reads
  // -------------------------------------------------------------------

  async readDatapoints(
    plantId: string,
    paths: string[],
  ): Promise<Record<string, any>> {
    const filter = paths.map((path) => ({
      DataPoints: `${plantId}${path}`,
    }));
    const url = `${FILTER_URL}${encodeURIComponent(JSON.stringify(filter))}`;
    const logContext = {
      endpoint: '/DataPoints/Values',
      ...buildCloudRequestLogContext(paths),
    };
    const data = await this.authenticatedFetch(url, {}, logContext);
    return data.values || {};
  }

  // -------------------------------------------------------------------
  // Datapoint writes
  // -------------------------------------------------------------------

  async writeDatapoint(
    plantId: string,
    path: string,
    value: number | string | null,
  ): Promise<boolean> {
    const fullPath = `${plantId}${path}`;
    const url = `${DATAPOINTS_URL}/${encodeURIComponent(fullPath)}`;
    const valueStr = value === null || value === undefined ? null : String(value);

    const data = await this.authenticatedFetch(url, {
      method: 'PUT',
      body: JSON.stringify({ Value: valueStr }),
    }, {
      endpoint: '/DataPoints/:path',
      requestedPointsSample: [formatCloudPointForLog(path)],
    });

    const success = data?.stateTexts
      ? data.stateTexts[fullPath] === 'Success'
      : data?.error?.stateTexts
        ? data.error.stateTexts[fullPath] === 'Success'
        : false;
    this.logger?.info('cloud.datapoint.write', 'Wrote datapoint through cloud API', {
      plantId,
      path,
      success,
      value: valueStr,
    });

    return success;
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  destroy() {
    this.token = null;
    this._tokenRefreshCallbacks = [];
    this.logger?.info('cloud.client.destroyed', 'Destroyed cloud client state');
  }
}
