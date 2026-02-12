import { getBacnetClient, BacnetEnums, setBacnetLogger } from './bacnetClient';
import { discoverFlexitUnits } from './flexitDiscovery';

// Helper to clamp values
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export interface FlexitDevice {
    getData(): { unitId: string };
    getSetting(key: string): string | number | boolean | null;
    setSetting(settings: Record<string, any>): Promise<void>;
    setCapabilityValue(cap: string, value: any): Promise<void>;
    setAvailable(): Promise<void>;
    setUnavailable(reason?: string): Promise<void>;
    log(...args: any[]): void;
    error(...args: any[]): void;
}

const PRESENT_VALUE_ID = 85;
const OBJECT_TYPE = BacnetEnums.ObjectType;
const DEFAULT_FIREPLACE_VENTILATION_MINUTES = 10;
const DEFAULT_WRITE_PRIORITY = 13;

const POLL_INTERVAL_MS = 10_000;
const REDISCOVERY_INTERVAL_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const EXTRACT_AIR_TEMPERATURE_PRIMARY_INSTANCE = 59;
const EXTRACT_AIR_TEMPERATURE_ALT_INSTANCE = 95;

const VENTILATION_MODE_VALUES = {
  STOP: 1,
  AWAY: 2,
  HOME: 3,
  HIGH: 4,
};

const OPERATION_MODE_VALUES = {
  OFF: 1,
  AWAY: 2,
  HOME: 3,
  HIGH: 4,
  COOKER_HOOD: 5,
  FIREPLACE: 6,
  TEMPORARY_HIGH: 7,
};

const TRIGGER_VALUE = 2;

const BACNET_OBJECTS = {
  comfortButton: { type: OBJECT_TYPE.BINARY_VALUE, instance: 50 },
  comfortButtonDelay: { type: OBJECT_TYPE.POSITIVE_INTEGER_VALUE, instance: 318 },
  ventilationMode: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 42 },
  operationMode: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 361 },
  rapidVentilationTrigger: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 357 },
  rapidVentilationRuntime: { type: OBJECT_TYPE.POSITIVE_INTEGER_VALUE, instance: 293 },
  rapidVentilationRemaining: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 2031 },
  fireplaceVentilationTrigger: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 360 },
  fireplaceVentilationRuntime: { type: OBJECT_TYPE.POSITIVE_INTEGER_VALUE, instance: 270 },
  fireplaceVentilationRemaining: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 2038 },
  fireplaceState: { type: OBJECT_TYPE.BINARY_VALUE, instance: 400 },
  cookerHood: { type: OBJECT_TYPE.BINARY_VALUE, instance: 402 },
  resetTempVentOp: { type: OBJECT_TYPE.BINARY_VALUE, instance: 452 },
  resetTempRapidRf: { type: OBJECT_TYPE.BINARY_VALUE, instance: 487 },
  resetTempFireplaceRf: { type: OBJECT_TYPE.BINARY_VALUE, instance: 488 },
};

const objectKey = (type: number, instance: number) => `${type}:${instance}`;
const FIREPLACE_RUNTIME_KEY = objectKey(
  BACNET_OBJECTS.fireplaceVentilationRuntime.type,
  BACNET_OBJECTS.fireplaceVentilationRuntime.instance,
);

const MODE_RF_INPUT_MAP: Record<number, 'home' | 'away' | 'high' | 'fireplace'> = {
  3: 'high',
  13: 'high',
  24: 'home',
  26: 'fireplace',
};

const NEVER_BLOCK_KEYS = new Set<string>([
  objectKey(BACNET_OBJECTS.ventilationMode.type, BACNET_OBJECTS.ventilationMode.instance),
  objectKey(OBJECT_TYPE.BINARY_VALUE, 50),
  objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 360),
  objectKey(OBJECT_TYPE.POSITIVE_INTEGER_VALUE, 270),
  objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 357),
]);

function mapOperationMode(value: number): 'home' | 'away' | 'high' | 'fireplace' {
  switch (value) {
    case OPERATION_MODE_VALUES.HOME:
      return 'home';
    case OPERATION_MODE_VALUES.AWAY:
      return 'away';
    case OPERATION_MODE_VALUES.HIGH:
    case OPERATION_MODE_VALUES.TEMPORARY_HIGH:
      return 'high';
    case OPERATION_MODE_VALUES.FIREPLACE:
      return 'fireplace';
    case OPERATION_MODE_VALUES.COOKER_HOOD:
      return 'high';
    case OPERATION_MODE_VALUES.OFF:
    default:
      return 'away';
  }
}

function mapVentilationMode(value: number): 'home' | 'away' | 'high' {
  switch (value) {
    case VENTILATION_MODE_VALUES.HOME:
      return 'home';
    case VENTILATION_MODE_VALUES.HIGH:
      return 'high';
    case VENTILATION_MODE_VALUES.AWAY:
    case VENTILATION_MODE_VALUES.STOP:
    default:
      return 'away';
  }
}

