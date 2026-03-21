/* eslint-disable max-lines */
import { getBacnetClient, BacnetEnums, setBacnetLogger } from './bacnetClient';
import { discoverFlexitUnits } from './flexitDiscovery';
import {
  FlexitCloudClient,
  bacnetObjectToCloudPath,
  AuthenticationError,
} from './flexitCloudClient';

// Helper to clamp values
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizeBacnetPort(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return undefined;
  if (numeric < 1 || numeric > 65535) return undefined;
  return numeric;
}

export interface FlexitDevice {
    getData(): { unitId: string };
    getSetting(key: string): string | number | boolean | null;
    applyRegistrySettings?(settings: Record<string, any>): Promise<void>;
    setSetting?(settings: Record<string, any>): Promise<void>;
    setSettings?(settings: Record<string, any>): Promise<void>;
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
const FLEXIT_GO_WRITE_PRIORITY = 16;
export const MIN_TARGET_TEMPERATURE_C = 10;
export const MAX_TARGET_TEMPERATURE_C = 30;
const TARGET_TEMPERATURE_STEP_C = 0.5;
export const TARGET_TEMPERATURE_HOME_SETTING = 'target_temperature_home';
export const TARGET_TEMPERATURE_AWAY_SETTING = 'target_temperature_away';
export const FIREPLACE_DURATION_SETTING = 'fireplace_duration_minutes';
const BACNET_IP_SETTING = 'ip';
const BACNET_PORT_SETTING = 'bacnetPort';
export const MIN_FIREPLACE_DURATION_MINUTES = 1;
export const MAX_FIREPLACE_DURATION_MINUTES = 360;
type TargetTemperatureMode = 'home' | 'away';
export const FILTER_CHANGE_INTERVAL_MONTHS_SETTING = 'filter_change_interval_months';
export const FILTER_CHANGE_INTERVAL_HOURS_LEGACY_SETTING = 'filter_change_interval_hours';
export const FAN_PROFILE_MODES = ['home', 'away', 'high', 'fireplace', 'cooker'] as const;
export type FanProfileMode = (typeof FAN_PROFILE_MODES)[number];
export type FanProfileFan = 'supply' | 'exhaust';
const CURRENT_FAN_SETPOINT_CAPABILITIES: Record<FanProfileFan, string> = {
  supply: 'measure_fan_setpoint_percent',
  exhaust: 'measure_fan_setpoint_percent.extract',
};
// Observed Flexit GO range hints (AV 1835..1844 proprietary 5036/5037, also probed as LOW/HIGH_LIMIT).
export const FAN_PROFILE_PERCENT_RANGES: Record<FanProfileMode, Record<FanProfileFan, { min: number; max: number }>> = {
  high: {
    supply: { min: 80, max: 100 },
    exhaust: { min: 79, max: 100 },
  },
  home: {
    supply: { min: 56, max: 100 },
    exhaust: { min: 55, max: 99 },
  },
  away: {
    supply: { min: 30, max: 80 },
    exhaust: { min: 30, max: 79 },
  },
  fireplace: {
    supply: { min: 30, max: 100 },
    exhaust: { min: 30, max: 100 },
  },
  cooker: {
    supply: { min: 30, max: 100 },
    exhaust: { min: 30, max: 100 },
  },
};
export const MIN_FAN_PROFILE_PERCENT = 30;
export const MAX_FAN_PROFILE_PERCENT = 100;
export const FAN_PROFILE_SETTING_KEYS: Record<FanProfileMode, Record<FanProfileFan, string>> = {
  home: {
    supply: 'fan_profile_home_supply',
    exhaust: 'fan_profile_home_exhaust',
  },
  away: {
    supply: 'fan_profile_away_supply',
    exhaust: 'fan_profile_away_exhaust',
  },
  high: {
    supply: 'fan_profile_high_supply',
    exhaust: 'fan_profile_high_exhaust',
  },
  fireplace: {
    supply: 'fan_profile_fireplace_supply',
    exhaust: 'fan_profile_fireplace_exhaust',
  },
  cooker: {
    supply: 'fan_profile_cooker_supply',
    exhaust: 'fan_profile_cooker_exhaust',
  },
};
const FAN_PROFILE_OBJECTS: Record<FanProfileMode, Record<FanProfileFan, { type: number; instance: number }>> = {
  high: {
    supply: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1835 },
    exhaust: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1840 },
  },
  home: {
    supply: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1836 },
    exhaust: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1841 },
  },
  away: {
    supply: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1837 },
    exhaust: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1842 },
  },
  fireplace: {
    supply: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1838 },
    exhaust: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1843 },
  },
  cooker: {
    supply: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1839 },
    exhaust: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1844 },
  },
};
const FAN_PROFILE_DATA_KEYS: Record<FanProfileMode, Record<FanProfileFan, string>> = {
  home: {
    supply: 'fan_profile.home.supply',
    exhaust: 'fan_profile.home.exhaust',
  },
  away: {
    supply: 'fan_profile.away.supply',
    exhaust: 'fan_profile.away.exhaust',
  },
  high: {
    supply: 'fan_profile.high.supply',
    exhaust: 'fan_profile.high.exhaust',
  },
  fireplace: {
    supply: 'fan_profile.fireplace.supply',
    exhaust: 'fan_profile.fireplace.exhaust',
  },
  cooker: {
    supply: 'fan_profile.cooker.supply',
    exhaust: 'fan_profile.cooker.exhaust',
  },
};
// Flexit GO observed behavior: 5 months is written as 3660 hours (5 * 732).
export const FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH = 732;
export const MIN_FILTER_CHANGE_INTERVAL_MONTHS = 3;
export const MAX_FILTER_CHANGE_INTERVAL_MONTHS = 12;
export const MIN_FILTER_CHANGE_INTERVAL_HOURS = (
  MIN_FILTER_CHANGE_INTERVAL_MONTHS * FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH
);
export const MAX_FILTER_CHANGE_INTERVAL_HOURS = (
  MAX_FILTER_CHANGE_INTERVAL_MONTHS * FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH
);

const POLL_INTERVAL_MS = 10_000;
const CLOUD_POLL_INTERVAL_MS = 60_000;
const POLL_WATCHDOG_TIMEOUT_MS = 20_000;
const MODE_MISMATCH_GRACE_MS = 1000;
const REDISCOVERY_INTERVAL_MS = 60_000;
const MAX_BACNET_CONSECUTIVE_FAILURES = 1;
const MAX_CLOUD_CONSECUTIVE_FAILURES = 3;
const DEFAULT_WRITE_TIMEOUT_MS = 5_000;
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
const HEATING_COIL_OFF = 0;
const HEATING_COIL_ON = 1;
const COOKER_HOOD_ON = 1;

const BACNET_OBJECTS = {
  comfortButton: { type: OBJECT_TYPE.BINARY_VALUE, instance: 50 },
  comfortButtonDelay: { type: OBJECT_TYPE.POSITIVE_INTEGER_VALUE, instance: 318 },
  ventilationMode: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 42 },
  operationMode: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 361 },
  heatingCoilEnable: { type: OBJECT_TYPE.BINARY_VALUE, instance: 445 },
  dehumidificationSlopeRequest: { type: OBJECT_TYPE.BINARY_VALUE, instance: 653 },
  dehumidificationFanControl: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1870 },
  rapidVentilationTrigger: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 357 },
  rapidVentilationRuntime: { type: OBJECT_TYPE.POSITIVE_INTEGER_VALUE, instance: 293 },
  rapidVentilationRemaining: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 2031 },
  fireplaceVentilationTrigger: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 360 },
  fireplaceVentilationRuntime: { type: OBJECT_TYPE.POSITIVE_INTEGER_VALUE, instance: 270 },
  fireplaceVentilationRemaining: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 2038 },
  filterOperatingTime: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 285 },
  fireplaceState: { type: OBJECT_TYPE.BINARY_VALUE, instance: 400 },
  cookerHood: { type: OBJECT_TYPE.BINARY_VALUE, instance: 402 },
  resetTempVentOp: { type: OBJECT_TYPE.BINARY_VALUE, instance: 452 },
  resetTempRapidRf: { type: OBJECT_TYPE.BINARY_VALUE, instance: 487 },
  resetTempFireplaceRf: { type: OBJECT_TYPE.BINARY_VALUE, instance: 488 },
};
const FILTER_LIMIT_OBJECT = { type: OBJECT_TYPE.ANALOG_VALUE, instance: 286 };
const TARGET_TEMPERATURE_OBJECTS: Record<TargetTemperatureMode, { type: number; instance: number }> = {
  home: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1994 },
  away: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1985 },
};
const TARGET_TEMPERATURE_DATA_KEYS: Record<TargetTemperatureMode, string> = {
  home: 'target_temperature.home',
  away: 'target_temperature.away',
};
const TARGET_TEMPERATURE_SETTING_KEYS: Record<TargetTemperatureMode, string> = {
  home: TARGET_TEMPERATURE_HOME_SETTING,
  away: TARGET_TEMPERATURE_AWAY_SETTING,
};
const FIREPLACE_DURATION_DATA_KEY = 'fireplace_duration_minutes';

const objectKey = (type: number, instance: number) => `${type}:${instance}`;
const FIREPLACE_RUNTIME_KEY = objectKey(
  BACNET_OBJECTS.fireplaceVentilationRuntime.type,
  BACNET_OBJECTS.fireplaceVentilationRuntime.instance,
);
const VENTILATION_MODE_KEY = objectKey(
  BACNET_OBJECTS.ventilationMode.type,
  BACNET_OBJECTS.ventilationMode.instance,
);
const OPERATION_MODE_KEY = objectKey(
  BACNET_OBJECTS.operationMode.type,
  BACNET_OBJECTS.operationMode.instance,
);
const COMFORT_BUTTON_KEY = objectKey(
  BACNET_OBJECTS.comfortButton.type,
  BACNET_OBJECTS.comfortButton.instance,
);
const HEATING_COIL_ENABLE_KEY = objectKey(
  BACNET_OBJECTS.heatingCoilEnable.type,
  BACNET_OBJECTS.heatingCoilEnable.instance,
);
const RAPID_ACTIVE_KEY = objectKey(OBJECT_TYPE.BINARY_VALUE, 15);
const FIREPLACE_ACTIVE_KEY = objectKey(
  BACNET_OBJECTS.fireplaceState.type,
  BACNET_OBJECTS.fireplaceState.instance,
);
const COOKER_HOOD_KEY = objectKey(
  BACNET_OBJECTS.cookerHood.type,
  BACNET_OBJECTS.cookerHood.instance,
);
const TEMP_VENT_REMAINING_KEY = objectKey(OBJECT_TYPE.ANALOG_VALUE, 2005);
const RAPID_REMAINING_KEY = objectKey(OBJECT_TYPE.ANALOG_VALUE, 2031);
const FIREPLACE_REMAINING_KEY = objectKey(OBJECT_TYPE.ANALOG_VALUE, 2038);
const MODE_RF_INPUT_KEY = objectKey(OBJECT_TYPE.ANALOG_VALUE, 2125);
const DEHUMIDIFICATION_FAN_CONTROL_KEY = objectKey(
  BACNET_OBJECTS.dehumidificationFanControl.type,
  BACNET_OBJECTS.dehumidificationFanControl.instance,
);
const DEHUMIDIFICATION_SLOPE_REQUEST_KEY = objectKey(
  BACNET_OBJECTS.dehumidificationSlopeRequest.type,
  BACNET_OBJECTS.dehumidificationSlopeRequest.instance,
);
const TARGET_TEMPERATURE_MODE_PROBE_KEY_MAP: ReadonlyArray<readonly [string, string]> = [
  [OPERATION_MODE_KEY, 'operation_mode'],
  [VENTILATION_MODE_KEY, 'ventilation_mode'],
  [COMFORT_BUTTON_KEY, 'comfort_button'],
  [RAPID_ACTIVE_KEY, 'rapid_active'],
  [FIREPLACE_ACTIVE_KEY, 'fireplace_active'],
  [TEMP_VENT_REMAINING_KEY, 'remaining_temp_vent_op'],
  [RAPID_REMAINING_KEY, 'remaining_rapid_vent'],
  [FIREPLACE_REMAINING_KEY, 'remaining_fireplace_vent'],
  [MODE_RF_INPUT_KEY, 'mode_rf_input'],
] as const;
const MODE_SIGNAL_KEYS = [
  'comfort_button',
  'ventilation_mode',
  'operation_mode',
  'rapid_active',
  'fireplace_active',
  'remaining_rapid_vent',
  'remaining_fireplace_vent',
  'remaining_temp_vent_op',
  'mode_rf_input',
];
const CAPABILITY_MAPPINGS = [
  { dataKey: 'measure_temperature', capability: 'measure_temperature' },
  { dataKey: 'measure_temperature.outdoor', capability: 'measure_temperature.outdoor' },
  { dataKey: 'measure_temperature.exhaust', capability: 'measure_temperature.exhaust' },
  { dataKey: 'measure_temperature.extract', capability: 'measure_temperature.extract' },
  { dataKey: 'measure_power', capability: 'measure_power' },
  { dataKey: 'measure_humidity', capability: 'measure_humidity' },
  { dataKey: 'measure_motor_rpm', capability: 'measure_motor_rpm' },
  { dataKey: 'measure_motor_rpm.extract', capability: 'measure_motor_rpm.extract' },
  { dataKey: 'measure_fan_speed_percent', capability: 'measure_fan_speed_percent' },
  { dataKey: 'measure_fan_speed_percent.extract', capability: 'measure_fan_speed_percent.extract' },
] as const;
const DEHUMIDIFICATION_ACTIVE_CAPABILITY = 'dehumidification_active';

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
  objectKey(BACNET_OBJECTS.filterOperatingTime.type, BACNET_OBJECTS.filterOperatingTime.instance),
]);

