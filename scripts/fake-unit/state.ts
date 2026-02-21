import {
  APPLICATION_TAG,
  DEFAULT_POINT_VALUES,
  FanMode,
  MODE_RF_VALUES,
  OBJECT_TYPE,
  OPERATION_MODE_VALUES,
  POINTS_BY_OBJECT,
  PROPERTY_ID,
  SUPPORTED_POINTS,
  SupportedPoint,
  VENTILATION_MODE_VALUES,
  clamp,
  pointKey,
} from './manifest';

const Bacnet = require('bacstack');

const BacnetEnums = Bacnet.enum;

const ERROR_CLASS = BacnetEnums.ErrorClass;
const ERROR_CODE = BacnetEnums.ErrorCode;

const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;

export interface FakeUnitIdentity {
  deviceId: number;
  serial: string;
  modelName: string;
  deviceName: string;
  firmware: string;
  vendorName: string;
  vendorId: number;
}

export interface FakeUnitOptions {
  identity: FakeUnitIdentity;
  timeScale: number;
}

export interface BacnetFailure {
  ok: false;
  errorClass: number;
  errorCode: number;
  message: string;
}

export interface BacnetSuccess<T> {
  ok: true;
  value: T;
}

export type BacnetResult<T> = BacnetSuccess<T> | BacnetFailure;

export interface PointSnapshot extends SupportedPoint {
  value: number;
}

export interface FakeUnitSnapshot {
  identity: FakeUnitIdentity;
  timeScale: number;
  mode: FanMode;
  timers: {
    rapidMinutes: number;
    fireplaceMinutes: number;
    awayDelayMinutes: number;
  };
  points: PointSnapshot[];
}

export interface FakeUnitSummary {
  mode: FanMode;
  setpoints: {
    home: number;
    away: number;
  };
  temperatures: {
    supply: number;
    extract: number;
    outdoor: number;
    room: number;
  };
  humidity: {
    extract: number;
    room: number;
  };
  fan: {
    supplyPercent: number;
    extractPercent: number;
    supplyRpm: number;
    extractRpm: number;
  };
  filter: {
    operatingHours: number;
    limitHours: number;
    remainingPercent: number;
  };
  timers: {
    rapidMinutes: number;
    fireplaceMinutes: number;
    awayDelayMinutes: number;
  };
}

function roundTo(value: number, decimals: number) {
  const m = 10 ** decimals;
  return Math.round(value * m) / m;
}

function asInteger(value: number) {
  return Math.round(value);
}

export class FakeNordicUnitState {
  private readonly identity: FakeUnitIdentity;

  private readonly timeScale: number;

  private readonly values = new Map<string, number>();

  private readonly pointsByName = new Map<string, SupportedPoint>();

  private lastTickMs = Date.now();

  private rapidRemainingMinutes = 0;

  private fireplaceRemainingMinutes = 0;

  private awayDelayRemainingMinutes = 0;

  private mode: FanMode = 'home';

  constructor(options: FakeUnitOptions) {
    this.identity = options.identity;
    this.timeScale = Math.max(0.1, options.timeScale);

    for (const point of SUPPORTED_POINTS) {
      this.pointsByName.set(point.name, point);
    }

    for (const point of SUPPORTED_POINTS) {
      const key = pointKey(point.type, point.instance);
      const value = DEFAULT_POINT_VALUES[key];
      this.values.set(key, typeof value === 'number' ? value : 0);
    }

    this.rapidRemainingMinutes = this.getByName('remaining_rapid');
    this.fireplaceRemainingMinutes = this.getByName('remaining_fireplace');
    this.mode = this.computeMode();
    this.recomputeDerivedValues(0);
  }

  getIdentity(): FakeUnitIdentity {
    // eslint-disable-next-line prefer-object-spread
    return Object.assign({}, this.identity);
  }

  getTimeScale(): number {
    return this.timeScale;
  }

  getMode(): FanMode {
    return this.mode;
  }