function valuesMatch(actual: number, expected: number) {
  return Math.abs(actual - expected) < 0.01;
}

function selectExtractTemperature(primary?: number, alternate?: number): number | undefined {
  const primaryIsNumber = typeof primary === 'number' && Number.isFinite(primary);
  const alternateIsNumber = typeof alternate === 'number' && Number.isFinite(alternate);

  if (primaryIsNumber && primary !== 0) return primary;
  if (alternateIsNumber) return alternate;
  if (primaryIsNumber) return primary;
  return undefined;
}

interface UnitState {
  unitId: string;
  serial: string;
  devices: Set<FlexitDevice>;
  pollInterval: ReturnType<typeof setInterval> | null;
  rediscoverInterval: ReturnType<typeof setInterval> | null;
  ip: string;
  bacnetPort: number;
  writeQueue: Promise<void>;
  probeValues: Map<string, number>;
  blockedWrites: Set<string>;
  pendingWriteErrors: Map<string, { value: number; code: number }>;
  lastWriteValues: Map<string, { value: number; at: number }>;
  lastPollAt?: number;
  writeContext: Map<string, { value: number; mode: string; at: number }>;
  deferredMode?: 'fireplace';
  deferredSince?: number;
  expectedMode?: string;
  expectedModeAt?: number;
  lastMismatchKey?: string;
  consecutiveFailures: number;
  available: boolean;
}

interface RegistryLogger {
  log(...args: any[]): void;
  error(...args: any[]): void;
  warn?(...args: any[]): void;
}