function mapOperationMode(value: number): 'home' | 'away' | 'high' | 'fireplace' | 'cooker' {
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
      return 'cooker';
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

function formatModeSignalValue(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return '?';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function valuesMatch(actual: number, expected: number) {
  return Math.abs(actual - expected) < 0.01;
}

function formatWriteValue(value: number | null) {
  return value === null ? 'NULL' : String(value);
}

// Real units expose dehumidification as either a positive fan-control demand or a
// slope-request flag, depending on which internal signal changes first.
function resolveDehumidificationActive(data: Record<string, number>): boolean | undefined {
  const fanControl = data.dehumidification_fan_control;
  const slopeRequest = data.dehumidification_request_by_slope;
  const hasFanControl = Number.isFinite(fanControl);
  const hasSlopeRequest = Number.isFinite(slopeRequest);

  if (!hasFanControl && !hasSlopeRequest) return undefined;

  return Boolean(
    (hasFanControl && fanControl > 0)
    || (hasSlopeRequest && Math.round(slopeRequest) === 1),
  );
}

export function normalizeTargetTemperature(value: number): number {
  const clamped = clamp(value, MIN_TARGET_TEMPERATURE_C, MAX_TARGET_TEMPERATURE_C);
  const stepped = Math.round(clamped / TARGET_TEMPERATURE_STEP_C) * TARGET_TEMPERATURE_STEP_C;
  return Number(stepped.toFixed(1));
}

export function normalizeFireplaceDurationMinutes(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error('Fireplace duration must be numeric');
  }

  const rounded = Math.round(numeric);
  if (
    rounded < MIN_FIREPLACE_DURATION_MINUTES
    || rounded > MAX_FIREPLACE_DURATION_MINUTES
  ) {
    throw new Error(
      `Fireplace duration must be between ${MIN_FIREPLACE_DURATION_MINUTES}`
      + ` and ${MAX_FIREPLACE_DURATION_MINUTES} minutes`,
    );
  }
  return rounded;
}

export function isFanProfileMode(value: unknown): value is FanProfileMode {
  return typeof value === 'string' && (FAN_PROFILE_MODES as readonly string[]).includes(value);
}

export function fanProfilePercentRange(mode: FanProfileMode, fan: FanProfileFan): { min: number; max: number } {
  return FAN_PROFILE_PERCENT_RANGES[mode][fan];
}

export function normalizeFanProfilePercent(
  value: unknown,
  mode: FanProfileMode,
  fan: FanProfileFan,
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${mode} ${fan} fan profile must be numeric`);
  }

  const rounded = Math.round(numeric);
  const range = fanProfilePercentRange(mode, fan);
  if (rounded < range.min || rounded > range.max) {
    throw new Error(
      `${mode} ${fan} fan profile must be between ${range.min}`
      + ` and ${range.max} percent`,
    );
  }

  return rounded;
}

function selectExtractTemperature(primary?: number, alternate?: number): number | undefined {
  const primaryIsNumber = typeof primary === 'number' && Number.isFinite(primary);
  const alternateIsNumber = typeof alternate === 'number' && Number.isFinite(alternate);

  if (primaryIsNumber && primary !== 0) return primary;
  if (alternateIsNumber) return alternate;
  if (primaryIsNumber) return primary;
  return undefined;
}

export function filterIntervalMonthsToHours(months: number): number {
  return Math.round(months * FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH);
}

export function filterIntervalHoursToMonths(
  hours: number,
  onClamp?: (message: string) => void,
): number {
  const rawMonths = Math.round(hours / FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH);
  const clampedMonths = clamp(
    rawMonths,
    MIN_FILTER_CHANGE_INTERVAL_MONTHS,
    MAX_FILTER_CHANGE_INTERVAL_MONTHS,
  );
  if (rawMonths !== clampedMonths && onClamp) {
    onClamp(
      `[UnitRegistry] Clamped filter interval from ${rawMonths} months`
      + ` (${hours}h) to ${clampedMonths} months`,
    );
  }
  return clampedMonths;
}

export interface CloudTransportConfig {
  plantId: string;
  client: FlexitCloudClient;
}

interface UnitState {
  unitId: string;
  serial: string;
  transport: 'bacnet' | 'cloud';
  cloud?: CloudTransportConfig;
  devices: Set<FlexitDevice>;
  pollInterval: ReturnType<typeof setInterval> | null;
  rediscoverInterval: ReturnType<typeof setInterval> | null;
  pollInFlight: boolean;
  cloudPollPromise?: Promise<void>;
  pollRetryTimer: ReturnType<typeof setTimeout> | null;
  pollWatchdogTimer: ReturnType<typeof setTimeout> | null;
  ip: string;
  bacnetPort: number;
  writeQueue: Promise<void>;
  probeValues: Map<string, number>;
  blockedWrites: Set<string>;
  pendingWriteErrors: Map<string, { value: number | null; code: number }>;
  lastWriteValues: Map<string, { value: number | null; at: number }>;
  lastPollAt?: number;
  writeContext: Map<string, { value: number; mode: string; at: number }>;
  deferredMode?: 'fireplace';
  deferredSince?: number;
  expectedMode?: string;
  expectedModeAt?: number;
  lastMismatchKey?: string;
  consecutiveFailures: number;
  available: boolean;
  currentFanSetpointMode?: FanProfileMode;
  currentFanSetpoints: Partial<Record<FanProfileFan, number>>;
  currentFanSetpointsInitialized: boolean;
  dehumidificationActive?: boolean;
  dehumidificationStateInitialized: boolean;
  heatingCoilEnabled?: boolean;
  heatingCoilStateInitialized: boolean;
}

interface PollParseTarget {
  data: Record<string, number>;
  extractTempPrimary?: number;
  extractTempAlt?: number;
}

const mapPollValue = (
  dataKey: string,
  transform?: (value: number) => number,
) => (
  value: number,
  target: PollParseTarget,
) => {
  target.data[dataKey] = transform ? transform(value) : value;
};

interface WriteOptions {
  maxSegments: number;
  maxApdu: number;
  priority: number;
}

interface WriteUpdate {
  objectId: { type: number; instance: number };
  tag: number;
  value: number | null;
  priority?: number | null;
}

interface FanModeWriteContext {
  unit: UnitState;
  mode: string;
  writeOptions: WriteOptions;
  client: any;
  ventilationModeKey: string;
  comfortButtonKey: string;
}

interface RegistryLogger {
  log(...args: any[]): void;
  error(...args: any[]): void;
  warn?(...args: any[]): void;
}

interface RegistryDependencies {
  getBacnetClient(port: number): any;
  discoverFlexitUnits: typeof discoverFlexitUnits;
  writeTimeoutMs?: number;
}

interface FanSetpointChangedEvent {
  device: FlexitDevice;
  fan: FanProfileFan;
  mode: FanProfileMode;
  setpointPercent: number;
}

interface HeatingCoilStateChangedEvent {
  device: FlexitDevice;
  enabled: boolean;
}

interface DehumidificationStateChangedEvent {
  device: FlexitDevice;
  active: boolean;
}

function presentValueRequest(objectId: { type: number; instance: number }) {
  return {
    objectId,
    properties: [{ id: PRESENT_VALUE_ID }],
  };
}

// The core poll request — only objects that drive device capabilities.
function buildPollRequest() {
  return [
    // Thermostat capabilities
    presentValueRequest(TARGET_TEMPERATURE_OBJECTS.home), // Setpoint HOME
    presentValueRequest(TARGET_TEMPERATURE_OBJECTS.away), // Setpoint AWAY
    presentValueRequest({ type: OBJECT_TYPE.ANALOG_INPUT, instance: 4 }), // Supply Temp
    presentValueRequest({ type: OBJECT_TYPE.ANALOG_INPUT, instance: 1 }), // Outdoor Temp
    presentValueRequest({ type: OBJECT_TYPE.ANALOG_INPUT, instance: 11 }), // Exhaust Temp
    presentValueRequest({
      type: OBJECT_TYPE.ANALOG_INPUT,
      instance: EXTRACT_AIR_TEMPERATURE_PRIMARY_INSTANCE,
    }), // Extract Temp (primary mapping)
    presentValueRequest({
      type: OBJECT_TYPE.ANALOG_INPUT,
      instance: EXTRACT_AIR_TEMPERATURE_ALT_INSTANCE,
    }), // Extract Temp (alternate mapping)
    presentValueRequest({ type: OBJECT_TYPE.ANALOG_INPUT, instance: 96 }), // Humidity
    presentValueRequest({ type: OBJECT_TYPE.ANALOG_VALUE, instance: 194 }), // Heater Power
    presentValueRequest(BACNET_OBJECTS.heatingCoilEnable), // Heating coil enable

    // Fan capabilities
    presentValueRequest({ type: OBJECT_TYPE.ANALOG_INPUT, instance: 5 }), // Fan RPM Supply
    presentValueRequest({ type: OBJECT_TYPE.ANALOG_INPUT, instance: 12 }), // Fan RPM Extract
    presentValueRequest({ type: OBJECT_TYPE.ANALOG_OUTPUT, instance: 3 }), // Fan Speed % Supply
    presentValueRequest({ type: OBJECT_TYPE.ANALOG_OUTPUT, instance: 4 }), // Fan Speed % Extract
    presentValueRequest(BACNET_OBJECTS.dehumidificationFanControl),
    presentValueRequest(BACNET_OBJECTS.dehumidificationSlopeRequest),
    presentValueRequest(FAN_PROFILE_OBJECTS.home.supply), // Setpoint supply HOME
    presentValueRequest(FAN_PROFILE_OBJECTS.home.exhaust), // Setpoint exhaust HOME
    presentValueRequest(FAN_PROFILE_OBJECTS.away.supply), // Setpoint supply AWAY
    presentValueRequest(FAN_PROFILE_OBJECTS.away.exhaust), // Setpoint exhaust AWAY
    presentValueRequest(FAN_PROFILE_OBJECTS.high.supply), // Setpoint supply HIGH
    presentValueRequest(FAN_PROFILE_OBJECTS.high.exhaust), // Setpoint exhaust HIGH
    presentValueRequest(FAN_PROFILE_OBJECTS.fireplace.supply), // Setpoint supply FIREPLACE
    presentValueRequest(FAN_PROFILE_OBJECTS.fireplace.exhaust), // Setpoint exhaust FIREPLACE
    presentValueRequest(FAN_PROFILE_OBJECTS.cooker.supply), // Setpoint supply COOKER
    presentValueRequest(FAN_PROFILE_OBJECTS.cooker.exhaust), // Setpoint exhaust COOKER
    presentValueRequest({ type: OBJECT_TYPE.ANALOG_VALUE, instance: 285 }), // Filter Time
    presentValueRequest({ type: OBJECT_TYPE.ANALOG_VALUE, instance: 286 }), // Filter Limit

    // Mode / comfort
    presentValueRequest(BACNET_OBJECTS.comfortButton),
    presentValueRequest(BACNET_OBJECTS.comfortButtonDelay),
    presentValueRequest(BACNET_OBJECTS.ventilationMode),
    presentValueRequest(BACNET_OBJECTS.operationMode),
    presentValueRequest(BACNET_OBJECTS.rapidVentilationTrigger),
    presentValueRequest(BACNET_OBJECTS.rapidVentilationRuntime),
    presentValueRequest(BACNET_OBJECTS.fireplaceVentilationTrigger),
    presentValueRequest(BACNET_OBJECTS.fireplaceVentilationRuntime),
    presentValueRequest({ type: OBJECT_TYPE.BINARY_VALUE, instance: 15 }), // Rapid ventilation active
    presentValueRequest(BACNET_OBJECTS.fireplaceState),
    presentValueRequest(BACNET_OBJECTS.rapidVentilationRemaining),
    presentValueRequest(BACNET_OBJECTS.fireplaceVentilationRemaining),
    presentValueRequest({ type: OBJECT_TYPE.ANALOG_VALUE, instance: 2005 }), // Remaining temp vent op
    presentValueRequest({ type: OBJECT_TYPE.ANALOG_VALUE, instance: 2125 }), // Operating mode input from RF
    presentValueRequest({ type: OBJECT_TYPE.BINARY_VALUE, instance: 574 }), // Delay for away active
  ];
}

const POLL_VALUE_MAPPINGS: Record<string, (value: number, target: PollParseTarget) => void> = {
  [objectKey(
    TARGET_TEMPERATURE_OBJECTS.home.type,
    TARGET_TEMPERATURE_OBJECTS.home.instance,
  )]: mapPollValue(TARGET_TEMPERATURE_DATA_KEYS.home),
  [objectKey(
    TARGET_TEMPERATURE_OBJECTS.away.type,
    TARGET_TEMPERATURE_OBJECTS.away.instance,
  )]: mapPollValue(TARGET_TEMPERATURE_DATA_KEYS.away),
  [objectKey(OBJECT_TYPE.ANALOG_INPUT, 4)]: mapPollValue('measure_temperature'),
  [objectKey(OBJECT_TYPE.ANALOG_INPUT, 1)]: mapPollValue('measure_temperature.outdoor'),
  [objectKey(OBJECT_TYPE.ANALOG_INPUT, 11)]: mapPollValue('measure_temperature.exhaust'),
  [objectKey(OBJECT_TYPE.ANALOG_INPUT, EXTRACT_AIR_TEMPERATURE_PRIMARY_INSTANCE)]: (
    value,
    target,
  ) => {
    target.extractTempPrimary = value;
  },
  [objectKey(OBJECT_TYPE.ANALOG_INPUT, EXTRACT_AIR_TEMPERATURE_ALT_INSTANCE)]: (
    value,
    target,
  ) => {
    target.extractTempAlt = value;
  },
  [objectKey(OBJECT_TYPE.ANALOG_INPUT, 96)]: mapPollValue('measure_humidity'),
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 194)]: mapPollValue(
    'measure_power',
    (value) => value * 1000,
  ),
  [HEATING_COIL_ENABLE_KEY]: mapPollValue('heating_coil_enabled'),
  [objectKey(OBJECT_TYPE.ANALOG_INPUT, 5)]: mapPollValue('measure_motor_rpm'),
  [objectKey(OBJECT_TYPE.ANALOG_INPUT, 12)]: mapPollValue('measure_motor_rpm.extract'),
  [objectKey(OBJECT_TYPE.ANALOG_OUTPUT, 3)]: mapPollValue('measure_fan_speed_percent'),
  [objectKey(OBJECT_TYPE.ANALOG_OUTPUT, 4)]: mapPollValue('measure_fan_speed_percent.extract'),
  [DEHUMIDIFICATION_FAN_CONTROL_KEY]: mapPollValue('dehumidification_fan_control'),
  [DEHUMIDIFICATION_SLOPE_REQUEST_KEY]: mapPollValue('dehumidification_request_by_slope'),
  [objectKey(
    FAN_PROFILE_OBJECTS.home.supply.type,
    FAN_PROFILE_OBJECTS.home.supply.instance,
  )]: mapPollValue('fan_profile.home.supply'),
  [objectKey(
    FAN_PROFILE_OBJECTS.home.exhaust.type,
    FAN_PROFILE_OBJECTS.home.exhaust.instance,
  )]: mapPollValue('fan_profile.home.exhaust'),
  [objectKey(
    FAN_PROFILE_OBJECTS.away.supply.type,
    FAN_PROFILE_OBJECTS.away.supply.instance,
  )]: mapPollValue('fan_profile.away.supply'),
  [objectKey(
    FAN_PROFILE_OBJECTS.away.exhaust.type,
    FAN_PROFILE_OBJECTS.away.exhaust.instance,
  )]: mapPollValue('fan_profile.away.exhaust'),
  [objectKey(
    FAN_PROFILE_OBJECTS.high.supply.type,
    FAN_PROFILE_OBJECTS.high.supply.instance,
  )]: mapPollValue('fan_profile.high.supply'),
  [objectKey(
    FAN_PROFILE_OBJECTS.high.exhaust.type,
    FAN_PROFILE_OBJECTS.high.exhaust.instance,
  )]: mapPollValue('fan_profile.high.exhaust'),
  [objectKey(
    FAN_PROFILE_OBJECTS.fireplace.supply.type,
    FAN_PROFILE_OBJECTS.fireplace.supply.instance,
  )]: mapPollValue('fan_profile.fireplace.supply'),
  [objectKey(
    FAN_PROFILE_OBJECTS.fireplace.exhaust.type,
    FAN_PROFILE_OBJECTS.fireplace.exhaust.instance,
  )]: mapPollValue('fan_profile.fireplace.exhaust'),
  [objectKey(
    FAN_PROFILE_OBJECTS.cooker.supply.type,
    FAN_PROFILE_OBJECTS.cooker.supply.instance,
  )]: mapPollValue('fan_profile.cooker.supply'),
  [objectKey(
    FAN_PROFILE_OBJECTS.cooker.exhaust.type,
    FAN_PROFILE_OBJECTS.cooker.exhaust.instance,
  )]: mapPollValue('fan_profile.cooker.exhaust'),
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 285)]: mapPollValue('filter_time'),
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 286)]: mapPollValue('filter_limit'),
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 50)]: mapPollValue('comfort_button'),
  [objectKey(OBJECT_TYPE.POSITIVE_INTEGER_VALUE, 318)]: mapPollValue('comfort_delay'),
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 42)]: mapPollValue('ventilation_mode'),
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 361)]: mapPollValue('operation_mode'),
  [objectKey(
    BACNET_OBJECTS.fireplaceVentilationRuntime.type,
    BACNET_OBJECTS.fireplaceVentilationRuntime.instance,
  )]: mapPollValue(FIREPLACE_DURATION_DATA_KEY),
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 15)]: mapPollValue('rapid_active'),
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 400)]: mapPollValue('fireplace_active'),
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 574)]: mapPollValue('away_delay_active'),
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 2005)]: mapPollValue('remaining_temp_vent_op'),
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 2031)]: mapPollValue('remaining_rapid_vent'),
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 2038)]: mapPollValue('remaining_fireplace_vent'),
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 2125)]: mapPollValue('mode_rf_input'),
};

const POLL_REQUEST = buildPollRequest();

export class UnitRegistry {
    private units: Map<string, UnitState> = new Map();
    private logger?: RegistryLogger;
    private readonly dependencies: RegistryDependencies;
    private fanSetpointChangedHandler?: (event: FanSetpointChangedEvent) => void;
    private dehumidificationStateChangedHandler?: (event: DehumidificationStateChangedEvent) => void;
    private heatingCoilStateChangedHandler?: (event: HeatingCoilStateChangedEvent) => void;

    constructor(dependencies?: Partial<RegistryDependencies>) {
      this.dependencies = {
        getBacnetClient,
        discoverFlexitUnits,
        ...dependencies,
      };
    }

    setLogger(logger: RegistryLogger) {
      this.logger = logger;
      this.syncBacnetLogger();
    }

    setFanSetpointChangedHandler(handler?: (event: FanSetpointChangedEvent) => void) {
      this.fanSetpointChangedHandler = handler;
    }

    setDehumidificationStateChangedHandler(
      handler?: (event: DehumidificationStateChangedEvent) => void,
    ) {
      this.dehumidificationStateChangedHandler = handler;
    }

    setHeatingCoilStateChangedHandler(handler?: (event: HeatingCoilStateChangedEvent) => void) {
      this.heatingCoilStateChangedHandler = handler;
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

    private logDetachedPromiseError(
      promise: Promise<unknown>,
      message: string | (() => string),
    ) {
      promise.catch((error) => {
        this.error(typeof message === 'function' ? message() : message, error);
      });
    }

    register(unitId: string, device: FlexitDevice) {
      let unit = this.units.get(unitId);
      if (!unit) {
        const ip = String(device.getSetting(BACNET_IP_SETTING) || '').trim();
        const bacnetPort = normalizeBacnetPort(device.getSetting(BACNET_PORT_SETTING)) ?? 47808;
        const serial = String(device.getSetting('serial') || '');

        unit = {
          unitId,
          serial,
          transport: 'bacnet' as const,
          devices: new Set(),
          pollInterval: null,
          rediscoverInterval: null,
          pollInFlight: false,
          pollRetryTimer: null,
          pollWatchdogTimer: null,
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
          currentFanSetpointMode: undefined,
          currentFanSetpoints: {},
          currentFanSetpointsInitialized: false,
          dehumidificationActive: undefined,
          dehumidificationStateInitialized: false,
          heatingCoilEnabled: undefined,
          heatingCoilStateInitialized: false,
        };
        this.units.set(unitId, unit);

        // Start polling immediately
        this.pollUnit(unitId);
        unit.pollInterval = setInterval(() => this.pollUnit(unitId), POLL_INTERVAL_MS);
      }
      unit.devices.add(device);
      if (!this.logger) this.syncBacnetLogger();
    }

    registerCloud(
      unitId: string,
      device: FlexitDevice,
      config: CloudTransportConfig,
    ): FlexitCloudClient {
      let unit = this.units.get(unitId);
      if (unit && unit.transport !== 'cloud') {
        throw new Error(
          `Unit ${unitId} is already registered with transport`
          + ` '${unit.transport}' — cannot register as cloud`,
        );
      }
      if (unit) {
        if (unit.cloud!.plantId !== config.plantId) {
          config.client.destroy();
          throw new Error(
            `Unit ${unitId} already registered with plantId`
            + ` '${unit.cloud!.plantId}' — cannot register with '${config.plantId}'`,
          );
        }
        config.client.destroy();
      } else {
        unit = {
          unitId,
          serial: '',
          transport: 'cloud' as const,
          cloud: config,
          devices: new Set(),
          pollInterval: null,
          rediscoverInterval: null,
          pollInFlight: false,
          pollRetryTimer: null,
          pollWatchdogTimer: null,
          ip: '',
          bacnetPort: 0,
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
          currentFanSetpointMode: undefined,
          currentFanSetpoints: {},
          currentFanSetpointsInitialized: false,
          dehumidificationActive: undefined,
          dehumidificationStateInitialized: false,
          heatingCoilEnabled: undefined,
          heatingCoilStateInitialized: false,
        };
        this.units.set(unitId, unit);

        this.startCloudPolling(unit);
      }
      unit.devices.add(device);
      return unit.cloud!.client;
    }

    hasCloudUnit(unitId: string): boolean {
      const unit = this.units.get(unitId);
      return !!unit && unit.transport === 'cloud' && !!unit.cloud;
    }

    restoreCloudAuth(unitId: string, token: import('./flexitCloudClient').CloudToken) {
      const unit = this.units.get(unitId);
      if (!unit || unit.transport !== 'cloud' || !unit.cloud) {
        throw new Error(`Unit ${unitId} is not a registered cloud unit`);
      }

      const mergedToken = { ...token };
      if (!mergedToken.refreshToken) {
        const existing = unit.cloud.client.getToken();
        if (existing?.refreshToken) {
          mergedToken.refreshToken = existing.refreshToken;
        }
      }
      unit.cloud.client.restoreToken(mergedToken);
      unit.available = true;
      unit.consecutiveFailures = 0;

      for (const device of unit.devices) {
        this.logDetachedPromiseError(
          device.setAvailable(),
          `[UnitRegistry] Failed to set device available for ${unitId}:`,
        );
      }

      if (!unit.pollInterval) {
        this.startCloudPolling(unit);
      }
    }

    private startCloudPolling(unit: UnitState) {
      const { unitId } = unit;
      this.cloudPollUnit(unit).catch((err) => {
        this.warn(`[UnitRegistry] Cloud poll failed for ${unitId}:`, err);
      });
      unit.pollInterval = setInterval(() => {
        this.cloudPollUnit(unit).catch((err) => {
          this.warn(`[UnitRegistry] Cloud poll failed for ${unitId}:`, err);
        });
      }, CLOUD_POLL_INTERVAL_MS);
    }

    unregister(unitId: string, device: FlexitDevice) {
      const unit = this.units.get(unitId);
      if (unit) {
        unit.devices.delete(device);
        if (unit.devices.size === 0) {
          if (unit.pollInterval) clearInterval(unit.pollInterval);
          if (unit.rediscoverInterval) clearInterval(unit.rediscoverInterval);
          this.clearUnitPollTimers(unit);
          if (unit.transport === 'cloud' && unit.cloud) {
            unit.cloud.client.destroy();
          }
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
        this.clearUnitPollTimers(unit);
        if (unit.transport === 'cloud' && unit.cloud) {
          unit.cloud.client.destroy();
        }
      }
      this.units.clear();
    }

    private clearUnitPollTimers(unit: UnitState) {
      if (unit.pollRetryTimer) {
        clearTimeout(unit.pollRetryTimer);
        unit.pollRetryTimer = null;
      }
      if (unit.pollWatchdogTimer) {
        clearTimeout(unit.pollWatchdogTimer);
        unit.pollWatchdogTimer = null;
      }
      unit.pollInFlight = false;
    }

    private isTrackedUnit(unit: UnitState) {
      return this.units.get(unit.unitId) === unit;
    }

    private enqueueWrite<T>(unit: UnitState, operation: () => Promise<T>): Promise<T> {
      const precedingWrite = unit.writeQueue.catch(() => undefined);
      const result = precedingWrite.then(() => operation());
      unit.writeQueue = result.then(() => undefined, () => undefined);
      return result;
    }

    private getWriteTimeoutMs() {
      return this.dependencies.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
    }

    async writeSetpoint(unitId: string, setpoint: number) {
      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');

      const mode = this.resolveTargetTemperatureModeFromProbe(unit);
      return this.writeTemperatureSetpoint(unit, mode, setpoint);
    }

    async setTemperatureSetpoint(unitId: string, mode: TargetTemperatureMode, setpoint: number) {
      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');
      return this.writeTemperatureSetpoint(unit, mode, setpoint);
    }

    private async writeTemperatureSetpoint(
      unit: UnitState,
      mode: TargetTemperatureMode,
      setpoint: number,
    ) {
      if (unit.transport === 'cloud') {
        return this.cloudWriteTemperatureSetpoint(unit, mode, setpoint);
      }
      const client = this.dependencies.getBacnetClient(unit.bacnetPort);
      const normalizedSetpoint = normalizeTargetTemperature(setpoint);
      const writeOptions = {
        maxSegments: BacnetEnums.MaxSegmentsAccepted.SEGMENTS_0,
        maxApdu: BacnetEnums.MaxApduLengthAccepted.OCTETS_1476,
        priority: DEFAULT_WRITE_PRIORITY,
      };
      const objectId = TARGET_TEMPERATURE_OBJECTS[mode];

      this.log(
        `[UnitRegistry] Writing ${mode} setpoint ${normalizedSetpoint} to`
        + ` ${unit.unitId} (${unit.ip})`,
      );

      return this.enqueueWrite(unit, async () => new Promise<void>((resolve, reject) => {
        let handled = false;
        const tm = setTimeout(() => {
          if (!handled) {
            handled = true;
            this.error(`[UnitRegistry] Timeout writing ${mode} setpoint to ${unit.unitId}`);
            reject(new Error('Timeout'));
          }
        }, this.getWriteTimeoutMs());

        try {
          client.writeProperty(
            unit.ip,
            objectId,
            PRESENT_VALUE_ID,
            [{ type: BacnetEnums.ApplicationTags.REAL, value: normalizedSetpoint }],
            writeOptions,
            (err: any, _value: any) => {
              if (handled) return;
              handled = true;
              clearTimeout(tm);

              if (err) {
                this.error(`[UnitRegistry] Failed to write ${mode} setpoint to ${unit.unitId}:`, err);
                reject(err);
                return;
              }
              this.log(
                `[UnitRegistry] Successfully wrote ${mode} setpoint`
                + ` ${normalizedSetpoint} to ${unit.unitId}`,
              );
              resolve();
            },
          );
        } catch (e) {
          if (!handled) {
            handled = true;
            clearTimeout(tm);
            this.error(`[UnitRegistry] Sync error writing ${mode} setpoint to ${unit.unitId}:`, e);
            reject(e);
          }
        }
      }));
    }

    private resolveTargetTemperatureModeFromProbe(unit: UnitState): TargetTemperatureMode {
      const data: Record<string, number> = {};
      for (const [probeKey, dataKey] of TARGET_TEMPERATURE_MODE_PROBE_KEY_MAP) {
        const value = unit.probeValues.get(probeKey);
        if (value !== undefined) data[dataKey] = value;
      }

      const mode = this.resolveFanModeFromSignals(data);
      return this.resolveCurrentTemperatureSetpointMode(data, mode) ?? 'home';
    }

    async resetFilterTimer(unitId: string) {
      this.log(`[UnitRegistry] Resetting filter timer for ${unitId}`);
      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');
      if (unit.transport === 'cloud') return this.cloudResetFilterTimer(unit);

      const writeOptions: WriteOptions = {
        maxSegments: BacnetEnums.MaxSegmentsAccepted.SEGMENTS_0,
        maxApdu: BacnetEnums.MaxApduLengthAccepted.OCTETS_1476,
        priority: DEFAULT_WRITE_PRIORITY,
      };

      return this.enqueueWrite(unit, async () => {
        const context: FanModeWriteContext = {
          unit,
          mode: 'filter_reset',
          writeOptions,
          client: this.dependencies.getBacnetClient(unit.bacnetPort),
          ventilationModeKey: VENTILATION_MODE_KEY,
          comfortButtonKey: COMFORT_BUTTON_KEY,
        };

        // Follow observed Flexit GO behavior first: AV:285 <- 0 with priority 16.
        const flexitGoCompatibleReset = await this.writeUpdate(context, {
          objectId: BACNET_OBJECTS.filterOperatingTime,
          tag: BacnetEnums.ApplicationTags.REAL,
          value: 0,
          priority: FLEXIT_GO_WRITE_PRIORITY,
        });
        if (flexitGoCompatibleReset) {
          this.log(`[UnitRegistry] Filter timer reset by writing 0 to AV:285 for ${unitId}`);
          this.pollUnit(unitId);
          return;
        }

        throw new Error('Failed to reset filter timer via AV:285');
      });
    }

    async setFilterChangeInterval(unitId: string, requestedHours: number) {
      this.log(`[UnitRegistry] Setting filter change interval to ${requestedHours}h for ${unitId}`);
      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');
      if (unit.transport === 'cloud') return this.cloudSetFilterChangeInterval(unit, requestedHours);

      const intervalHours = this.normalizeFilterChangeIntervalHours(requestedHours);
      const writeOptions: WriteOptions = {
        maxSegments: BacnetEnums.MaxSegmentsAccepted.SEGMENTS_0,
        maxApdu: BacnetEnums.MaxApduLengthAccepted.OCTETS_1476,
        priority: DEFAULT_WRITE_PRIORITY,
      };

      return this.enqueueWrite(unit, async () => {
        const context: FanModeWriteContext = {
          unit,
          mode: 'filter_interval',
          writeOptions,
          client: this.dependencies.getBacnetClient(unit.bacnetPort),
          ventilationModeKey: VENTILATION_MODE_KEY,
          comfortButtonKey: COMFORT_BUTTON_KEY,
        };

        const writeOk = await this.writeUpdate(context, {
          objectId: FILTER_LIMIT_OBJECT,
          tag: BacnetEnums.ApplicationTags.REAL,
          value: intervalHours,
          priority: FLEXIT_GO_WRITE_PRIORITY,
        });
        if (!writeOk) throw new Error('Failed to write filter change interval via AV:286');

        const verifiedValue = await this.readPresentValue(context.client, unit, FILTER_LIMIT_OBJECT);
        const verifiedHours = this.normalizeFilterChangeIntervalHours(verifiedValue);

        this.log(`[UnitRegistry] Verified filter change interval ${verifiedHours}h for ${unitId}`);
        const verifiedMonths = filterIntervalHoursToMonths(
          verifiedHours,
          (message) => this.warn(message),
        );
        for (const device of unit.devices) {
          this.updateDeviceSettings(device, {
            [FILTER_CHANGE_INTERVAL_MONTHS_SETTING]: verifiedMonths,
            [FILTER_CHANGE_INTERVAL_HOURS_LEGACY_SETTING]: verifiedHours,
          }).catch((err) => {
            this.warn(`[UnitRegistry] Failed to sync filter settings for ${unitId}:`, err);
          });
        }

        this.pollUnit(unitId);
      });
    }

    async setFireplaceVentilationDuration(unitId: string, requestedMinutes: number) {
      this.log(`[UnitRegistry] Setting fireplace duration to ${requestedMinutes} min for ${unitId}`);
      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');
      if (unit.transport === 'cloud') return this.cloudSetFireplaceVentilationDuration(unit, requestedMinutes);

      const durationMinutes = normalizeFireplaceDurationMinutes(requestedMinutes);
      const writeOptions: WriteOptions = {
        maxSegments: BacnetEnums.MaxSegmentsAccepted.SEGMENTS_0,
        maxApdu: BacnetEnums.MaxApduLengthAccepted.OCTETS_1476,
        priority: DEFAULT_WRITE_PRIORITY,
      };

      return this.enqueueWrite(unit, async () => {
        const context: FanModeWriteContext = {
          unit,
          mode: 'fireplace_duration',
          writeOptions,
          client: this.dependencies.getBacnetClient(unit.bacnetPort),
          ventilationModeKey: VENTILATION_MODE_KEY,
          comfortButtonKey: COMFORT_BUTTON_KEY,
        };

        const writeOk = await this.writeUpdate(context, {
          objectId: BACNET_OBJECTS.fireplaceVentilationRuntime,
          tag: BacnetEnums.ApplicationTags.UNSIGNED_INTEGER,
          value: durationMinutes,
          priority: DEFAULT_WRITE_PRIORITY,
        });
        if (!writeOk) throw new Error('Failed to write fireplace duration via PIV:270');

        const verifiedValue = await this.readPresentValue(
          context.client,
          unit,
          BACNET_OBJECTS.fireplaceVentilationRuntime,
        );
        const verifiedMinutes = normalizeFireplaceDurationMinutes(verifiedValue);

        this.log(`[UnitRegistry] Verified fireplace duration ${verifiedMinutes} minutes for ${unitId}`);
        for (const device of unit.devices) {
          this.updateDeviceSettings(device, {
            [FIREPLACE_DURATION_SETTING]: verifiedMinutes,
          }).catch((err) => {
            this.warn(`[UnitRegistry] Failed to sync fireplace duration setting for ${unitId}:`, err);
          });
        }

        this.pollUnit(unitId);
      });
    }

    async setFanProfileMode(
      unitId: string,
      mode: FanProfileMode,
      requestedSupplyPercent: number,
      requestedExhaustPercent: number,
    ) {
      if (!isFanProfileMode(mode)) throw new Error(`Unsupported fan profile mode '${mode}'`);
      this.log(
        `[UnitRegistry] Setting ${mode} fan profile`
        + ` supply=${requestedSupplyPercent}% exhaust=${requestedExhaustPercent}% for ${unitId}`,
      );

      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');
      if (unit.transport === 'cloud') {
        return this.cloudSetFanProfileMode(unit, mode, requestedSupplyPercent, requestedExhaustPercent);
      }

      const supplyPercent = normalizeFanProfilePercent(requestedSupplyPercent, mode, 'supply');
      const exhaustPercent = normalizeFanProfilePercent(requestedExhaustPercent, mode, 'exhaust');
      const writeOptions: WriteOptions = {
        maxSegments: BacnetEnums.MaxSegmentsAccepted.SEGMENTS_0,
        maxApdu: BacnetEnums.MaxApduLengthAccepted.OCTETS_1476,
        priority: DEFAULT_WRITE_PRIORITY,
      };

      return this.enqueueWrite(unit, async () => {
        const context: FanModeWriteContext = {
          unit,
          mode: `fan_profile:${mode}`,
          writeOptions,
          client: this.dependencies.getBacnetClient(unit.bacnetPort),
          ventilationModeKey: VENTILATION_MODE_KEY,
          comfortButtonKey: COMFORT_BUTTON_KEY,
        };
        const objects = FAN_PROFILE_OBJECTS[mode];

        const supplyWriteOk = await this.writeUpdate(context, {
          objectId: objects.supply,
          tag: BacnetEnums.ApplicationTags.REAL,
          value: supplyPercent,
          priority: FLEXIT_GO_WRITE_PRIORITY,
        });
        if (!supplyWriteOk) throw new Error(`Failed to write supply fan profile for ${mode}`);

        const exhaustWriteOk = await this.writeUpdate(context, {
          objectId: objects.exhaust,
          tag: BacnetEnums.ApplicationTags.REAL,
          value: exhaustPercent,
          priority: FLEXIT_GO_WRITE_PRIORITY,
        });
        if (!exhaustWriteOk) throw new Error(`Failed to write exhaust fan profile for ${mode}`);

        const verifiedValues = await this.readPresentValues(
          context.client,
          unit,
          [objects.supply, objects.exhaust],
        );
        const verifiedSupply = normalizeFanProfilePercent(
          verifiedValues.get(objectKey(objects.supply.type, objects.supply.instance)),
          mode,
          'supply',
        );
        const verifiedExhaust = normalizeFanProfilePercent(
          verifiedValues.get(objectKey(objects.exhaust.type, objects.exhaust.instance)),
          mode,
          'exhaust',
        );
        this.log(
          `[UnitRegistry] Verified ${mode} fan profile`
          + ` supply=${verifiedSupply}% exhaust=${verifiedExhaust}% for ${unitId}`,
        );

        const settingsForMode = FAN_PROFILE_SETTING_KEYS[mode];
        for (const device of unit.devices) {
          this.updateDeviceSettings(device, {
            [settingsForMode.supply]: verifiedSupply,
            [settingsForMode.exhaust]: verifiedExhaust,
          }).catch((err) => {
            this.warn(`[UnitRegistry] Failed to sync ${mode} fan settings for ${unitId}:`, err);
          });
        }

        this.pollUnit(unitId);
      });
    }

    private pollUnit(unitId: string) {
      const unit = this.units.get(unitId);
      if (!unit) return;
      if (unit.transport === 'cloud') {
        this.cloudPollUnit(unit).catch((err) => {
          this.warn(`[UnitRegistry] Cloud poll failed for ${unitId}:`, err);
        });
        return;
      }
      this.pollAttempt(unit, 0);
    }

    private pollAttempt(unit: UnitState, attempt: number) {
      if (!this.isTrackedUnit(unit)) return;
      if (unit.pollInFlight) return;

      const client = this.dependencies.getBacnetClient(unit.bacnetPort);
      unit.pollInFlight = true;
      let finalized = false;
      let handled = false;
      const finalize = () => {
        if (finalized) return;
        finalized = true;
        unit.pollInFlight = false;
        if (unit.pollWatchdogTimer) {
          clearTimeout(unit.pollWatchdogTimer);
          unit.pollWatchdogTimer = null;
        }
      };
      unit.pollWatchdogTimer = setTimeout(() => {
        if (handled) return;
        if (!this.isTrackedUnit(unit)) {
          handled = true;
          finalize();
          return;
        }
        handled = true;
        finalize();
        this.handlePollError(unit, attempt, {
          code: 'ERR_TIMEOUT',
          message: `Poll watchdog timeout after ${POLL_WATCHDOG_TIMEOUT_MS}ms`,
        });
      }, POLL_WATCHDOG_TIMEOUT_MS);
      try {
        client.readPropertyMultiple(unit.ip, POLL_REQUEST, (err: any, value: any) => {
          if (handled) return;
          if (!this.isTrackedUnit(unit)) {
            handled = true;
            finalize();
            return;
          }
          handled = true;
          finalize();
          if (err) {
            this.handlePollError(unit, attempt, err);
            return;
          }
          this.handlePollResponse(unit, attempt, value);
        });
      } catch (error) {
        if (handled) return;
        if (!this.isTrackedUnit(unit)) {
          handled = true;
          finalize();
          return;
        }
        handled = true;
        finalize();
        this.error(`[UnitRegistry] Synchronous internal error checking ${unit.unitId}:`, error);
        this.handlePollFailure(unit);
      }
    }

    private schedulePollRetry(unit: UnitState, message: string) {
      this.warn(message);
      if (unit.pollRetryTimer) {
        clearTimeout(unit.pollRetryTimer);
        unit.pollRetryTimer = null;
      }
      unit.pollRetryTimer = setTimeout(() => {
        unit.pollRetryTimer = null;
        if (!this.isTrackedUnit(unit)) return;
        this.pollAttempt(unit, 1);
      }, 1000);
    }

    private handlePollError(unit: UnitState, attempt: number, err: any) {
      if (!this.isTrackedUnit(unit)) return;
      const isTimeout = err?.code === 'ERR_TIMEOUT' || String(err?.message || '').includes('ERR_TIMEOUT');
      if (isTimeout && attempt === 0) {
        this.schedulePollRetry(unit, `[UnitRegistry] Poll timeout for ${unit.unitId}, retrying once...`);
        return;
      }
      this.error(`[UnitRegistry] Poll error for ${unit.unitId}:`, err);
      this.handlePollFailure(unit);
    }

    private handlePollResponse(unit: UnitState, attempt: number, value: any) {
      if (!value?.values) {
        this.error(`[UnitRegistry] Poll response missing values for ${unit.unitId}:`, value);
        if (attempt === 0) {
          this.schedulePollRetry(
            unit,
            `[UnitRegistry] Poll response missing values for ${unit.unitId}, retrying once...`,
          );
          return;
        }
        this.handlePollFailure(unit);
        return;
      }
      try {
        this.handlePollSuccess(unit);
        if (attempt > 0) {
          this.log(`[UnitRegistry] Poll retry succeeded for ${unit.unitId}`);
        }
        unit.lastPollAt = Date.now();
        const data = this.parsePollValues(unit, value.values, unit.lastPollAt);
        this.distributeData(unit, data);
      } catch (e) {
        this.error(`[UnitRegistry] Parse error for ${unit.unitId}:`, e);
      }
    }

    private parsePollValues(unit: UnitState, values: any[], pollTime: number): Record<string, number> {
      const target: PollParseTarget = { data: {} };
      for (const obj of values) {
        const objectId = obj?.objectId;
        if (!objectId) continue;

        const val = this.extractValue(obj);
        if (typeof val !== 'number' || Number.isNaN(val)) continue;

        const key = objectKey(objectId.type, objectId.instance);
        const mapper = POLL_VALUE_MAPPINGS[key];
        if (mapper) mapper(val, target);
        this.reconcileObservedWriteStatus(unit, key, val, pollTime);
        unit.probeValues.set(key, val);
      }

      const extractTemp = selectExtractTemperature(target.extractTempPrimary, target.extractTempAlt);
      if (extractTemp !== undefined) {
        target.data['measure_temperature.extract'] = extractTemp;
      }
      return target.data;
    }

    private reconcileObservedWriteStatus(unit: UnitState, key: string, value: number, pollTime: number) {
      const pending = unit.pendingWriteErrors.get(key);
      if (pending && pending.value !== null && valuesMatch(value, pending.value)) {
        this.warn(`[UnitRegistry] Write error cleared for ${key}: now ${value} (was code ${pending.code})`);
        unit.pendingWriteErrors.delete(key);
      }
      this.reconcileVentilationWriteContext(unit, key, value, pollTime);
    }

    private reconcileVentilationWriteContext(unit: UnitState, key: string, value: number, pollTime: number) {
      if (key !== VENTILATION_MODE_KEY || !unit.writeContext) return;
      const context = unit.writeContext.get(key);
      if (!context) return;

      if (context.value !== value && pollTime - context.at < 60000) {
        this.warn(
          `[UnitRegistry] Ventilation mode mismatch after write: expected ${context.value}`
          + ` for '${context.mode}', got ${value}`,
        );
        unit.writeContext.delete(key);
        return;
      }
      if (context.value === value) {
        unit.writeContext.delete(key);
      }
    }

    private handlePollFailure(unit: UnitState) {
      unit.consecutiveFailures++;
      if (unit.consecutiveFailures >= MAX_BACNET_CONSECUTIVE_FAILURES && unit.available) {
        unit.available = false;
        this.warn(
          `[UnitRegistry] Unit ${unit.unitId} marked unavailable after`
          + ` ${unit.consecutiveFailures} consecutive failures`,
        );
        for (const device of unit.devices) {
          this.logDetachedPromiseError(
            device.setUnavailable('Device unreachable — will auto-reconnect when found'),
            `[UnitRegistry] Failed to set device unavailable for ${unit.unitId}:`,
          );
        }
        this.startRediscovery(unit);
      }
    }

    private handlePollSuccess(unit: UnitState) {
      unit.consecutiveFailures = 0;
      if (!unit.available) {
        unit.available = true;
        const location = unit.transport === 'cloud' ? 'cloud' : unit.ip;
        this.log(
          `[UnitRegistry] Unit ${unit.unitId} is available again (${location})`,
        );
        for (const device of unit.devices) {
          this.logDetachedPromiseError(
            device.setAvailable(),
            `[UnitRegistry] Failed to set device available for ${unit.unitId}:`,
          );
        }
        if (unit.transport !== 'cloud') {
          this.stopRediscovery(unit);
        }
      }
    }

    private startRediscovery(unit: UnitState) {
      if (unit.rediscoverInterval) return; // already running
      this.log(
        `[UnitRegistry] Starting rediscovery for ${unit.unitId} (serial ${unit.serial})`,
      );

      const doRediscovery = async () => {
        const found = await this.dependencies.discoverFlexitUnits({
          timeoutMs: 5000,
          burstCount: 3,
          burstIntervalMs: 300,
        });
        const match = found.find((u) => u.serialNormalized === unit.unitId);
        if (!match) return;

        const rediscoveredIp = String(match.ip || '').trim();
        const rediscoveredPort = normalizeBacnetPort(match.bacnetPort);
        if (!rediscoveredIp || rediscoveredPort === undefined) {
          this.warn(
            `[UnitRegistry] Ignoring invalid rediscovered endpoint for ${unit.unitId}:`
            + ` ${rediscoveredIp || '<empty>'}:${String(match.bacnetPort)}`,
          );
          return;
        }

        const ipChanged = rediscoveredIp !== unit.ip;
        const portChanged = rediscoveredPort !== unit.bacnetPort;

        if (ipChanged || portChanged) {
          this.log(
            `[UnitRegistry] Rediscovered ${unit.unitId} at ${rediscoveredIp}:${rediscoveredPort}`
            + ` (was ${unit.ip}:${unit.bacnetPort})`,
          );
          unit.ip = rediscoveredIp;
          unit.bacnetPort = rediscoveredPort;
          await this.persistConnectionSettings(unit);
        } else {
          this.log(`[UnitRegistry] Rediscovered ${unit.unitId} at same address, retrying poll`);
        }

        // Trigger an immediate poll to verify connectivity
        this.pollUnit(unit.unitId);
      };

      // Run immediately, then on interval
      this.logDetachedPromiseError(
        doRediscovery(),
        `[UnitRegistry] Rediscovery error for ${unit.unitId}:`,
      );
      unit.rediscoverInterval = setInterval(() => {
        this.logDetachedPromiseError(
          doRediscovery(),
          `[UnitRegistry] Rediscovery error for ${unit.unitId}:`,
        );
      }, REDISCOVERY_INTERVAL_MS);
    }

    private stopRediscovery(unit: UnitState) {
      if (unit.rediscoverInterval) {
        clearInterval(unit.rediscoverInterval);
        unit.rediscoverInterval = null;
      }
    }

    private distributeData(unit: UnitState, data: Record<string, number>) {
      const dehumidificationActive = resolveDehumidificationActive(data);
      this.observeDehumidificationState(unit, dehumidificationActive);
      this.observeHeatingCoilState(unit, data.heating_coil_enabled);

      const mode = this.resolveFanMode(unit, data);
      const setpointMode = this.resolveCurrentFanSetpointMode(data, mode);
      const temperatureMode = this.resolveCurrentTemperatureSetpointMode(data, mode);

      for (const device of unit.devices) {
        this.applyMappedCapabilities(device, data);
        this.applyCurrentTargetTemperatureCapability(device, data, temperatureMode);
        this.applyCurrentFanSetpointCapabilities(unit, device, data, setpointMode);
        this.syncTargetTemperatureSettings(device, data);
        this.syncFanProfileSettings(device, data);
        this.syncFireplaceDurationSetting(device, data[FIREPLACE_DURATION_DATA_KEY]);
        this.syncFilterIntervalSetting(device, data.filter_limit);
        const filterLife = this.computeFilterLife(data);
        if (filterLife !== undefined) this.setCapability(device, 'measure_hepa_filter', filterLife);
        if (dehumidificationActive !== undefined) {
          this.setCapability(device, DEHUMIDIFICATION_ACTIVE_CAPABILITY, dehumidificationActive);
        }
        if (mode !== undefined) this.setCapability(device, 'fan_mode', mode);
      }
    }

    private resolveCurrentFanSetpointMode(
      data: Record<string, number>,
      resolvedMode: string | undefined,
    ): FanProfileMode | undefined {
      if (data.operation_mode !== undefined) {
        const operationMode = Math.round(data.operation_mode);
        if (operationMode === OPERATION_MODE_VALUES.COOKER_HOOD) return 'cooker';
      }

      if (resolvedMode && isFanProfileMode(resolvedMode)) {
        return resolvedMode;
      }

      if (data.operation_mode !== undefined) {
        const mapped = mapOperationMode(Math.round(data.operation_mode));
        if (isFanProfileMode(mapped)) return mapped;
      }

      if (data.ventilation_mode !== undefined) {
        return mapVentilationMode(Math.round(data.ventilation_mode));
      }

      return undefined;
    }

    private resolveCurrentTemperatureSetpointMode(
      data: Record<string, number>,
      resolvedMode: string | undefined,
    ): TargetTemperatureMode | undefined {
      if (resolvedMode) return resolvedMode === 'away' ? 'away' : 'home';

      if (data.operation_mode !== undefined) {
        const mapped = mapOperationMode(Math.round(data.operation_mode));
        return mapped === 'away' ? 'away' : 'home';
      }

      if (data.ventilation_mode !== undefined) {
        const mapped = mapVentilationMode(Math.round(data.ventilation_mode));
        return mapped === 'away' ? 'away' : 'home';
      }

      if (data.comfort_button !== undefined) {
        return data.comfort_button === 0 ? 'away' : 'home';
      }

      const homeValue = data[TARGET_TEMPERATURE_DATA_KEYS.home];
      if (homeValue !== undefined && Number.isFinite(homeValue)) return 'home';
      const awayValue = data[TARGET_TEMPERATURE_DATA_KEYS.away];
      if (awayValue !== undefined && Number.isFinite(awayValue)) return 'away';
      return undefined;
    }

    private applyCurrentTargetTemperatureCapability(
      device: FlexitDevice,
      data: Record<string, number>,
      mode: TargetTemperatureMode | undefined,
    ) {
      const selectedMode = mode ?? 'home';
      const selectedKey = TARGET_TEMPERATURE_DATA_KEYS[selectedMode];
      let nextValue = data[selectedKey];

      if (nextValue === undefined || !Number.isFinite(nextValue)) {
        const fallbackMode = selectedMode === 'away' ? 'home' : 'away';
        const fallbackValue = data[TARGET_TEMPERATURE_DATA_KEYS[fallbackMode]];
        if (fallbackValue !== undefined && Number.isFinite(fallbackValue)) {
          nextValue = fallbackValue;
        }
      }

      if (nextValue === undefined || !Number.isFinite(nextValue)) return;
      this.setCapability(device, 'target_temperature', normalizeTargetTemperature(nextValue));
    }

    private applyCurrentFanSetpointCapabilities(
      unit: UnitState,
      device: FlexitDevice,
      data: Record<string, number>,
      mode: FanProfileMode | undefined,
    ) {
      if (!mode) return;

      let observedAny = false;
      for (const fan of ['supply', 'exhaust'] as const) {
        const profileKey = FAN_PROFILE_DATA_KEYS[mode][fan];
        const profileValue = data[profileKey];
        if (profileValue === undefined || !Number.isFinite(profileValue)) continue;

        let normalized: number;
        try {
          normalized = normalizeFanProfilePercent(profileValue, mode, fan);
        } catch (error) {
          this.warn(`[UnitRegistry] Invalid current fan setpoint ${mode}.${fan}:`, error);
          continue;
        }

        observedAny = true;
        const capability = CURRENT_FAN_SETPOINT_CAPABILITIES[fan];
        this.setCapability(device, capability, normalized);

        const previous = unit.currentFanSetpoints[fan];
        const changed = previous === undefined
          || !valuesMatch(previous, normalized)
          || unit.currentFanSetpointMode !== mode;
        if (unit.currentFanSetpointsInitialized && changed) {
          this.triggerFanSetpointChanged({
            device,
            fan,
            mode,
            setpointPercent: normalized,
          });
        }
        unit.currentFanSetpoints[fan] = normalized;
      }

      if (observedAny) {
        unit.currentFanSetpointMode = mode;
        unit.currentFanSetpointsInitialized = true;
      }
    }

    private triggerFanSetpointChanged(event: FanSetpointChangedEvent) {
      if (!this.fanSetpointChangedHandler) return;
      try {
        this.fanSetpointChangedHandler(event);
      } catch (error) {
        this.warn('[UnitRegistry] Failed to handle fan setpoint changed callback:', error);
      }
    }

    private observeDehumidificationState(
      unit: UnitState,
      active: boolean | undefined,
    ) {
      if (active === undefined) return;

      if (!unit.dehumidificationStateInitialized) {
        unit.dehumidificationActive = active;
        unit.dehumidificationStateInitialized = true;
        return;
      }
      if (unit.dehumidificationActive === active) return;

      unit.dehumidificationActive = active;
      for (const device of unit.devices) {
        this.triggerDehumidificationStateChanged({
          device,
          active,
        });
      }
    }

    private triggerDehumidificationStateChanged(event: DehumidificationStateChangedEvent) {
      if (!this.dehumidificationStateChangedHandler) return;
      try {
        this.dehumidificationStateChangedHandler(event);
      } catch (error) {
        this.warn('[UnitRegistry] Failed to handle dehumidification state changed callback:', error);
      }
    }

    private parseHeatingCoilEnabled(value: number): boolean {
      return Math.round(value) !== HEATING_COIL_OFF;
    }

    private observeHeatingCoilState(unit: UnitState, rawValue: number | undefined) {
      if (rawValue === undefined || !Number.isFinite(rawValue)) return;

      const enabled = this.parseHeatingCoilEnabled(rawValue);
      if (!unit.heatingCoilStateInitialized) {
        unit.heatingCoilEnabled = enabled;
        unit.heatingCoilStateInitialized = true;
        return;
      }
      if (unit.heatingCoilEnabled === enabled) return;

      unit.heatingCoilEnabled = enabled;
      for (const device of unit.devices) {
        this.triggerHeatingCoilStateChanged({
          device,
          enabled,
        });
      }
    }

    private triggerHeatingCoilStateChanged(event: HeatingCoilStateChangedEvent) {
      if (!this.heatingCoilStateChangedHandler) return;
      try {
        this.heatingCoilStateChangedHandler(event);
      } catch (error) {
        this.warn('[UnitRegistry] Failed to handle heating coil state changed callback:', error);
      }
    }

    private computeFilterLife(data: Record<string, number>) {
      const filterTime = data.filter_time;
      const filterLimit = data.filter_limit;
      if (filterTime === undefined || filterLimit === undefined || filterLimit <= 0) return undefined;

      const filterLife = Math.max(0, (1 - (filterTime / filterLimit)) * 100);
      return parseFloat(filterLife.toFixed(1));
    }

    private normalizeFilterChangeIntervalHours(value: unknown): number {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        throw new Error('Filter change interval must be numeric');
      }

      const rounded = Math.round(numeric);
      if (
        rounded < MIN_FILTER_CHANGE_INTERVAL_HOURS
        || rounded > MAX_FILTER_CHANGE_INTERVAL_HOURS
      ) {
        throw new Error(
          `Filter change interval must be between ${MIN_FILTER_CHANGE_INTERVAL_HOURS}`
          + ` and ${MAX_FILTER_CHANGE_INTERVAL_HOURS} hours`,
        );
      }
      return rounded;
    }

    private updateDeviceSettings(device: FlexitDevice, settings: Record<string, any>) {
      if (typeof device.applyRegistrySettings === 'function') {
        return device.applyRegistrySettings(settings);
      }
      if (typeof device.setSettings === 'function') return device.setSettings(settings);
      if (typeof device.setSetting === 'function') return device.setSetting(settings);
      return Promise.resolve();
    }

    private async persistConnectionSettings(unit: UnitState) {
      const normalizedIp = String(unit.ip || '').trim();
      const normalizedPort = normalizeBacnetPort(unit.bacnetPort);
      if (!normalizedIp || normalizedPort === undefined) {
        this.warn(
          `[UnitRegistry] Skipping connection settings sync for ${unit.unitId};`
          + ` invalid endpoint ${normalizedIp || '<empty>'}:${String(unit.bacnetPort)}`,
        );
        return;
      }

      const pendingUpdates: Array<Promise<void>> = [];
      for (const device of unit.devices) {
        const currentIp = String(device.getSetting(BACNET_IP_SETTING) || '').trim();
        const currentPort = normalizeBacnetPort(device.getSetting(BACNET_PORT_SETTING));
        if (currentIp === normalizedIp && currentPort === normalizedPort) continue;

        pendingUpdates.push(this.updateDeviceSettings(device, {
          [BACNET_IP_SETTING]: normalizedIp,
          [BACNET_PORT_SETTING]: String(normalizedPort),
        }).catch((err) => {
          this.warn(
            `[UnitRegistry] Failed to sync connection settings for ${device.getData().unitId}:`,
            err,
          );
        }));
      }

      await Promise.allSettled(pendingUpdates);
    }

    private syncTargetTemperatureSettings(device: FlexitDevice, data: Record<string, number>) {
      const updates: Record<string, number> = {};
      for (const mode of ['home', 'away'] as const) {
        const dataKey = TARGET_TEMPERATURE_DATA_KEYS[mode];
        const setpoint = data[dataKey];
        if (setpoint === undefined || !Number.isFinite(setpoint)) continue;

        const settingKey = TARGET_TEMPERATURE_SETTING_KEYS[mode];
        const normalizedSetpoint = normalizeTargetTemperature(setpoint);
        const currentSettingValue = Number(device.getSetting(settingKey));
        if (!Number.isFinite(currentSettingValue) || !valuesMatch(currentSettingValue, normalizedSetpoint)) {
          updates[settingKey] = normalizedSetpoint;
        }
      }

      if (Object.keys(updates).length === 0) return;

      this.updateDeviceSettings(device, updates).catch((err) => {
        this.warn(`[UnitRegistry] Failed to sync target temperature settings for ${device.getData().unitId}:`, err);
      });
    }

    private syncFanProfileSettings(device: FlexitDevice, data: Record<string, number>) {
      const updates: Record<string, number> = {};

      for (const mode of FAN_PROFILE_MODES) {
        for (const fan of ['supply', 'exhaust'] as const) {
          const dataKey = FAN_PROFILE_DATA_KEYS[mode][fan];
          const nextValue = data[dataKey];
          if (nextValue === undefined || !Number.isFinite(nextValue)) continue;

          const normalized = Math.round(nextValue);
          const range = fanProfilePercentRange(mode, fan);
          if (normalized < range.min || normalized > range.max) {
            this.warn(
              `[UnitRegistry] Ignoring out-of-range ${mode} ${fan} fan profile value`
              + ` ${nextValue} from ${device.getData().unitId}`,
            );
            continue;
          }
          const settingKey = FAN_PROFILE_SETTING_KEYS[mode][fan];
          const current = Number(device.getSetting(settingKey));
          const inSync = Number.isFinite(current) && Math.abs(current - normalized) < 0.5;
          if (!inSync) {
            updates[settingKey] = normalized;
          }
        }
      }

      if (Object.keys(updates).length === 0) return;

      this.updateDeviceSettings(device, updates).catch((err) => {
        this.warn(`[UnitRegistry] Failed to sync fan profile settings for ${device.getData().unitId}:`, err);
      });
    }

    private syncFireplaceDurationSetting(device: FlexitDevice, runtimeValue: number | undefined) {
      if (runtimeValue === undefined || !Number.isFinite(runtimeValue)) return;

      let normalizedRuntime: number;
      try {
        normalizedRuntime = normalizeFireplaceDurationMinutes(runtimeValue);
      } catch (error) {
        this.warn(
          `[UnitRegistry] Ignoring out-of-range fireplace duration ${runtimeValue}`
          + ` from ${device.getData().unitId}:`,
          error,
        );
        return;
      }
      const currentSettingValue = Number(device.getSetting(FIREPLACE_DURATION_SETTING));
      if (Number.isFinite(currentSettingValue) && Math.abs(currentSettingValue - normalizedRuntime) < 0.5) {
        return;
      }

      this.updateDeviceSettings(device, {
        [FIREPLACE_DURATION_SETTING]: normalizedRuntime,
      }).catch((err) => {
        this.warn(`[UnitRegistry] Failed to sync fireplace duration setting for ${device.getData().unitId}:`, err);
      });
    }

    private syncFilterIntervalSetting(device: FlexitDevice, filterLimit: number | undefined) {
      if (filterLimit === undefined || !Number.isFinite(filterLimit) || filterLimit <= 0) return;

      const normalizedHours = Math.round(filterLimit);
      const normalizedMonths = filterIntervalHoursToMonths(
        normalizedHours,
        (message) => this.warn(message),
      );
      const currentMonths = Number(device.getSetting(FILTER_CHANGE_INTERVAL_MONTHS_SETTING));
      const currentHours = Number(device.getSetting(FILTER_CHANGE_INTERVAL_HOURS_LEGACY_SETTING));
      const monthsInSync = Number.isFinite(currentMonths) && Math.abs(currentMonths - normalizedMonths) < 0.5;
      const hoursInSync = Number.isFinite(currentHours) && Math.abs(currentHours - normalizedHours) < 0.5;
      if (monthsInSync && (!Number.isFinite(currentHours) || hoursInSync)) return;

      this.updateDeviceSettings(device, {
        [FILTER_CHANGE_INTERVAL_MONTHS_SETTING]: normalizedMonths,
        [FILTER_CHANGE_INTERVAL_HOURS_LEGACY_SETTING]: normalizedHours,
      }).catch((err) => {
        this.warn(`[UnitRegistry] Failed to sync filter interval settings for ${device.getData().unitId}:`, err);
      });
    }

    private resolveFanMode(unit: UnitState, data: Record<string, number>): string | undefined {
      if (!MODE_SIGNAL_KEYS.some((key) => data[key] !== undefined)) return undefined;

      const tempOpActive = (data.remaining_temp_vent_op ?? 0) > 0;
      if (unit.deferredMode === 'fireplace' && !tempOpActive && data.rapid_active !== 1) {
        unit.deferredMode = undefined;
        unit.deferredSince = undefined;
        this.warn(`[UnitRegistry] Retrying deferred fireplace for ${unit.unitId}`);
        this.logDetachedPromiseError(
          this.setFanMode(unit.unitId, 'fireplace'),
          `[UnitRegistry] Deferred fireplace retry failed for ${unit.unitId}:`,
        );
      }

      const mode = this.resolveFanModeFromSignals(data, tempOpActive);
      if (!mode) return undefined;

      this.logModeMismatch(unit, mode, data);
      return mode;
    }

    private resolveFanModeFromSignals(
      data: Record<string, number>,
      tempOpActive: boolean = (data.remaining_temp_vent_op ?? 0) > 0,
    ): 'home' | 'away' | 'high' | 'fireplace' | 'cooker' | undefined {
      if (!MODE_SIGNAL_KEYS.some((key) => data[key] !== undefined)) return undefined;

      const operationMode = Math.round(data.operation_mode ?? NaN);
      const operationModeMapped = data.operation_mode !== undefined
        ? mapOperationMode(operationMode)
        : undefined;
      const rfMode = MODE_RF_INPUT_MAP[Math.round(data.mode_rf_input ?? NaN)];
      if (
        data.fireplace_active === 1
        || operationModeMapped === 'fireplace'
        || rfMode === 'fireplace'
      ) {
        return 'fireplace';
      }

      let mode = this.resolveBaseMode(data, tempOpActive);
      if (data.rapid_active === 1) mode = 'high';
      return mode;
    }

    private resolveBaseMode(
      data: Record<string, number>,
      tempOpActive: boolean,
    ): 'home' | 'away' | 'high' | 'fireplace' | 'cooker' {
      const rfMode = MODE_RF_INPUT_MAP[Math.round(data.mode_rf_input ?? NaN)];
      const operationMode = Math.round(data.operation_mode ?? NaN);
      const ventilationMode = Math.round(data.ventilation_mode ?? NaN);
      const operationModeMapped = data.operation_mode !== undefined ? mapOperationMode(operationMode) : undefined;
      const ventilationModeMapped = data.ventilation_mode !== undefined
        ? mapVentilationMode(ventilationMode)
        : undefined;

      if (
        operationModeMapped === 'fireplace'
        || operationModeMapped === 'cooker'
        || operationModeMapped === 'high'
      ) {
        return operationModeMapped;
      }
      if (ventilationModeMapped === 'high') return 'high';
      if (rfMode === 'high' || rfMode === 'fireplace') return rfMode;

      // Real units can briefly keep operation_mode at HOME after BV:50 has already switched to AWAY.
      if (data.comfort_button === 0) return 'away';

      if (operationModeMapped) return operationModeMapped;
      if (ventilationModeMapped) return ventilationModeMapped;
      if (rfMode) return rfMode;
      if (tempOpActive) {
        if ((data.remaining_fireplace_vent ?? 0) > 0) return 'fireplace';
        if ((data.remaining_rapid_vent ?? 0) > 0) return 'high';
        if (data.comfort_button === 1) return 'home';
        return 'away';
      }
      return data.comfort_button === 1 ? 'home' : 'away';
    }

    private logModeMismatch(unit: UnitState, mode: string, data: Record<string, number>) {
      const { expectedMode, expectedModeAt } = unit;
      if (!expectedMode) return;

      if (expectedMode === mode) {
        unit.lastMismatchKey = undefined;
        return;
      }

      if (expectedModeAt !== undefined && (Date.now() - expectedModeAt) < MODE_MISMATCH_GRACE_MS) {
        return;
      }

      const comfortOff = data.comfort_button === 0;
      const awayDelayActive = data.away_delay_active === 1;
      if (expectedMode === 'away' && comfortOff && awayDelayActive) {
        const mismatchKey = `${expectedMode}->pending`;
        if (unit.lastMismatchKey === mismatchKey) return;
        unit.lastMismatchKey = mismatchKey;
        const delay = data.comfort_delay ?? 'unknown';
        this.warn(`[UnitRegistry] Away pending for ${unit.unitId}: delay active (configured ${delay} min)`);
        return;
      }

      const mismatchKey = `${expectedMode}->${mode}`;
      if (unit.lastMismatchKey === mismatchKey) return;
      unit.lastMismatchKey = mismatchKey;
      this.warn(
        `[UnitRegistry] Mode mismatch for ${unit.unitId}: expected '${expectedMode}' got '${mode}'`
        + ` (comfort=${formatModeSignalValue(data.comfort_button)}`
        + ` vent=${formatModeSignalValue(data.ventilation_mode)}`
        + ` op=${formatModeSignalValue(data.operation_mode)}`
        + ` rapid=${formatModeSignalValue(data.rapid_active)}`
        + ` fireplace=${formatModeSignalValue(data.fireplace_active)}`
        + ` tempRem=${formatModeSignalValue(data.remaining_temp_vent_op)}`
        + ` rapidRem=${formatModeSignalValue(data.remaining_rapid_vent)}`
        + ` fireplaceRem=${formatModeSignalValue(data.remaining_fireplace_vent)}`
        + ` rf=${formatModeSignalValue(data.mode_rf_input)})`,
      );
    }

    private hasPendingWriteValue(unit: UnitState, key: string, value: number) {
      const lastWrite = unit.lastWriteValues.get(key);
      const lastPollAt = unit.lastPollAt ?? 0;
      return Boolean(lastWrite && lastWrite.value === value && lastWrite.at > lastPollAt);
    }

    private applyMappedCapabilities(device: FlexitDevice, data: Record<string, number>) {
      for (const { dataKey, capability } of CAPABILITY_MAPPINGS) {
        const value = data[dataKey];
        if (value !== undefined) {
          this.setCapability(device, capability, value);
        }
      }
    }

    private setCapability(device: FlexitDevice, capability: string, value: number | string | boolean) {
      this.logDetachedPromiseError(
        device.setCapabilityValue(capability, value),
        () => `[UnitRegistry] Failed to set capability '${capability}' for ${device.getData().unitId}:`,
      );
    }

    async getDehumidificationActive(unitId: string): Promise<boolean> {
      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');

      // Bootstrap from BACnet if a flow condition is evaluated before the first poll has
      // populated the controller-driven dehumidification state.
      if (unit.dehumidificationStateInitialized && typeof unit.dehumidificationActive === 'boolean') {
        return unit.dehumidificationActive;
      }

      const client = this.dependencies.getBacnetClient(unit.bacnetPort);
      const readResults = await Promise.allSettled([
        this.readPresentValue(client, unit, BACNET_OBJECTS.dehumidificationFanControl),
        this.readPresentValue(client, unit, BACNET_OBJECTS.dehumidificationSlopeRequest),
      ]);

      const mergedData: Record<string, number> = {};
      const cachedSignals = [
        {
          probeKey: DEHUMIDIFICATION_FAN_CONTROL_KEY,
          dataKey: 'dehumidification_fan_control',
        },
        {
          probeKey: DEHUMIDIFICATION_SLOPE_REQUEST_KEY,
          dataKey: 'dehumidification_request_by_slope',
        },
      ] as const;

      for (const { probeKey, dataKey } of cachedSignals) {
        const cachedValue = unit.probeValues.get(probeKey);
        if (typeof cachedValue === 'number' && Number.isFinite(cachedValue)) {
          mergedData[dataKey] = cachedValue;
        }
      }

      const [fanControlResult, slopeRequestResult] = readResults;
      if (fanControlResult.status === 'fulfilled') {
        mergedData.dehumidification_fan_control = fanControlResult.value;
        unit.probeValues.set(DEHUMIDIFICATION_FAN_CONTROL_KEY, fanControlResult.value);
      }
      if (slopeRequestResult.status === 'fulfilled') {
        mergedData.dehumidification_request_by_slope = slopeRequestResult.value;
        unit.probeValues.set(DEHUMIDIFICATION_SLOPE_REQUEST_KEY, slopeRequestResult.value);
      }

      const active = resolveDehumidificationActive(mergedData);
      if (active === undefined) {
        const firstReadError = readResults.find((result) => result.status === 'rejected');
        if (firstReadError?.status === 'rejected') {
          this.warn(
            `[UnitRegistry] Failed to bootstrap dehumidification state for ${unitId}:`,
            firstReadError.reason,
          );
        }
        throw new Error('Dehumidification state unavailable');
      }

      unit.dehumidificationActive = active;
      unit.dehumidificationStateInitialized = true;
      return active;
    }

    async getHeatingCoilEnabled(unitId: string): Promise<boolean> {
      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');

      const client = this.dependencies.getBacnetClient(unit.bacnetPort);
      try {
        const value = await this.readPresentValue(client, unit, BACNET_OBJECTS.heatingCoilEnable);
        const enabled = this.parseHeatingCoilEnabled(value);
        unit.probeValues.set(HEATING_COIL_ENABLE_KEY, value);
        unit.heatingCoilEnabled = enabled;
        unit.heatingCoilStateInitialized = true;
        return enabled;
      } catch (error) {
        if (unit.heatingCoilStateInitialized && typeof unit.heatingCoilEnabled === 'boolean') {
          this.warn(
            `[UnitRegistry] Falling back to cached heating coil state for ${unitId} after read error:`,
            error,
          );
          return unit.heatingCoilEnabled;
        }

        const cachedValue = unit.probeValues.get(HEATING_COIL_ENABLE_KEY);
        if (typeof cachedValue === 'number' && Number.isFinite(cachedValue)) {
          const enabled = this.parseHeatingCoilEnabled(cachedValue);
          unit.heatingCoilEnabled = enabled;
          unit.heatingCoilStateInitialized = true;
          return enabled;
        }
        throw error;
      }
    }

    async toggleHeatingCoilEnabled(unitId: string): Promise<boolean> {
      const currentlyEnabled = await this.getHeatingCoilEnabled(unitId);
      const nextState = !currentlyEnabled;
      await this.setHeatingCoilEnabled(unitId, nextState);
      return nextState;
    }

    async setHeatingCoilEnabled(unitId: string, enabled: boolean) {
      const state = enabled ? 'on' : 'off';
      this.log(`[UnitRegistry] Setting heating coil ${state} for ${unitId}`);
      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');
      if (unit.transport === 'cloud') return this.cloudSetHeatingCoilEnabled(unit, enabled);
      const writeOptions: WriteOptions = {
        maxSegments: BacnetEnums.MaxSegmentsAccepted.SEGMENTS_0,
        maxApdu: BacnetEnums.MaxApduLengthAccepted.OCTETS_1476,
        priority: DEFAULT_WRITE_PRIORITY,
      };

      return this.enqueueWrite(unit, async () => {
        const context: FanModeWriteContext = {
          unit,
          mode: `heating_coil:${state}`,
          writeOptions,
          client: this.dependencies.getBacnetClient(unit.bacnetPort),
          ventilationModeKey: VENTILATION_MODE_KEY,
          comfortButtonKey: COMFORT_BUTTON_KEY,
        };

        const writeOk = await this.writeUpdate(context, {
          objectId: BACNET_OBJECTS.heatingCoilEnable,
          tag: BacnetEnums.ApplicationTags.ENUMERATED,
          value: enabled ? HEATING_COIL_ON : HEATING_COIL_OFF,
          priority: DEFAULT_WRITE_PRIORITY,
        });
        if (!writeOk) throw new Error(`Failed to set heating coil ${state}`);

        this.pollUnit(unitId);
      });
    }

    async setFanMode(unitId: string, mode: string) {
      this.log(`[UnitRegistry] Setting fan mode to '${mode}' for ${unitId}`);
      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');
      if (unit.transport === 'cloud') return this.cloudSetFanMode(unit, mode);
      const writeOptions: WriteOptions = {
        maxSegments: BacnetEnums.MaxSegmentsAccepted.SEGMENTS_0,
        maxApdu: BacnetEnums.MaxApduLengthAccepted.OCTETS_1476,
        priority: DEFAULT_WRITE_PRIORITY,
      };

      return this.enqueueWrite(unit, () => this.applyFanMode(unit, mode, writeOptions));
    }

    private async applyFanMode(unit: UnitState, mode: string, writeOptions: WriteOptions) {
      for (const key of NEVER_BLOCK_KEYS) {
        unit.blockedWrites.delete(key);
      }

      const context: FanModeWriteContext = {
        unit,
        mode,
        writeOptions,
        client: this.dependencies.getBacnetClient(unit.bacnetPort),
        ventilationModeKey: VENTILATION_MODE_KEY,
        comfortButtonKey: COMFORT_BUTTON_KEY,
      };

      const operationMode = Math.round(unit.probeValues.get(OPERATION_MODE_KEY) ?? NaN);
      const rapidActive = (unit.probeValues.get(RAPID_ACTIVE_KEY) ?? 0) === 1;
      const temporaryRapidActive = rapidActive || operationMode === OPERATION_MODE_VALUES.TEMPORARY_HIGH;
      const fireplaceActive = (unit.probeValues.get(FIREPLACE_ACTIVE_KEY) ?? 0) === 1;
      const fireplaceModeReported = operationMode === OPERATION_MODE_VALUES.FIREPLACE;
      const fireplaceAlreadyActive = fireplaceActive || fireplaceModeReported;
      const cookerModeReported = operationMode === OPERATION_MODE_VALUES.COOKER_HOOD;
      const cookerRequested = this.hasPendingWriteValue(unit, COOKER_HOOD_KEY, 1);
      const cookerAlreadyActive = cookerModeReported || cookerRequested;
      const fireplaceRuntime = clamp(
        Math.round(unit.probeValues.get(FIREPLACE_RUNTIME_KEY) ?? DEFAULT_FIREPLACE_VENTILATION_MINUTES),
        1,
        360,
      );

      if (mode !== 'fireplace') {
        unit.deferredMode = undefined;
        unit.deferredSince = undefined;
      }
      if (mode === 'fireplace' && fireplaceAlreadyActive) {
        this.log(`[UnitRegistry] Fireplace already active for ${unit.unitId}, skipping trigger.`);
        return;
      }

      unit.expectedMode = mode;
      unit.expectedModeAt = Date.now();
      unit.lastMismatchKey = undefined;

      if (mode !== 'fireplace' && fireplaceAlreadyActive) {
        await this.writeFireplaceTrigger(context, TRIGGER_VALUE);
      }
      if (mode !== 'fireplace' && mode !== 'high' && temporaryRapidActive) {
        await this.writeRapidTrigger(context, TRIGGER_VALUE);
      }
      if (mode !== 'cooker' && cookerAlreadyActive) {
        await this.relinquishCookerHood(context);
      }

      switch (mode) {
        case 'home':
          await this.applyHomeMode(context);
          return;
        case 'away':
          await this.applyAwayMode(context);
          return;
        case 'high':
          await this.applyHighMode(context);
          return;
        case 'cooker':
          await this.applyCookerMode(context, cookerAlreadyActive);
          return;
        case 'fireplace':
          await this.applyFireplaceMode(context, fireplaceRuntime, temporaryRapidActive);
          return;
        default:
          this.warn(`[UnitRegistry] Unsupported fan mode '${mode}' for ${unit.unitId}`);
      }
    }

    private shouldSkipWrite(unit: UnitState, key: string, current: number | undefined, desired: number) {
      if (current === undefined || !valuesMatch(current, desired)) return false;
      const lastWrite = unit.lastWriteValues.get(key);
      const lastPollAt = unit.lastPollAt ?? 0;
      if (!lastWrite) return true;
      if (lastWrite.at <= lastPollAt) return true;
      if (lastWrite.value === desired) return true;
      return false;
    }

    private buildWriteOptions(
      context: FanModeWriteContext,
      update: WriteUpdate,
    ): { maxSegments: number; maxApdu: number; priority?: number } {
      const options: { maxSegments: number; maxApdu: number; priority?: number } = {
        maxSegments: context.writeOptions.maxSegments,
        maxApdu: context.writeOptions.maxApdu,
      };
      if (update.priority !== null) {
        options.priority = update.priority ?? DEFAULT_WRITE_PRIORITY;
      }
      return options;
    }

    private handleWriteUpdateResult(
      unit: UnitState,
      writeKey: string,
      update: WriteUpdate,
      err: any,
    ): boolean {
      const now = Date.now();
      if (!err) {
        unit.lastWriteValues.set(writeKey, { value: update.value, at: now });
        this.log(
          '[UnitRegistry] Successfully wrote'
          + ` ${update.objectId.type}:${update.objectId.instance}`
          + ` to ${formatWriteValue(update.value)}`,
        );
        return true;
      }

      const message = String(err?.message || err);
      const errMatch = message.match(/Code:(\d+)/);
      const code = errMatch ? Number(errMatch[1]) : undefined;
      if (code === 37) {
        unit.lastWriteValues.set(writeKey, { value: update.value, at: now });
        if (update.value !== null) {
          unit.pendingWriteErrors.set(writeKey, { value: update.value, code });
        }
        this.warn(
          `[UnitRegistry] Write returned Code:37 for ${writeKey};`
          + ' will verify on next poll.',
        );
        return true;
      }

      const unsupportedObject = code === 31
        || /(?:\bCode:31\b|\b1:31\b)/.test(message);
      if (unsupportedObject) {
        unit.lastWriteValues.set(writeKey, { value: update.value, at: now });
        if (NEVER_BLOCK_KEYS.has(writeKey)) {
          this.warn(
            `[UnitRegistry] Write unsupported for ${writeKey},`
            + ' but will keep retrying.',
          );
        } else {
          unit.blockedWrites.add(writeKey);
          this.warn(
            `[UnitRegistry] Disabling writes for ${writeKey}`
            + ' (unsupported object on unit).',
          );
        }
        return false;
      }

      if (message.includes('Code:40') || message.includes('Code:9')) {
        unit.lastWriteValues.set(writeKey, { value: update.value, at: now });
        if (NEVER_BLOCK_KEYS.has(writeKey)) {
          this.warn(
            `[UnitRegistry] Write denied for ${writeKey},`
            + ' but will keep retrying.',
          );
        } else {
          unit.blockedWrites.add(writeKey);
          this.warn(
            `[UnitRegistry] Disabling writes for ${writeKey}`
            + ' due to device error.',
          );
        }
      } else {
        this.error(
          '[UnitRegistry] Failed to write'
          + ` ${update.objectId.type}:${update.objectId.instance}`
          + ` to ${formatWriteValue(update.value)}`,
          err,
        );
      }
      return false;
    }

    private async writeUpdate(context: FanModeWriteContext, update: WriteUpdate) {
      const { unit } = context;
      const writeKey = objectKey(update.objectId.type, update.objectId.instance);
      if (unit.blockedWrites.has(writeKey)) {
        this.warn(`[UnitRegistry] Skipping write ${writeKey} (write access denied previously)`);
        return false;
      }

      return new Promise<boolean>((resolve) => {
        let handled = false;
        const tm = setTimeout(() => {
          if (!handled) {
            handled = true;
            this.error(`[UnitRegistry] Timeout writing ${update.objectId.type}:${update.objectId.instance}`);
            resolve(false);
          }
        }, this.getWriteTimeoutMs());

        try {
          this.log(
            `[UnitRegistry] Writing ${update.objectId.type}:${update.objectId.instance}`
            + ` = ${formatWriteValue(update.value)}`,
          );
          const options = this.buildWriteOptions(context, update);
          const values = update.value === null
            ? [{ type: BacnetEnums.ApplicationTags.NULL, value: null }]
            : [{ type: update.tag, value: update.value }];

          context.client.writeProperty(
            unit.ip,
            update.objectId,
            PRESENT_VALUE_ID,
            values,
            options,
            (err: any) => {
              if (handled) return;
              handled = true;
              clearTimeout(tm);
              resolve(this.handleWriteUpdateResult(unit, writeKey, update, err));
            },
          );
        } catch (e) {
          if (!handled) {
            handled = true;
            clearTimeout(tm);
            this.error(
              `[UnitRegistry] Sync error writing ${update.objectId.type}:${update.objectId.instance}:`,
              e,
            );
            resolve(false);
          }
        }
      });
    }

    private async writeComfort(context: FanModeWriteContext, value: number, opts?: { force?: boolean }) {
      const current = context.unit.probeValues.get(context.comfortButtonKey);
      if (!opts?.force && this.shouldSkipWrite(context.unit, context.comfortButtonKey, current, value)) {
        this.log(`[UnitRegistry] Comfort button already ${value}, skipping write.`);
        return true;
      }
      return this.writeUpdate(context, {
        objectId: BACNET_OBJECTS.comfortButton,
        tag: BacnetEnums.ApplicationTags.ENUMERATED,
        value,
        priority: DEFAULT_WRITE_PRIORITY,
      });
    }

    private async writeVentMode(context: FanModeWriteContext, value: number, opts?: { force?: boolean }) {
      const current = context.unit.probeValues.get(context.ventilationModeKey);
      if (!opts?.force && this.shouldSkipWrite(context.unit, context.ventilationModeKey, current, value)) {
        this.log(`[UnitRegistry] Ventilation mode already ${value}, skipping write.`);
        return true;
      }
      const ok = await this.writeUpdate(context, {
        objectId: BACNET_OBJECTS.ventilationMode,
        tag: BacnetEnums.ApplicationTags.UNSIGNED_INTEGER,
        value,
        priority: DEFAULT_WRITE_PRIORITY,
      });
      if (ok) {
        context.unit.writeContext.set(context.ventilationModeKey, { value, mode: context.mode, at: Date.now() });
      }
      return ok;
    }

    private writeFireplaceTrigger(context: FanModeWriteContext, value: number) {
      return this.writeUpdate(context, {
        objectId: BACNET_OBJECTS.fireplaceVentilationTrigger,
        tag: BacnetEnums.ApplicationTags.UNSIGNED_INTEGER,
        value,
        priority: DEFAULT_WRITE_PRIORITY,
      });
    }

    private writeRapidTrigger(context: FanModeWriteContext, value: number) {
      return this.writeUpdate(context, {
        objectId: BACNET_OBJECTS.rapidVentilationTrigger,
        tag: BacnetEnums.ApplicationTags.UNSIGNED_INTEGER,
        value,
        priority: DEFAULT_WRITE_PRIORITY,
      });
    }

    private writeCookerHood(context: FanModeWriteContext, value: number) {
      return this.writeUpdate(context, {
        objectId: BACNET_OBJECTS.cookerHood,
        tag: BacnetEnums.ApplicationTags.ENUMERATED,
        value,
        priority: DEFAULT_WRITE_PRIORITY,
      });
    }

    private relinquishCookerHood(context: FanModeWriteContext) {
      return this.writeUpdate(context, {
        objectId: BACNET_OBJECTS.cookerHood,
        tag: BacnetEnums.ApplicationTags.ENUMERATED,
        value: null,
        priority: DEFAULT_WRITE_PRIORITY,
      });
    }

    private async applyHomeMode(context: FanModeWriteContext) {
      const comfortOk = await this.writeComfort(context, 1);
      if (comfortOk && !context.unit.blockedWrites.has(context.ventilationModeKey)) {
        await this.writeVentMode(context, VENTILATION_MODE_VALUES.HOME, { force: true });
      }
    }

    private async applyAwayMode(context: FanModeWriteContext) {
      await this.writeComfort(context, 0);
    }

    private async applyHighMode(context: FanModeWriteContext) {
      const comfortOk = await this.writeComfort(context, 1);
      if (context.unit.blockedWrites.has(context.ventilationModeKey)) {
        this.warn('[UnitRegistry] Ventilation mode write blocked; cannot set high mode.');
        return;
      }
      if (comfortOk) {
        await this.writeVentMode(context, VENTILATION_MODE_VALUES.HIGH);
      }
    }

    private async applyCookerMode(
      context: FanModeWriteContext,
      cookerAlreadyActive: boolean,
    ) {
      if (!cookerAlreadyActive) {
        await this.writeCookerHood(context, 1);
      }
    }

    private async applyFireplaceMode(
      context: FanModeWriteContext,
      fireplaceRuntime: number,
      temporaryRapidActive: boolean,
    ) {
      const comfortState = context.unit.probeValues.get(context.comfortButtonKey);
      if (comfortState !== 1) {
        await this.writeComfort(context, 1);
      }
      await this.writeUpdate(context, {
        objectId: BACNET_OBJECTS.fireplaceVentilationRuntime,
        tag: BacnetEnums.ApplicationTags.UNSIGNED_INTEGER,
        value: fireplaceRuntime,
      });
      if (temporaryRapidActive) {
        await this.writeRapidTrigger(context, TRIGGER_VALUE);
      }
      await this.writeFireplaceTrigger(context, TRIGGER_VALUE);
    }

    private async readPresentValue(
      client: any,
      unit: UnitState,
      objectId: { type: number; instance: number },
    ): Promise<number> {
      const values = await this.readPresentValues(client, unit, [objectId]);
      return values.get(objectKey(objectId.type, objectId.instance)) as number;
    }

    private async readPresentValues(
      client: any,
      unit: UnitState,
      objectIds: Array<{ type: number; instance: number }>,
    ): Promise<Map<string, number>> {
      return new Promise<Map<string, number>>((resolve, reject) => {
        let handled = false;
        const tm = setTimeout(() => {
          if (!handled) {
            handled = true;
            reject(new Error(`Timeout reading ${objectIds.map((obj) => `${obj.type}:${obj.instance}`).join(', ')}`));
          }
        }, 5000);

        const request = objectIds.map((objectId) => ({
          objectId,
          properties: [{ id: PRESENT_VALUE_ID }],
        }));

        try {
          client.readPropertyMultiple(unit.ip, request, (err: any, value: any) => {
            if (handled) return;
            handled = true;
            clearTimeout(tm);
            if (err) {
              reject(err);
              return;
            }

            let candidates: any[];
            if (Array.isArray(value)) candidates = value;
            else if (Array.isArray(value?.values)) candidates = value.values;
            else candidates = [value];

            const extracted = new Map<string, number>();
            for (const candidate of candidates) {
              const type = Number(candidate?.objectId?.type);
              const instance = Number(candidate?.objectId?.instance);
              if (!Number.isFinite(type) || !Number.isFinite(instance)) continue;
              const raw = this.extractNumericPresentValue(candidate);
              if (typeof raw === 'number' && !Number.isNaN(raw)) {
                extracted.set(objectKey(type, instance), raw);
              }
            }

            for (const objectId of objectIds) {
              const key = objectKey(objectId.type, objectId.instance);
              if (!extracted.has(key)) {
                reject(new Error(`Missing present value for ${objectId.type}:${objectId.instance}`));
                return;
              }
            }
            resolve(extracted);
          });
        } catch (error) {
          if (handled) return;
          handled = true;
          clearTimeout(tm);
          reject(error);
        }
      });
    }

    private extractNumericPresentValue(value: any): number | undefined {
      const direct = this.extractValue(value);
      if (typeof direct === 'number' && !Number.isNaN(direct)) return direct;

      const tagged = value?.value?.[0]?.value;
      if (typeof tagged === 'number' && !Number.isNaN(tagged)) return tagged;

      return undefined;
    }

    private extractValue(obj: any): number | undefined {
      const value = obj?.values?.[0]?.value?.[0]?.value;
      return typeof value === 'number' && !Number.isNaN(value) ? value : undefined;
    }

    // -------------------------------------------------------------------
    // Cloud transport implementation
    // -------------------------------------------------------------------

    private cloudPollUnit(unit: UnitState): Promise<void> {
      if (!unit.cloud) return Promise.resolve();
      if (unit.pollInFlight) return unit.cloudPollPromise ?? Promise.resolve();
      unit.pollInFlight = true;
      const promise = this.executeCloudPoll(unit);
      unit.cloudPollPromise = promise;
      return promise;
    }

    private async executeCloudPoll(unit: UnitState) {
      if (!unit.cloud) return;

      const { plantId, client } = unit.cloud;

      const paths = POLL_REQUEST.map((req: any) => {
        const objId = req.objectId;
        return bacnetObjectToCloudPath(objId.type, objId.instance);
      });

      let values: Record<string, any>;
      try {
        values = await client.readDatapoints(plantId, paths);
      } catch (err) {
        unit.pollInFlight = false;
        if (err instanceof AuthenticationError) {
          this.warn(`[UnitRegistry] Cloud auth failed for ${unit.unitId}: ${(err as Error).message}`);
          unit.available = false;
          if (unit.pollInterval) {
            clearInterval(unit.pollInterval);
            unit.pollInterval = null;
          }
          for (const device of unit.devices) {
            this.logDetachedPromiseError(
              device.setUnavailable('Cloud authentication failed. Please repair the device.'),
              `[UnitRegistry] Failed to set device unavailable for ${unit.unitId}:`,
            );
          }
          return;
        }
        this.handleCloudPollFailure(unit);
        return;
      }

      try {
        this.handlePollSuccess(unit);
        unit.lastPollAt = Date.now();
        const data = this.parseCloudPollValues(unit, values);
        this.distributeData(unit, data);
      } catch (e) {
        this.error(`[UnitRegistry] Cloud parse error for ${unit.unitId}:`, e);
      } finally {
        unit.pollInFlight = false;
      }
    }

    private handleCloudPollFailure(unit: UnitState) {
      unit.consecutiveFailures++;
      if (unit.consecutiveFailures >= MAX_CLOUD_CONSECUTIVE_FAILURES && unit.available) {
        unit.available = false;
        this.warn(
          `[UnitRegistry] Cloud unit ${unit.unitId} marked unavailable after`
          + ` ${unit.consecutiveFailures} consecutive failures`,
        );
        for (const device of unit.devices) {
          this.logDetachedPromiseError(
            device.setUnavailable('Cloud connection lost. Will retry automatically.'),
            `[UnitRegistry] Failed to set device unavailable for ${unit.unitId}:`,
          );
        }
      }
    }

    private parseCloudPollValues(
      unit: UnitState,
      values: Record<string, any>,
    ): Record<string, number> {
      const target: PollParseTarget = { data: {} };
      const { plantId } = unit.cloud!;

      for (const [fullPath, entry] of Object.entries(values)) {
        const pathPart = fullPath.startsWith(plantId)
          ? fullPath.slice(plantId.length)
          : fullPath;

        const hex = pathPart.replace(/^;1!/, '');
        if (hex.length < 9) continue;
        const objectType = parseInt(hex.substring(0, 3), 16);
        const instance = parseInt(hex.substring(3, 9), 16);

        const val = entry?.value?.value;
        if (typeof val !== 'number' || Number.isNaN(val)) continue;

        const key = objectKey(objectType, instance);
        const mapper = POLL_VALUE_MAPPINGS[key];
        if (mapper) mapper(val, target);
        unit.probeValues.set(key, val);
      }

      const extractTemp = selectExtractTemperature(target.extractTempPrimary, target.extractTempAlt);
      if (extractTemp !== undefined) {
        target.data['measure_temperature.extract'] = extractTemp;
      }
      return target.data;
    }

    private async cloudWriteDatapoint(
      unit: UnitState,
      objectId: { type: number; instance: number },
      value: number | string | null,
    ): Promise<boolean> {
      if (!unit.cloud) return false;
      const { plantId, client } = unit.cloud;
      const path = bacnetObjectToCloudPath(objectId.type, objectId.instance);

      try {
        return await client.writeDatapoint(plantId, path, value);
      } catch (err) {
        if (err instanceof AuthenticationError) {
          throw err;
        }
        this.error(`[UnitRegistry] Cloud write failed for ${unit.unitId}:`, err);
        return false;
      }
    }

    private async cloudWriteTemperatureSetpoint(
      unit: UnitState,
      mode: TargetTemperatureMode,
      setpoint: number,
    ) {
      const objectId = TARGET_TEMPERATURE_OBJECTS[mode];
      const normalizedSetpoint = normalizeTargetTemperature(setpoint);

      this.log(
        `[UnitRegistry] Cloud: writing ${mode} setpoint ${normalizedSetpoint}`
        + ` for ${unit.unitId}`,
      );

      const success = await this.cloudWriteDatapoint(unit, objectId, normalizedSetpoint);
      if (!success) throw new Error(`Failed to write ${mode} setpoint via cloud`);

      await this.cloudPollUnit(unit);
    }

    private async cloudResetFilterTimer(unit: UnitState) {
      this.log(`[UnitRegistry] Cloud: resetting filter timer for ${unit.unitId}`);
      const success = await this.cloudWriteDatapoint(
        unit,
        BACNET_OBJECTS.filterOperatingTime,
        0,
      );
      if (!success) throw new Error('Failed to reset filter timer via cloud');
      await this.cloudPollUnit(unit);
    }

    private async cloudSetFilterChangeInterval(unit: UnitState, requestedHours: number) {
      const intervalHours = this.normalizeFilterChangeIntervalHours(requestedHours);
      this.log(`[UnitRegistry] Cloud: setting filter change interval to ${intervalHours}h for ${unit.unitId}`);

      const success = await this.cloudWriteDatapoint(
        unit,
        FILTER_LIMIT_OBJECT,
        intervalHours,
      );
      if (!success) throw new Error('Failed to write filter change interval via cloud');

      const months = filterIntervalHoursToMonths(
        intervalHours,
        (message) => this.warn(message),
      );
      for (const device of unit.devices) {
        this.updateDeviceSettings(device, {
          [FILTER_CHANGE_INTERVAL_MONTHS_SETTING]: months,
          [FILTER_CHANGE_INTERVAL_HOURS_LEGACY_SETTING]: intervalHours,
        }).catch((err) => {
          this.warn(`[UnitRegistry] Failed to sync filter settings for ${unit.unitId}:`, err);
        });
      }

      await this.cloudPollUnit(unit);
    }

    private async cloudSetFireplaceVentilationDuration(
      unit: UnitState,
      requestedMinutes: number,
    ) {
      const durationMinutes = normalizeFireplaceDurationMinutes(requestedMinutes);
      this.log(`[UnitRegistry] Cloud: setting fireplace duration to ${durationMinutes} min for ${unit.unitId}`);

      const success = await this.cloudWriteDatapoint(
        unit,
        BACNET_OBJECTS.fireplaceVentilationRuntime,
        durationMinutes,
      );
      if (!success) throw new Error('Failed to write fireplace duration via cloud');

      for (const device of unit.devices) {
        this.updateDeviceSettings(device, {
          [FIREPLACE_DURATION_SETTING]: durationMinutes,
        }).catch((err) => {
          this.warn(
            `[UnitRegistry] Failed to sync fireplace duration setting for ${unit.unitId}:`,
            err,
          );
        });
      }

      await this.cloudPollUnit(unit);
    }

    private async cloudSetFanProfileMode(
      unit: UnitState,
      mode: FanProfileMode,
      requestedSupplyPercent: number,
      requestedExhaustPercent: number,
    ) {
      const supplyPercent = normalizeFanProfilePercent(requestedSupplyPercent, mode, 'supply');
      const exhaustPercent = normalizeFanProfilePercent(requestedExhaustPercent, mode, 'exhaust');
      const objects = FAN_PROFILE_OBJECTS[mode];

      this.log(
        `[UnitRegistry] Cloud: updating ${mode} fan profile to`
        + ` supply=${supplyPercent}% exhaust=${exhaustPercent}% for ${unit.unitId}`,
      );

      const supplyOk = await this.cloudWriteDatapoint(unit, objects.supply, supplyPercent);
      const exhaustOk = await this.cloudWriteDatapoint(unit, objects.exhaust, exhaustPercent);
      if (!supplyOk || !exhaustOk) throw new Error(`Failed to write ${mode} fan profile via cloud`);

      const settingsForMode = FAN_PROFILE_SETTING_KEYS[mode];
      for (const device of unit.devices) {
        this.updateDeviceSettings(device, {
          [settingsForMode.supply]: supplyPercent,
          [settingsForMode.exhaust]: exhaustPercent,
        }).catch((err) => {
          this.warn(`[UnitRegistry] Failed to sync ${mode} fan settings for ${unit.unitId}:`, err);
        });
      }

      await this.cloudPollUnit(unit);
    }

    private async cloudWriteFireplaceMode(unit: UnitState, temporaryRapidActive: boolean) {
      const comfortState = unit.probeValues.get(COMFORT_BUTTON_KEY);
      if (comfortState !== 1) {
        await this.cloudWriteDatapoint(unit, BACNET_OBJECTS.comfortButton, 1);
      }
      const runtime = clamp(
        Math.round(
          unit.probeValues.get(FIREPLACE_RUNTIME_KEY)
          ?? DEFAULT_FIREPLACE_VENTILATION_MINUTES,
        ),
        1, 360,
      );
      await this.cloudWriteDatapoint(
        unit, BACNET_OBJECTS.fireplaceVentilationRuntime, runtime,
      );
      if (temporaryRapidActive) {
        await this.cloudWriteDatapoint(
          unit, BACNET_OBJECTS.rapidVentilationTrigger, TRIGGER_VALUE,
        );
      }
      await this.cloudWriteDatapoint(
        unit, BACNET_OBJECTS.fireplaceVentilationTrigger, TRIGGER_VALUE,
      );
    }

    private async cloudSetFanMode(unit: UnitState, mode: string) {
      this.log(`[UnitRegistry] Cloud: setting fan mode to '${mode}' for ${unit.unitId}`);

      const fireplaceActive = (unit.probeValues.get(FIREPLACE_ACTIVE_KEY) ?? 0) === 1;
      const operationMode = Math.round(unit.probeValues.get(OPERATION_MODE_KEY) ?? NaN);
      const fireplaceAlreadyActive = fireplaceActive
        || operationMode === OPERATION_MODE_VALUES.FIREPLACE;
      const cookerAlreadyActive = operationMode === OPERATION_MODE_VALUES.COOKER_HOOD;
      const rapidActive = (unit.probeValues.get(RAPID_ACTIVE_KEY) ?? 0) === 1;
      const temporaryRapidActive = rapidActive || operationMode === OPERATION_MODE_VALUES.TEMPORARY_HIGH;

      if (mode !== 'fireplace') {
        unit.deferredMode = undefined;
        unit.deferredSince = undefined;
      }
      if (mode === 'fireplace' && fireplaceAlreadyActive) {
        this.log(
          `[UnitRegistry] Cloud: fireplace already active for ${unit.unitId}, skipping.`,
        );
        return;
      }

      unit.expectedMode = mode;
      unit.expectedModeAt = Date.now();
      unit.lastMismatchKey = undefined;

      if (mode !== 'fireplace' && fireplaceAlreadyActive) {
        await this.cloudWriteDatapoint(
          unit, BACNET_OBJECTS.fireplaceVentilationTrigger, TRIGGER_VALUE,
        );
      }
      if (mode !== 'fireplace' && mode !== 'high' && temporaryRapidActive) {
        await this.cloudWriteDatapoint(
          unit, BACNET_OBJECTS.rapidVentilationTrigger, TRIGGER_VALUE,
        );
      }
      if (mode !== 'cooker' && cookerAlreadyActive) {
        await this.cloudWriteDatapoint(unit, BACNET_OBJECTS.cookerHood, null);
      }

      switch (mode) {
        case 'home':
          await this.cloudWriteDatapoint(unit, BACNET_OBJECTS.comfortButton, 1);
          await this.cloudWriteDatapoint(
            unit, BACNET_OBJECTS.ventilationMode, VENTILATION_MODE_VALUES.HOME,
          );
          break;
        case 'away':
          await this.cloudWriteDatapoint(unit, BACNET_OBJECTS.comfortButton, 0);
          break;
        case 'high':
          await this.cloudWriteDatapoint(unit, BACNET_OBJECTS.comfortButton, 1);
          await this.cloudWriteDatapoint(
            unit, BACNET_OBJECTS.ventilationMode, VENTILATION_MODE_VALUES.HIGH,
          );
          break;
        case 'fireplace':
          await this.cloudWriteFireplaceMode(unit, temporaryRapidActive);
          break;
        case 'cooker':
          if (!cookerAlreadyActive) {
            await this.cloudWriteDatapoint(
              unit, BACNET_OBJECTS.cookerHood, COOKER_HOOD_ON,
            );
          }
          break;
        default:
          this.warn(
            `[UnitRegistry] Unsupported cloud fan mode '${mode}' for ${unit.unitId}`,
          );
          return;
      }

      await this.cloudPollUnit(unit);
    }

    private async cloudSetHeatingCoilEnabled(unit: UnitState, enabled: boolean) {
      const state = enabled ? 'on' : 'off';
      this.log(`[UnitRegistry] Cloud: setting heating coil ${state} for ${unit.unitId}`);

      const success = await this.cloudWriteDatapoint(
        unit,
        BACNET_OBJECTS.heatingCoilEnable,
        enabled ? HEATING_COIL_ON : HEATING_COIL_OFF,
      );
      if (!success) throw new Error(`Failed to set heating coil ${state} via cloud`);

      await this.cloudPollUnit(unit);
    }
}

export const Registry = new UnitRegistry();