  tick(nowMs = Date.now()) {
    const elapsedRealSeconds = Math.max(0, (nowMs - this.lastTickMs) / 1000);
    this.lastTickMs = nowMs;
    const elapsedSimSeconds = elapsedRealSeconds * this.timeScale;

    if (elapsedSimSeconds > 0) {
      const elapsedMinutes = elapsedSimSeconds / SECONDS_PER_MINUTE;
      this.rapidRemainingMinutes = Math.max(0, this.rapidRemainingMinutes - elapsedMinutes);
      this.fireplaceRemainingMinutes = Math.max(0, this.fireplaceRemainingMinutes - elapsedMinutes);

      const comfortButton = asInteger(this.getByName('comfort_button'));
      if (comfortButton === 0 && this.awayDelayRemainingMinutes > 0) {
        this.awayDelayRemainingMinutes = Math.max(0, this.awayDelayRemainingMinutes - elapsedMinutes);
      } else if (comfortButton !== 0) {
        this.awayDelayRemainingMinutes = 0;
      }

      this.recomputeDerivedValues(elapsedSimSeconds);
    } else {
      this.recomputeDerivedValues(0);
    }
  }

  advanceSimulatedSeconds(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const realSeconds = seconds / this.timeScale;
    this.tick(this.lastTickMs + (realSeconds * 1000));
  }

  getPoint(type: number, instance: number): SupportedPoint | undefined {
    return POINTS_BY_OBJECT.get(pointKey(type, instance));
  }

  readPresentValue(type: number, instance: number, propertyId: number): BacnetResult<{ point: SupportedPoint; value: number }> {
    if (propertyId !== PROPERTY_ID.PRESENT_VALUE) {
      return this.failure(ERROR_CLASS.PROPERTY, ERROR_CODE.UNKNOWN_PROPERTY, `Unsupported property ${propertyId}`);
    }

    const point = this.getPoint(type, instance);
    if (!point) {
      return this.failure(ERROR_CLASS.OBJECT, ERROR_CODE.UNKNOWN_OBJECT, `Unsupported object ${type}:${instance}`);
    }

    const value = this.values.get(pointKey(type, instance));
    if (typeof value !== 'number') {
      return this.failure(ERROR_CLASS.PROPERTY, ERROR_CODE.VALUE_NOT_INITIALIZED, `No value for ${type}:${instance}`);
    }

    return { ok: true, value: { point, value } };
  }

  writePresentValue(
    type: number,
    instance: number,
    propertyId: number,
    numericValue: number,
    priority?: number,
  ): BacnetResult<null> {
    if (!Number.isFinite(numericValue)) {
      return this.failure(ERROR_CLASS.PROPERTY, ERROR_CODE.INVALID_DATA_TYPE, 'Value must be numeric');
    }

    if (propertyId !== PROPERTY_ID.PRESENT_VALUE) {
      return this.failure(ERROR_CLASS.PROPERTY, ERROR_CODE.UNKNOWN_PROPERTY, `Unsupported property ${propertyId}`);
    }

    const point = this.getPoint(type, instance);
    if (!point) {
      return this.failure(ERROR_CLASS.OBJECT, ERROR_CODE.UNKNOWN_OBJECT, `Unsupported object ${type}:${instance}`);
    }

    const isObservedFlexitGoCompatibilityWrite = this.isObservedFlexitGoFilterResetWrite(
      point,
      numericValue,
      priority,
    );

    if (point.access !== 'RW' && !isObservedFlexitGoCompatibilityWrite) {
      return this.failure(ERROR_CLASS.PROPERTY, ERROR_CODE.WRITE_ACCESS_DENIED, `${point.name} is read-only`);
    }

    // Real units accept missing priority from some clients. Flexit GO is observed using
    // explicit priority 16 for some writes, while Nordic docs specify 13 for BACnet clients.
    // Allow both to emulate real-unit interoperability.
    if (point.requiresPriority13 && priority !== undefined && priority !== 13 && priority !== 16) {
      return this.failure(ERROR_CLASS.PROPERTY, ERROR_CODE.WRITE_ACCESS_DENIED, `${point.name} requires priority 13`);
    }

    const normalized = this.normalizeWriteValue(point, numericValue);
    if (!Number.isFinite(normalized)) {
      return this.failure(ERROR_CLASS.PROPERTY, ERROR_CODE.INVALID_DATA_TYPE, `Invalid value for ${point.name}`);
    }

    if ((typeof point.min === 'number' && normalized < point.min) || (typeof point.max === 'number' && normalized > point.max)) {
      return this.failure(ERROR_CLASS.PROPERTY, ERROR_CODE.VALUE_OUT_OF_RANGE, `Out of range for ${point.name}`);
    }

    this.setValue(point, normalized);
    this.applyPostWriteBehavior(point, normalized);
    this.tick();
    return { ok: true, value: null };
  }