// The core poll request — only objects that drive device capabilities.
function buildPollRequest() {
  return [
    // Thermostat capabilities
    { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1994 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint
    { objectId: { type: OBJECT_TYPE.ANALOG_INPUT, instance: 4 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Supply Temp
    { objectId: { type: OBJECT_TYPE.ANALOG_INPUT, instance: 1 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Outdoor Temp
    { objectId: { type: OBJECT_TYPE.ANALOG_INPUT, instance: 11 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Exhaust Temp
    { objectId: { type: OBJECT_TYPE.ANALOG_INPUT, instance: EXTRACT_AIR_TEMPERATURE_PRIMARY_INSTANCE }, properties: [{ id: PRESENT_VALUE_ID }] }, // Extract Temp (primary mapping)
    { objectId: { type: OBJECT_TYPE.ANALOG_INPUT, instance: EXTRACT_AIR_TEMPERATURE_ALT_INSTANCE }, properties: [{ id: PRESENT_VALUE_ID }] }, // Extract Temp (alternate mapping)
    { objectId: { type: OBJECT_TYPE.ANALOG_INPUT, instance: 96 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Humidity
    { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 194 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Heater Power

    // Fan capabilities
    { objectId: { type: OBJECT_TYPE.ANALOG_INPUT, instance: 5 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Fan RPM Supply
    { objectId: { type: OBJECT_TYPE.ANALOG_INPUT, instance: 12 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Fan RPM Extract
    { objectId: { type: OBJECT_TYPE.ANALOG_OUTPUT, instance: 3 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Fan Speed % Supply
    { objectId: { type: OBJECT_TYPE.ANALOG_OUTPUT, instance: 4 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Fan Speed % Extract
    { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 285 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Filter Time
    { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 286 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Filter Limit

    // Mode / comfort
    { objectId: BACNET_OBJECTS.comfortButton, properties: [{ id: PRESENT_VALUE_ID }] },
    { objectId: BACNET_OBJECTS.comfortButtonDelay, properties: [{ id: PRESENT_VALUE_ID }] },
    { objectId: BACNET_OBJECTS.ventilationMode, properties: [{ id: PRESENT_VALUE_ID }] },
    { objectId: BACNET_OBJECTS.operationMode, properties: [{ id: PRESENT_VALUE_ID }] },
    { objectId: BACNET_OBJECTS.rapidVentilationTrigger, properties: [{ id: PRESENT_VALUE_ID }] },
    { objectId: BACNET_OBJECTS.rapidVentilationRuntime, properties: [{ id: PRESENT_VALUE_ID }] },
    { objectId: BACNET_OBJECTS.fireplaceVentilationTrigger, properties: [{ id: PRESENT_VALUE_ID }] },
    { objectId: BACNET_OBJECTS.fireplaceVentilationRuntime, properties: [{ id: PRESENT_VALUE_ID }] },
    { objectId: { type: OBJECT_TYPE.BINARY_VALUE, instance: 15 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Rapid ventilation active
    { objectId: BACNET_OBJECTS.fireplaceState, properties: [{ id: PRESENT_VALUE_ID }] },
    { objectId: BACNET_OBJECTS.rapidVentilationRemaining, properties: [{ id: PRESENT_VALUE_ID }] },
    { objectId: BACNET_OBJECTS.fireplaceVentilationRemaining, properties: [{ id: PRESENT_VALUE_ID }] },
    { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 2005 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Remaining temp vent op
    { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 2125 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Operating mode input from RF
    { objectId: { type: OBJECT_TYPE.BINARY_VALUE, instance: 574 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Delay for away active
  ];
}

export class UnitRegistry {
    private units: Map<string, UnitState> = new Map();
    private logger?: RegistryLogger;

    setLogger(logger: RegistryLogger) {
      this.logger = logger;
      this.syncBacnetLogger();
    }

    private syncBacnetLogger() {
      if (typeof setBacnetLogger === 'function') {
        setBacnetLogger({
          error: (...args: any[]) => this.error(...args),
        });
      }
    }

    private getAnyDevice(): FlexitDevice | undefined {
      for (const unit of this.units.values()) {
        const first = unit.devices.values().next();
        if (!first.done) return first.value;
      }
      return undefined;
    }

    private log(...args: any[]) {
      if (this.logger?.log) {
        this.logger.log(...args);
        return;
      }
      this.getAnyDevice()?.log(...args);
    }

    private warn(...args: any[]) {
      if (this.logger?.warn) {
        this.logger.warn(...args);
        return;
      }
      if (this.logger?.log) {
        this.logger.log(...args);
        return;
      }
      this.getAnyDevice()?.log(...args);
    }

    private error(...args: any[]) {
      if (this.logger?.error) {
        this.logger.error(...args);
        return;
      }
      this.getAnyDevice()?.error(...args);
    }

    register(unitId: string, device: FlexitDevice) {
      let unit = this.units.get(unitId);
      if (!unit) {
        const ip = String(device.getSetting('ip') || '').trim();
        const bacnetPort = Number(device.getSetting('bacnetPort') || 47808);
        const serial = String(device.getSetting('serial') || '');

        unit = {
          unitId,
          serial,
          devices: new Set(),
          pollInterval: null,
          rediscoverInterval: null,
          ip,
          bacnetPort,
          writeQueue: Promise.resolve(),
          probeValues: new Map(),
          blockedWrites: new Set(),
          pendingWriteErrors: new Map(),
          lastWriteValues: new Map(),
          lastPollAt: undefined,
          writeContext: new Map(),
          deferredMode: undefined,
          deferredSince: undefined,
          expectedMode: undefined,
          expectedModeAt: undefined,
          lastMismatchKey: undefined,
          consecutiveFailures: 0,
          available: true,
        };
        this.units.set(unitId, unit);

        // Start polling immediately
        this.pollUnit(unitId);
        unit.pollInterval = setInterval(() => this.pollUnit(unitId), POLL_INTERVAL_MS);
      }
      unit.devices.add(device);
      if (!this.logger) this.syncBacnetLogger();
    }

    unregister(unitId: string, device: FlexitDevice) {
      const unit = this.units.get(unitId);
      if (unit) {
        unit.devices.delete(device);
        if (unit.devices.size === 0) {
          if (unit.pollInterval) clearInterval(unit.pollInterval);
          if (unit.rediscoverInterval) clearInterval(unit.rediscoverInterval);
          this.units.delete(unitId);
        }
      }
    }

    /**
     * Tear down all units — clears all intervals.
     * Used for testing and app shutdown.
     */
    destroy() {
      for (const unit of this.units.values()) {
        if (unit.pollInterval) clearInterval(unit.pollInterval);
        if (unit.rediscoverInterval) clearInterval(unit.rediscoverInterval);
      }
      this.units.clear();
    }

    async writeSetpoint(unitId: string, setpoint: number) {
      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');

      const client = getBacnetClient(unit.bacnetPort);
      const v = clamp(setpoint, 10, 30);
      const writeOptions = {
        maxSegments: BacnetEnums.MaxSegmentsAccepted.SEGMENTS_0,
        maxApdu: BacnetEnums.MaxApduLengthAccepted.OCTETS_1476,
        priority: DEFAULT_WRITE_PRIORITY,
      };

      this.log(`[UnitRegistry] Writing setpoint ${v} to ${unitId} (${unit.ip})`);

      unit.writeQueue = unit.writeQueue.then(async () => new Promise<void>((resolve, reject) => {
        let handled = false;
        const tm = setTimeout(() => {
          if (!handled) {
            handled = true;
            this.error(`[UnitRegistry] Timeout writing setpoint to ${unitId}`);
            reject(new Error('Timeout'));
          }
        }, 5000);

        const objectId = { type: 2, instance: 1994 };

        try {
          client.writeProperty(
            unit.ip,
            objectId,
            PRESENT_VALUE_ID,
            [{ type: BacnetEnums.ApplicationTags.REAL, value: v }],
            writeOptions,
            (err: any, _value: any) => {
              if (handled) return;
              handled = true;
              clearTimeout(tm);

              if (err) {
                this.error(`[UnitRegistry] Failed to write setpoint to ${unitId}:`, err);
                reject(err);
                return;
              }
              this.log(`[UnitRegistry] Successfully wrote setpoint ${v} to ${unitId}`);
              resolve();
            },
          );
        } catch (e) {
          if (!handled) {
            handled = true;
            clearTimeout(tm);
            this.error(`[UnitRegistry] Sync error writing setpoint to ${unitId}:`, e);
            reject(e);
          }
        }
      }));

      return unit.writeQueue;
    }

    private pollUnit(unitId: string) {
      const unit = this.units.get(unitId);
      if (!unit) return;

      const client = getBacnetClient(unit.bacnetPort);
      const requestArray = buildPollRequest();

      const pollOnce = (attempt: number) => {
        try {
          client.readPropertyMultiple(unit.ip, requestArray, (err: any, value: any) => {
            if (err) {
              const isTimeout = err?.code === 'ERR_TIMEOUT' || String(err?.message || '').includes('ERR_TIMEOUT');
              if (isTimeout && attempt === 0) {
                this.warn(`[UnitRegistry] Poll timeout for ${unitId}, retrying once...`);
                setTimeout(() => pollOnce(1), 1000);
                return;
              }
              this.error(`[UnitRegistry] Poll error for ${unitId}:`, err);
              this.handlePollFailure(unit);
              return;
            }

            try {
              if (value && value.values) {
                this.handlePollSuccess(unit);
                unit.lastPollAt = Date.now();
                const data: any = {};
                const pollTime = unit.lastPollAt;
                let extractTempPrimary: number | undefined;
                let extractTempAlt: number | undefined;
                value.values.forEach((obj: any) => {
                  const { type, instance } = obj.objectId;
                  const val = this.extractValue(obj);
                  if (typeof val !== 'number') return;

                  if (type === OBJECT_TYPE.ANALOG_VALUE && instance === 1994) data.target_temperature = val;
                  if (type === OBJECT_TYPE.ANALOG_INPUT && instance === 4) data['measure_temperature'] = val;
                  if (type === OBJECT_TYPE.ANALOG_INPUT && instance === 1) data['measure_temperature.outdoor'] = val;
                  if (type === OBJECT_TYPE.ANALOG_INPUT && instance === 11) data['measure_temperature.exhaust'] = val;
                  if (type === OBJECT_TYPE.ANALOG_INPUT && instance === EXTRACT_AIR_TEMPERATURE_PRIMARY_INSTANCE) extractTempPrimary = val;
                  if (type === OBJECT_TYPE.ANALOG_INPUT && instance === EXTRACT_AIR_TEMPERATURE_ALT_INSTANCE) extractTempAlt = val;
                  if (type === OBJECT_TYPE.ANALOG_INPUT && instance === 96) data['measure_humidity'] = val;
                  if (type === OBJECT_TYPE.ANALOG_VALUE && instance === 194) data['measure_power'] = val * 1000;

                  if (type === OBJECT_TYPE.ANALOG_INPUT && instance === 5) data['measure_motor_rpm'] = val;
                  if (type === OBJECT_TYPE.ANALOG_INPUT && instance === 12) data['measure_motor_rpm.extract'] = val;
                  if (type === OBJECT_TYPE.ANALOG_OUTPUT && instance === 3) data['measure_fan_speed_percent'] = val;
                  if (type === OBJECT_TYPE.ANALOG_OUTPUT && instance === 4) data['measure_fan_speed_percent.extract'] = val;
                  if (type === OBJECT_TYPE.ANALOG_VALUE && instance === 285) data['filter_time'] = val;
                  if (type === OBJECT_TYPE.ANALOG_VALUE && instance === 286) data['filter_limit'] = val;
                  if (type === OBJECT_TYPE.BINARY_VALUE && instance === 50) data['comfort_button'] = val;
                  if (type === OBJECT_TYPE.POSITIVE_INTEGER_VALUE && instance === 318) data['comfort_delay'] = val;
                  if (type === OBJECT_TYPE.MULTI_STATE_VALUE && instance === 42) data['ventilation_mode'] = val;
                  if (type === OBJECT_TYPE.MULTI_STATE_VALUE && instance === 361) data['operation_mode'] = val;
                  if (type === OBJECT_TYPE.BINARY_VALUE && instance === 15) data['rapid_active'] = val;
                  if (type === OBJECT_TYPE.BINARY_VALUE && instance === 400) data['fireplace_active'] = val;
                  if (type === OBJECT_TYPE.BINARY_VALUE && instance === 574) data['away_delay_active'] = val;
                  if (type === OBJECT_TYPE.ANALOG_VALUE && instance === 2005) data['remaining_temp_vent_op'] = val;
                  if (type === OBJECT_TYPE.ANALOG_VALUE && instance === 2031) data['remaining_rapid_vent'] = val;
                  if (type === OBJECT_TYPE.ANALOG_VALUE && instance === 2038) data['remaining_fireplace_vent'] = val;
                  if (type === OBJECT_TYPE.ANALOG_VALUE && instance === 2125) data['mode_rf_input'] = val;

                  const key = objectKey(type, instance);
                  const pending = unit.pendingWriteErrors.get(key);
                  if (pending && valuesMatch(val, pending.value)) {
                    this.warn(
                      `[UnitRegistry] Write error cleared for ${key}: now ${val} (was code ${pending.code})`,
                    );
                    unit.pendingWriteErrors.delete(key);
                  } else if (key === objectKey(BACNET_OBJECTS.ventilationMode.type, BACNET_OBJECTS.ventilationMode.instance) && unit.writeContext) {
                    const ctx = unit.writeContext.get(key);
                    if (ctx && ctx.value !== val && pollTime - ctx.at < 60000) {
                      this.warn(
                        `[UnitRegistry] Ventilation mode mismatch after write: expected ${ctx.value} for '${ctx.mode}', got ${val}`,
                      );
                      unit.writeContext.delete(key);
                    } else if (ctx && ctx.value === val) {
                      unit.writeContext.delete(key);
                    }
                  }

                  unit.probeValues.set(key, val);
                });

                const extractTemp = selectExtractTemperature(extractTempPrimary, extractTempAlt);
                if (extractTemp !== undefined) data['measure_temperature.extract'] = extractTemp;

                this.distributeData(unit, data);
              }
            } catch (e) {
              this.error(`[UnitRegistry] Parse error for ${unitId}:`, e);
            }
          });
        } catch (error) {
          this.error(`[UnitRegistry] Synchronous internal error checking ${unitId}:`, error);
          this.handlePollFailure(unit);
        }
      };

      pollOnce(0);
    }

    private handlePollFailure(unit: UnitState) {
      unit.consecutiveFailures++;
      if (unit.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && unit.available) {
        unit.available = false;
        this.warn(`[UnitRegistry] Unit ${unit.unitId} marked unavailable after ${unit.consecutiveFailures} consecutive failures`);
        for (const device of unit.devices) {
          device.setUnavailable('Device unreachable — will auto-reconnect when found').catch(() => { });
        }
        this.startRediscovery(unit);
      }
    }

    private handlePollSuccess(unit: UnitState) {
      unit.consecutiveFailures = 0;
      if (!unit.available) {
        unit.available = true;
        this.log(`[UnitRegistry] Unit ${unit.unitId} is available again at ${unit.ip}`);
        for (const device of unit.devices) {
          device.setAvailable().catch(() => { });
        }
        this.stopRediscovery(unit);
      }
    }

    private startRediscovery(unit: UnitState) {
      if (unit.rediscoverInterval) return; // already running
      this.log(`[UnitRegistry] Starting rediscovery for ${unit.unitId} (serial ${unit.serial})`);

      const doRediscovery = async () => {
        try {
          const found = await discoverFlexitUnits({ timeoutMs: 5000, burstCount: 3, burstIntervalMs: 300 });
          const match = found.find((u) => u.serialNormalized === unit.unitId);
          if (!match) return;

          const ipChanged = match.ip !== unit.ip;
          const portChanged = match.bacnetPort !== unit.bacnetPort;

          if (ipChanged || portChanged) {
            this.log(
              `[UnitRegistry] Rediscovered ${unit.unitId} at ${match.ip}:${match.bacnetPort}`
              + ` (was ${unit.ip}:${unit.bacnetPort})`,
            );
            unit.ip = match.ip;
            unit.bacnetPort = match.bacnetPort;

            // Update device settings so they persist across restarts
            for (const device of unit.devices) {
              device.setSetting({ ip: match.ip, bacnetPort: match.bacnetPort }).catch(() => { });
            }
          } else {
            this.log(`[UnitRegistry] Rediscovered ${unit.unitId} at same address, retrying poll`);
          }

          // Trigger an immediate poll to verify connectivity
          this.pollUnit(unit.unitId);
        } catch (e) {
          this.error(`[UnitRegistry] Rediscovery error for ${unit.unitId}:`, e);
        }
      };

      // Run immediately, then on interval
      doRediscovery().catch(() => { });
      unit.rediscoverInterval = setInterval(() => {
        doRediscovery().catch(() => { });
      }, REDISCOVERY_INTERVAL_MS);
    }

    private stopRediscovery(unit: UnitState) {
      if (unit.rediscoverInterval) {
        clearInterval(unit.rediscoverInterval);
        unit.rediscoverInterval = null;
      }
    }

    private distributeData(unit: UnitState, data: any) {
      // Compute derived values before distributing
      let filterLife: number | undefined;
      if (data['filter_time'] !== undefined && data['filter_limit'] !== undefined && data['filter_limit'] > 0) {
        filterLife = Math.max(0, (1 - (data['filter_time'] / data['filter_limit'])) * 100);
        filterLife = parseFloat(filterLife.toFixed(1));
      }

      // Compute fan mode
      let mode: string | undefined;
      if (
        data['comfort_button'] !== undefined
        || data['ventilation_mode'] !== undefined
        || data['operation_mode'] !== undefined
        || data['rapid_active'] !== undefined
        || data['fireplace_active'] !== undefined
        || data['remaining_rapid_vent'] !== undefined
        || data['remaining_fireplace_vent'] !== undefined
        || data['remaining_temp_vent_op'] !== undefined
        || data['mode_rf_input'] !== undefined
      ) {
        mode = 'away';
        const rfMode = MODE_RF_INPUT_MAP[Math.round(data['mode_rf_input'] ?? NaN)];
        const tempOpActive = (data['remaining_temp_vent_op'] ?? 0) > 0;

        if (unit.deferredMode === 'fireplace' && !tempOpActive && data['rapid_active'] !== 1) {
          unit.deferredMode = undefined;
          unit.deferredSince = undefined;
          this.warn(`[UnitRegistry] Retrying deferred fireplace for ${unit.unitId}`);
          this.setFanMode(unit.unitId, 'fireplace').catch(() => { });
        }

        if (data['operation_mode'] !== undefined) {
          mode = mapOperationMode(Math.round(data['operation_mode']));
        } else if (data['ventilation_mode'] !== undefined) {
          mode = mapVentilationMode(Math.round(data['ventilation_mode']));
        } else if (rfMode) {
          mode = rfMode;
        } else if (tempOpActive) {
          if ((data['remaining_fireplace_vent'] ?? 0) > 0) mode = 'fireplace';
          else if ((data['remaining_rapid_vent'] ?? 0) > 0) mode = 'high';
          else if (data['comfort_button'] === 1) mode = 'home';
        } else if (data['comfort_button'] === 1) {
          mode = 'home';
        }

        const { expectedMode } = unit;
        const ventilationMode = data['ventilation_mode'] !== undefined
          ? mapVentilationMode(Math.round(data['ventilation_mode']))
          : undefined;

        if (ventilationMode) {
          mode = ventilationMode;
        }

        if (data['fireplace_active'] === 1) mode = 'fireplace';
        else if (data['rapid_active'] === 1) mode = 'high';

        if (expectedMode && expectedMode !== mode) {
          const comfortOff = data['comfort_button'] === 0;
          const awayDelayActive = data['away_delay_active'] === 1;
          if (expectedMode === 'away' && comfortOff && awayDelayActive) {
            const mismatchKey = `${expectedMode}->pending`;
            if (unit.lastMismatchKey !== mismatchKey) {
              unit.lastMismatchKey = mismatchKey;
              const delay = data['comfort_delay'] ?? 'unknown';
              this.warn(
                `[UnitRegistry] Away pending for ${unit.unitId}: delay active (configured ${delay} min)`,
              );
            }
          } else {
            const mismatchKey = `${expectedMode}->${mode}`;
            if (unit.lastMismatchKey !== mismatchKey) {
              unit.lastMismatchKey = mismatchKey;
              this.warn(
                `[UnitRegistry] Mode mismatch for ${unit.unitId}: expected '${expectedMode}' got '${mode}'`,
              );
            }
          }
        } else if (expectedMode && expectedMode === mode) {
          unit.lastMismatchKey = undefined;
        }

      }

      for (const device of unit.devices) {
        // Thermostat capabilities
        if (data.target_temperature !== undefined) device.setCapabilityValue('target_temperature', data.target_temperature).catch(() => { });
        if (data['measure_temperature'] !== undefined) device.setCapabilityValue('measure_temperature', data['measure_temperature']).catch(() => { });
        if (data['measure_temperature.outdoor'] !== undefined) device.setCapabilityValue('measure_temperature.outdoor', data['measure_temperature.outdoor']).catch(() => { });
        if (data['measure_temperature.exhaust'] !== undefined) device.setCapabilityValue('measure_temperature.exhaust', data['measure_temperature.exhaust']).catch(() => { });
        if (data['measure_temperature.extract'] !== undefined) device.setCapabilityValue('measure_temperature.extract', data['measure_temperature.extract']).catch(() => { });
        if (data['measure_power'] !== undefined) device.setCapabilityValue('measure_power', data['measure_power']).catch(() => { });

        // Fan capabilities
        if (data['measure_humidity'] !== undefined) device.setCapabilityValue('measure_humidity', data['measure_humidity']).catch(() => { });
        if (data['measure_motor_rpm'] !== undefined) device.setCapabilityValue('measure_motor_rpm', data['measure_motor_rpm']).catch(() => { });
        if (data['measure_motor_rpm.extract'] !== undefined) device.setCapabilityValue('measure_motor_rpm.extract', data['measure_motor_rpm.extract']).catch(() => { });
        if (data['measure_fan_speed_percent'] !== undefined) device.setCapabilityValue('measure_fan_speed_percent', data['measure_fan_speed_percent']).catch(() => { });
        if (data['measure_fan_speed_percent.extract'] !== undefined) device.setCapabilityValue('measure_fan_speed_percent.extract', data['measure_fan_speed_percent.extract']).catch(() => { });
        if (filterLife !== undefined) device.setCapabilityValue('measure_hepa_filter', filterLife).catch(() => { });

        // Fan mode
        if (mode !== undefined) device.setCapabilityValue('fan_mode', mode).catch(() => { });
      }
    }

    async setFanMode(unitId: string, mode: string) {
      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');

      this.log(`[UnitRegistry] Setting fan mode to '${mode}' for ${unitId}`);
      const writeOptions = {
        maxSegments: BacnetEnums.MaxSegmentsAccepted.SEGMENTS_0,
        maxApdu: BacnetEnums.MaxApduLengthAccepted.OCTETS_1476,
        priority: 13,
      };

      unit.writeQueue = unit.writeQueue.then(async () => {
        const client = getBacnetClient(unit.bacnetPort);

        const ventilationModeKey = objectKey(
          BACNET_OBJECTS.ventilationMode.type,
          BACNET_OBJECTS.ventilationMode.instance,
        );

        // Ensure core control points are never permanently blocked.
        for (const key of NEVER_BLOCK_KEYS) {
          unit.blockedWrites.delete(key);
        }

        const writeUpdate = async (up: { objectId: { type: number; instance: number }; tag: number; value: number; priority?: number | null }) => {
          const writeKey = objectKey(up.objectId.type, up.objectId.instance);
          if (unit.blockedWrites.has(writeKey)) {
            this.warn(`[UnitRegistry] Skipping write ${writeKey} (write access denied previously)`);
            return false;
          }
          return new Promise<boolean>((resolve) => {
            let handled = false;
            const tm = setTimeout(() => {
              if (!handled) {
                handled = true;
                this.error(`[UnitRegistry] Timeout writing ${up.objectId.type}:${up.objectId.instance}`);
                resolve(false);
              }
            }, 5000);

            try {
              this.log(`[UnitRegistry] Writing ${up.objectId.type}:${up.objectId.instance} = ${up.value}`);
              const options: { maxSegments: number; maxApdu: number; priority?: number } = {
                maxSegments: writeOptions.maxSegments,
                maxApdu: writeOptions.maxApdu,
              };
              if (up.priority !== null) {
                options.priority = up.priority ?? DEFAULT_WRITE_PRIORITY;
              }
              client.writeProperty(
                unit.ip,
                up.objectId,
                PRESENT_VALUE_ID,
                [{ type: up.tag, value: up.value }],
                options,
                (err: any) => {
                  if (handled) return;
                  handled = true;
                  clearTimeout(tm);
                  const now = Date.now();
                  if (err) {
                    const message = String(err?.message || err);
                    const errMatch = message.match(/Code:(\d+)/);
                    const code = errMatch ? Number(errMatch[1]) : undefined;
                    if (code === 37) {
                      unit.lastWriteValues.set(writeKey, { value: up.value, at: now });
                      unit.pendingWriteErrors.set(writeKey, { value: up.value, code });
                      this.warn(`[UnitRegistry] Write returned Code:37 for ${writeKey}; will verify on next poll.`);
                      resolve(true);
                      return;
                    }
                    if (message.includes('Code:40') || message.includes('Code:9')) {
                      unit.lastWriteValues.set(writeKey, { value: up.value, at: now });
                      if (NEVER_BLOCK_KEYS.has(writeKey)) {
                        this.warn(`[UnitRegistry] Write denied for ${writeKey}, but will keep retrying.`);
                      } else {
                        unit.blockedWrites.add(writeKey);
                        this.warn(`[UnitRegistry] Disabling writes for ${writeKey} due to device error.`);
                      }
                    } else {
                      this.error(
                        `[UnitRegistry] Failed to write ${up.objectId.type}:${up.objectId.instance} to ${up.value}`,
                        err,
                      );
                    }
                    resolve(false);
                  } else {
                    unit.lastWriteValues.set(writeKey, { value: up.value, at: now });
                    this.log(`[UnitRegistry] Successfully wrote ${up.objectId.type}:${up.objectId.instance} to ${up.value}`);
                    resolve(true);
                  }
                },
              );
            } catch (e) {
              if (!handled) {
                handled = true;
                clearTimeout(tm);
                this.error(`[UnitRegistry] Sync error writing ${up.objectId.type}:${up.objectId.instance}:`, e);
                resolve(false);
              }
            }
          });
        };

        const rapidActive = (unit.probeValues.get(objectKey(OBJECT_TYPE.BINARY_VALUE, 15)) ?? 0) === 1;
        const tempVentActive = (unit.probeValues.get(objectKey(OBJECT_TYPE.ANALOG_VALUE, 2005)) ?? 0) > 0;
        const fireplaceRuntime = clamp(
          Math.round(unit.probeValues.get(FIREPLACE_RUNTIME_KEY) ?? DEFAULT_FIREPLACE_VENTILATION_MINUTES),
          1,
          360,
        );

        const comfortButtonKey = objectKey(OBJECT_TYPE.BINARY_VALUE, 50);

        const shouldSkipWrite = (key: string, current: number | undefined, desired: number) => {
          if (current === undefined || !valuesMatch(current, desired)) return false;
          const lastWrite = unit.lastWriteValues.get(key);
          const lastPollAt = unit.lastPollAt ?? 0;
          if (!lastWrite) return true;
          if (lastWrite.at <= lastPollAt) return true;
          if (lastWrite.value === desired) return true;
          return false;
        };

        const writeComfort = async (value: number, opts?: { force?: boolean }) => {
          const key = comfortButtonKey;
          const current = unit.probeValues.get(key);
          if (!opts?.force && shouldSkipWrite(key, current, value)) {
            this.log(`[UnitRegistry] Comfort button already ${value}, skipping write.`);
            return true;
          }
          return writeUpdate({
            objectId: BACNET_OBJECTS.comfortButton,
            tag: BacnetEnums.ApplicationTags.ENUMERATED,
            value,
            priority: 13,
          });
        };

        const writeVentMode = async (value: number, opts?: { force?: boolean }) => {
          const current = unit.probeValues.get(ventilationModeKey);
          if (!opts?.force && shouldSkipWrite(ventilationModeKey, current, value)) {
            this.log(`[UnitRegistry] Ventilation mode already ${value}, skipping write.`);
            return true;
          }
          const ok = await writeUpdate({
            objectId: BACNET_OBJECTS.ventilationMode,
            tag: BacnetEnums.ApplicationTags.UNSIGNED_INTEGER,
            value,
            priority: 13,
          });
          if (ok) {
            unit.writeContext.set(ventilationModeKey, { value, mode, at: Date.now() });
          }
          return ok;
        };

        const writeFireplaceTrigger = async (value: number, opts?: { priority?: number | null }) => writeUpdate({
          objectId: BACNET_OBJECTS.fireplaceVentilationTrigger,
          tag: BacnetEnums.ApplicationTags.UNSIGNED_INTEGER,
          value,
          priority: opts?.priority,
        });

        const writeRapidTrigger = async (value: number, opts?: { priority?: number | null }) => writeUpdate({
          objectId: BACNET_OBJECTS.rapidVentilationTrigger,
          tag: BacnetEnums.ApplicationTags.UNSIGNED_INTEGER,
          value,
          priority: opts?.priority,
        });

        if (mode !== 'fireplace') {
          unit.deferredMode = undefined;
          unit.deferredSince = undefined;
        }

        if (mode === 'fireplace' && (rapidActive || tempVentActive)) {
          this.warn(
            `[UnitRegistry] Fireplace requested while temporary ventilation is active (rapid=${rapidActive} temp=${tempVentActive}); proceeding anyway.`,
          );
        }

        unit.expectedMode = mode;
        unit.expectedModeAt = Date.now();
        unit.lastMismatchKey = undefined;

        const fireplaceActive = (unit.probeValues.get(objectKey(OBJECT_TYPE.BINARY_VALUE, 400)) ?? 0) === 1;
        const temporaryRapidActive = rapidActive || tempVentActive;
        if (mode !== 'fireplace' && fireplaceActive) {
          await writeFireplaceTrigger(TRIGGER_VALUE, { priority: null });
        }

        if (mode === 'home') {
          const comfortOk = await writeComfort(1);
          if (comfortOk && !unit.blockedWrites.has(ventilationModeKey)) {
            await writeVentMode(VENTILATION_MODE_VALUES.HOME, { force: true });
          }
          if (temporaryRapidActive) {
            await writeRapidTrigger(TRIGGER_VALUE, { priority: null });
          }
        } else if (mode === 'away') {
          const force = fireplaceActive;
          await writeComfort(0, { force });
          if (temporaryRapidActive) {
            await writeRapidTrigger(TRIGGER_VALUE, { priority: null });
          }
        } else if (mode === 'high') {
          const comfortOk = await writeComfort(1);
          if (!unit.blockedWrites.has(ventilationModeKey) && comfortOk) {
            await writeVentMode(VENTILATION_MODE_VALUES.HIGH);
          } else if (unit.blockedWrites.has(ventilationModeKey)) {
            this.warn('[UnitRegistry] Ventilation mode write blocked; cannot set high mode.');
          }
        } else if (mode === 'fireplace') {
          const comfortState = unit.probeValues.get(objectKey(OBJECT_TYPE.BINARY_VALUE, 50));
          if (comfortState !== 1) {
            await writeComfort(1);
          }
          await writeUpdate({
            objectId: BACNET_OBJECTS.fireplaceVentilationRuntime,
            tag: BacnetEnums.ApplicationTags.UNSIGNED_INTEGER,
            value: fireplaceRuntime,
          });
          await writeUpdate({
            objectId: BACNET_OBJECTS.fireplaceVentilationTrigger,
            tag: BacnetEnums.ApplicationTags.UNSIGNED_INTEGER,
            value: TRIGGER_VALUE,
          });
        }
      });

      return unit.writeQueue;
    }

    private extractValue(obj: any): number | undefined {
      try {
        if (obj.values && obj.values[0] && obj.values[0].value && obj.values[0].value[0]) {
          return obj.values[0].value[0].value;
        }
      } catch (_e) { /* ignore */ }
      return undefined;
    }
}

export const Registry = new UnitRegistry();