  private isObservedFlexitGoFilterResetWrite(point: SupportedPoint, value: number, priority?: number) {
    // Observed Flexit GO flow writes AV:285 presentValue=0 with priority 16
    // when user confirms filter replacement. Accept this compatibility write
    // even though docs model AV:285 as read-only.
    return (
      point.type === OBJECT_TYPE.ANALOG_VALUE
      && point.instance === 285
      && Math.abs(value) < 0.001
      && priority === 16
    );
  }

  setFanMode(mode: FanMode): BacnetResult<null> {
    switch (mode) {
      case 'away': {
        const comfort = this.getPointByName('comfort_button');
        if (!comfort) return this.failure(ERROR_CLASS.OBJECT, ERROR_CODE.UNKNOWN_OBJECT, 'Missing comfort button object');
        return this.writePresentValue(comfort.type, comfort.instance, PROPERTY_ID.PRESENT_VALUE, 0, 13);
      }
      case 'home': {
        const comfort = this.getPointByName('comfort_button');
        const ventMode = this.getPointByName('ventilation_mode');
        if (!comfort || !ventMode) return this.failure(ERROR_CLASS.OBJECT, ERROR_CODE.UNKNOWN_OBJECT, 'Missing mode objects');
        const first = this.writePresentValue(comfort.type, comfort.instance, PROPERTY_ID.PRESENT_VALUE, 1, 13);
        if (!first.ok) return first;
        return this.writePresentValue(
          ventMode.type,
          ventMode.instance,
          PROPERTY_ID.PRESENT_VALUE,
          VENTILATION_MODE_VALUES.HOME,
          13,
        );
      }
      case 'high': {
        const comfort = this.getPointByName('comfort_button');
        const ventMode = this.getPointByName('ventilation_mode');
        if (!comfort || !ventMode) return this.failure(ERROR_CLASS.OBJECT, ERROR_CODE.UNKNOWN_OBJECT, 'Missing mode objects');
        const first = this.writePresentValue(comfort.type, comfort.instance, PROPERTY_ID.PRESENT_VALUE, 1, 13);
        if (!first.ok) return first;
        return this.writePresentValue(
          ventMode.type,
          ventMode.instance,
          PROPERTY_ID.PRESENT_VALUE,
          VENTILATION_MODE_VALUES.HIGH,
          13,
        );
      }
      case 'fireplace': {
        const trigger = this.getPointByName('trigger_fireplace');
        if (!trigger) return this.failure(ERROR_CLASS.OBJECT, ERROR_CODE.UNKNOWN_OBJECT, 'Missing fireplace trigger object');
        return this.writePresentValue(trigger.type, trigger.instance, PROPERTY_ID.PRESENT_VALUE, 2, 13);
      }
      default:
        return this.failure(ERROR_CLASS.PROPERTY, ERROR_CODE.INVALID_DATA_TYPE, `Unknown mode ${mode}`);
    }
  }

  setHomeSetpoint(value: number): BacnetResult<null> {
    const point = this.getPointByName('setpoint_home');
    if (!point) return this.failure(ERROR_CLASS.OBJECT, ERROR_CODE.UNKNOWN_OBJECT, 'Missing setpoint_home object');
    return this.writePresentValue(point.type, point.instance, PROPERTY_ID.PRESENT_VALUE, value, 13);
  }

  setAwaySetpoint(value: number): BacnetResult<null> {
    const point = this.getPointByName('setpoint_away');
    if (!point) return this.failure(ERROR_CLASS.OBJECT, ERROR_CODE.UNKNOWN_OBJECT, 'Missing setpoint_away object');
    return this.writePresentValue(point.type, point.instance, PROPERTY_ID.PRESENT_VALUE, value, 13);
  }

  getPointSnapshots(): PointSnapshot[] {
    // eslint-disable-next-line prefer-object-spread
    return SUPPORTED_POINTS.map((point) => Object.assign({}, point, {
      value: this.values.get(pointKey(point.type, point.instance)) ?? 0,
    }));
  }

  snapshot(): FakeUnitSnapshot {
    this.tick();
    return {
      identity: this.getIdentity(),
      timeScale: this.timeScale,
      mode: this.mode,
      timers: {
        rapidMinutes: roundTo(this.rapidRemainingMinutes, 2),
        fireplaceMinutes: roundTo(this.fireplaceRemainingMinutes, 2),
        awayDelayMinutes: roundTo(this.awayDelayRemainingMinutes, 2),
      },
      points: this.getPointSnapshots(),
    };
  }

  summary(): FakeUnitSummary {
    this.tick();
    const filter = this.getFilterStatus();
    return {
      mode: this.mode,
      setpoints: {
        home: this.getByName('setpoint_home'),
        away: this.getByName('setpoint_away'),
      },
      temperatures: {
        supply: roundTo(this.getByName('temp_supply'), 3),
        extract: roundTo(this.getByName('temp_extract'), 3),
        outdoor: roundTo(this.getByName('temp_outside'), 3),
        room: roundTo(this.getByName('temp_room'), 3),
      },
      humidity: {
        extract: roundTo(this.getByName('humidity_extract'), 3),
        room: roundTo(this.getByName('humidity_room_1'), 3),
      },
      fan: {
        supplyPercent: roundTo(this.getByName('fan_speed_supply_percent'), 2),
        extractPercent: roundTo(this.getByName('fan_speed_extract_percent'), 2),
        supplyRpm: roundTo(this.getByName('fan_rpm_supply'), 0),
        extractRpm: roundTo(this.getByName('fan_rpm_extract'), 0),
      },
      filter,
      timers: {
        rapidMinutes: roundTo(this.rapidRemainingMinutes, 2),
        fireplaceMinutes: roundTo(this.fireplaceRemainingMinutes, 2),
        awayDelayMinutes: roundTo(this.awayDelayRemainingMinutes, 2),
      },
    };
  }

  setFilterOperatingHours(hours: number): BacnetResult<null> {
    const result = this.setSimulatedPoint('filter_operating_time', hours, { round: 3 });
    if (!result.ok) return result;
    this.tick();
    return { ok: true, value: null };
  }

  setFilterLimitHours(hours: number): BacnetResult<null> {
    const result = this.setSimulatedPoint('filter_exchange_limit', hours, { round: 0 });
    if (!result.ok) return result;
    this.tick();
    return { ok: true, value: null };
  }

  replaceFilter(): BacnetResult<null> {
    return this.setFilterOperatingHours(0);
  }

  startRapid(minutes?: number): BacnetResult<null> {
    if (minutes !== undefined) {
      const runtimeResult = this.setSimulatedPoint('runtime_rapid', minutes, { round: 0 });
      if (!runtimeResult.ok) return runtimeResult;
    }
    this.rapidRemainingMinutes = clamp(this.getByName('runtime_rapid'), 1, 360);
    this.setByName('trigger_rapid', 1);
    this.tick();
    return { ok: true, value: null };
  }

  startFireplace(minutes?: number): BacnetResult<null> {
    if (minutes !== undefined) {
      const runtimeResult = this.setSimulatedPoint('runtime_fireplace', minutes, { round: 0 });
      if (!runtimeResult.ok) return runtimeResult;
    }
    this.fireplaceRemainingMinutes = clamp(this.getByName('runtime_fireplace'), 1, 360);
    this.setByName('trigger_fireplace', 1);
    this.tick();
    return { ok: true, value: null };
  }

  getFilterStatus() {
    const operatingHours = roundTo(this.getByName('filter_operating_time'), 3);
    const limitHours = roundTo(this.getByName('filter_exchange_limit'), 3);
    const remainingPercent = limitHours > 0
      ? roundTo(clamp((1 - (operatingHours / limitHours)) * 100, 0, 100), 1)
      : 0;
    return {
      operatingHours,
      limitHours,
      remainingPercent,
    };
  }

  private recomputeDerivedValues(elapsedSimSeconds: number) {
    this.syncTimerPoints();

    this.mode = this.computeMode();
    const cookerHoodActive = asInteger(this.getByName('cooker_hood')) === 1;

    this.setByName('rapid_active', this.rapidRemainingMinutes > 0 ? 1 : 0);
    this.setByName('fireplace_active', this.fireplaceRemainingMinutes > 0 ? 1 : 0);
    this.setByName('remaining_temp_vent', this.rapidRemainingMinutes);
    this.setByName(
      'away_delay_active',
      asInteger(this.getByName('comfort_button')) === 0 && this.awayDelayRemainingMinutes > 0 ? 1 : 0,
    );
    this.setByName('mode_rf_input', MODE_RF_VALUES[this.mode]);

    let operationMode: number = OPERATION_MODE_VALUES.AWAY;
    if (this.fireplaceRemainingMinutes > 0) operationMode = OPERATION_MODE_VALUES.FIREPLACE;
    else if (this.rapidRemainingMinutes > 0) operationMode = OPERATION_MODE_VALUES.TEMPORARY_HIGH;
    else if (cookerHoodActive) operationMode = OPERATION_MODE_VALUES.COOKER_HOOD;
    else if (this.mode === 'home') operationMode = OPERATION_MODE_VALUES.HOME;
    else if (this.mode === 'high') operationMode = OPERATION_MODE_VALUES.HIGH;
    else operationMode = OPERATION_MODE_VALUES.AWAY;
    this.setByName('operation_mode', operationMode);

    const fanTargets = this.targetFanPercent(this.mode, cookerHoodActive);
    this.setByName('fan_speed_supply_percent', fanTargets.supply);
    this.setByName('fan_speed_extract_percent', fanTargets.extract);
    this.setByName('fan_rpm_supply', fanTargets.supply * 39);
    this.setByName('fan_rpm_extract', fanTargets.extract * 39);
    this.setByName('rotor_speed_percent', this.mode === 'away' ? 40 : 65);

    const currentOutside = this.getByName('temp_outside');
    const outsideDrift = (Math.random() - 0.5) * 0.02 * elapsedSimSeconds;
    this.setByName('temp_outside', clamp(currentOutside + outsideDrift, -20, 35));

    const currentSupply = this.getByName('temp_supply');
    const setpoint = this.mode === 'away' ? this.getByName('setpoint_away') : this.getByName('setpoint_home');
    const supplyStep = Math.min(1, elapsedSimSeconds / 120);
    const nextSupply = currentSupply + ((setpoint - currentSupply) * supplyStep);
    this.setByName('temp_supply', roundTo(nextSupply, 3));

    const currentRoom = this.getByName('temp_room');
    const roomTarget = nextSupply + 1;
    const roomStep = Math.min(1, elapsedSimSeconds / 360);
    const nextRoom = currentRoom + ((roomTarget - currentRoom) * roomStep);
    this.setByName('temp_room', roundTo(nextRoom, 3));
    this.setByName('temp_extract', roundTo(nextRoom - 0.3, 3));
    this.setByName('temp_extract_doc', roundTo(nextRoom - 0.3, 3));
    this.setByName('temp_exhaust', roundTo(nextSupply - 2, 3));

    const extractHumidityBase = this.mode === 'away' ? 32 : 36;
    const humidityWave = Math.sin(Date.now() / 60000) * 1.8;
    const extractHumidity = clamp(extractHumidityBase + humidityWave, 20, 80);
    this.setByName('humidity_extract', roundTo(extractHumidity, 3));
    this.setByName('humidity_room_1', roundTo(extractHumidity + 1.2, 3));
    this.setByName('humidity_room_2', roundTo(extractHumidity + 0.6, 3));
    this.setByName('humidity_room_3', roundTo(extractHumidity - 0.6, 3));
    this.setByName('air_quality_input', clamp(650 + ((this.mode === 'away' ? -80 : 120) + (humidityWave * 15)), 450, 1200));

    const delta = Math.max(0, setpoint - nextSupply);
    const heaterPowerKw = clamp(roundTo(delta * 0.18, 3), 0, 0.8);
    this.setByName('heater_power_kw', heaterPowerKw);
    this.setByName('heater_electric_position_percent', roundTo((heaterPowerKw / 0.8) * 100, 3));
    this.setByName('heater_valve_position_percent', 0);
    this.setByName('temp_frost_protection', 5 + (heaterPowerKw * 2));
    this.setByName('extract_pressure', 0);
    this.setByName('supply_pressure', 0);

    const filterHours = this.getByName('filter_operating_time');
    const filterHoursIncrement = elapsedSimSeconds / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR);
    this.setByName('filter_operating_time', roundTo(filterHours + filterHoursIncrement, 3));
  }

  private syncTimerPoints() {
    this.setByName('remaining_rapid', roundTo(this.rapidRemainingMinutes, 3));
    this.setByName('remaining_fireplace', roundTo(this.fireplaceRemainingMinutes, 3));
    this.setByName('trigger_rapid', 1);
    this.setByName('trigger_fireplace', 1);
  }

  private computeMode(): FanMode {
    const comfortButton = asInteger(this.getByName('comfort_button'));
    const ventMode = asInteger(this.getByName('ventilation_mode'));

    if (this.fireplaceRemainingMinutes > 0) return 'fireplace';
    if (this.rapidRemainingMinutes > 0) return 'high';
    if (comfortButton === 0 && this.awayDelayRemainingMinutes <= 0) return 'away';

    if (ventMode === VENTILATION_MODE_VALUES.HIGH) return 'high';
    if (ventMode === VENTILATION_MODE_VALUES.HOME) return 'home';
    return 'away';
  }

  private targetFanPercent(mode: FanMode, cookerHoodActive: boolean): { supply: number; extract: number } {
    if (this.fireplaceRemainingMinutes > 0 || mode === 'fireplace') {
      return {
        supply: this.getByName('fan_profile_supply_fireplace'),
        extract: this.getByName('fan_profile_extract_fireplace'),
      };
    }
    if (cookerHoodActive) {
      return {
        supply: this.getByName('fan_profile_supply_cooker'),
        extract: this.getByName('fan_profile_extract_cooker'),
      };
    }
    if (mode === 'away') {
      return {
        supply: this.getByName('fan_profile_supply_away'),
        extract: this.getByName('fan_profile_extract_away'),
      };
    }
    if (mode === 'high') {
      return {
        supply: this.getByName('fan_profile_supply_high'),
        extract: this.getByName('fan_profile_extract_high'),
      };
    }
    return {
      supply: this.getByName('fan_profile_supply_home'),
      extract: this.getByName('fan_profile_extract_home'),
    };
  }

  private normalizeWriteValue(point: SupportedPoint, value: number): number {
    if (point.kind === 'enum' || point.kind === 'unsigned' || point.kind === 'bool') return asInteger(value);
    return roundTo(value, 3);
  }

  private applyPostWriteBehavior(point: SupportedPoint, value: number) {
    if (point.name === 'comfort_button') {
      if (asInteger(value) === 0) this.awayDelayRemainingMinutes = this.getByName('away_delay_timer');
      if (asInteger(value) === 1) this.awayDelayRemainingMinutes = 0;
      return;
    }

    if (point.name === 'trigger_rapid' && asInteger(value) === 2) {
      this.rapidRemainingMinutes = clamp(this.getByName('runtime_rapid'), 1, 360);
      this.setByName('trigger_rapid', 1);
      return;
    }

    if (point.name === 'trigger_fireplace' && asInteger(value) === 2) {
      this.fireplaceRemainingMinutes = clamp(this.getByName('runtime_fireplace'), 1, 360);
      this.setByName('trigger_fireplace', 1);
      return;
    }

    if (
      (point.name === 'filter_replace_timer_reset' || point.name === 'filter_replace_timer_reset_legacy')
      && asInteger(value) === 2
    ) {
      this.setByName('filter_operating_time', 0);
      this.setByName(point.name, 1);
      return;
    }

    if (point.name === 'runtime_rapid') {
      this.setByName('runtime_rapid', clamp(asInteger(value), point.min, point.max));
      return;
    }

    if (point.name === 'runtime_fireplace') {
      this.setByName('runtime_fireplace', clamp(asInteger(value), point.min, point.max));
    }
  }

  private setValue(point: SupportedPoint, value: number) {
    this.values.set(pointKey(point.type, point.instance), value);
  }

  private setSimulatedPoint(
    pointName: string,
    value: number,
    opts?: { round?: number },
  ): BacnetResult<null> {
    const point = this.getPointByName(pointName);
    if (!point) {
      return this.failure(ERROR_CLASS.OBJECT, ERROR_CODE.UNKNOWN_OBJECT, `Missing point ${pointName}`);
    }
    if (!Number.isFinite(value)) {
      return this.failure(ERROR_CLASS.PROPERTY, ERROR_CODE.INVALID_DATA_TYPE, `Invalid value for ${pointName}`);
    }
    const normalized = typeof opts?.round === 'number' ? roundTo(value, opts.round) : value;
    if ((typeof point.min === 'number' && normalized < point.min) || (typeof point.max === 'number' && normalized > point.max)) {
      return this.failure(ERROR_CLASS.PROPERTY, ERROR_CODE.VALUE_OUT_OF_RANGE, `Out of range for ${pointName}`);
    }
    this.setByName(pointName, normalized);
    return { ok: true, value: null };
  }

  private getByName(name: string): number {
    const point = this.getPointByName(name);
    if (!point) return 0;
    return this.values.get(pointKey(point.type, point.instance)) ?? 0;
  }

  private setByName(name: string, value: number) {
    const point = this.getPointByName(name);
    if (!point) return;
    const next = clamp(value, point.min, point.max);
    this.values.set(pointKey(point.type, point.instance), next);
  }

  private getPointByName(name: string): SupportedPoint | undefined {
    return this.pointsByName.get(name);
  }

  private failure(errorClass: number, errorCode: number, message: string): BacnetFailure {
    return {
      ok: false,
      errorClass,
      errorCode,
      message,
    };
  }
}

export function valueToWriteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.value === 'number' && Number.isFinite(obj.value)) return obj.value;
  }
  return null;
}

export function valueTagForRead(point: SupportedPoint): number {
  if (point.type === OBJECT_TYPE.MULTI_STATE_VALUE) {
    // Real Flexit units encode MSV presentValue as UNSIGNED_INTEGER.
    return APPLICATION_TAG.UNSIGNED_INTEGER;
  }

  switch (point.kind) {
    case 'real':
      return APPLICATION_TAG.REAL;
    case 'enum':
      return APPLICATION_TAG.ENUMERATED;
    case 'bool':
    case 'unsigned':
      return APPLICATION_TAG.UNSIGNED_INTEGER;
    default:
      return APPLICATION_TAG.REAL;
  }
}
