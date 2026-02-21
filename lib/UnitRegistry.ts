/* eslint-disable max-lines */
import { getBacnetClient, BacnetEnums, setBacnetLogger } from './bacnetClient';
import { discoverFlexitUnits } from './flexitDiscovery';

// Helper to clamp values
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
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
const RAPID_ACTIVE_KEY = objectKey(OBJECT_TYPE.BINARY_VALUE, 15);
const FIREPLACE_ACTIVE_KEY = objectKey(
  BACNET_OBJECTS.fireplaceState.type,
  BACNET_OBJECTS.fireplaceState.instance,
);
const TEMP_VENT_REMAINING_KEY = objectKey(OBJECT_TYPE.ANALOG_VALUE, 2005);
const RAPID_REMAINING_KEY = objectKey(OBJECT_TYPE.ANALOG_VALUE, 2031);
const FIREPLACE_REMAINING_KEY = objectKey(OBJECT_TYPE.ANALOG_VALUE, 2038);
const MODE_RF_INPUT_KEY = objectKey(OBJECT_TYPE.ANALOG_VALUE, 2125);
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

export function normalizeTargetTemperature(value: number): number {
  const clamped = clamp(value, MIN_TARGET_TEMPERATURE_C, MAX_TARGET_TEMPERATURE_C);
  const stepped = Math.round(clamped / TARGET_TEMPERATURE_STEP_C) * TARGET_TEMPERATURE_STEP_C;
  return Number(stepped.toFixed(1));
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
  currentFanSetpointMode?: FanProfileMode;
  currentFanSetpoints: Partial<Record<FanProfileFan, number>>;
  currentFanSetpointsInitialized: boolean;
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
  value: number;
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
}

interface FanSetpointChangedEvent {
  device: FlexitDevice;
  fan: FanProfileFan;
  mode: FanProfileMode;
  setpointPercent: number;
}

// The core poll request — only objects that drive device capabilities.
function buildPollRequest() {
  return [
    // Thermostat capabilities
    { objectId: TARGET_TEMPERATURE_OBJECTS.home, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint HOME
    { objectId: TARGET_TEMPERATURE_OBJECTS.away, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint AWAY
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
    { objectId: FAN_PROFILE_OBJECTS.home.supply, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint supply HOME
    { objectId: FAN_PROFILE_OBJECTS.home.exhaust, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint exhaust HOME
    { objectId: FAN_PROFILE_OBJECTS.away.supply, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint supply AWAY
    { objectId: FAN_PROFILE_OBJECTS.away.exhaust, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint exhaust AWAY
    { objectId: FAN_PROFILE_OBJECTS.high.supply, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint supply HIGH
    { objectId: FAN_PROFILE_OBJECTS.high.exhaust, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint exhaust HIGH
    { objectId: FAN_PROFILE_OBJECTS.fireplace.supply, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint supply FIREPLACE
    { objectId: FAN_PROFILE_OBJECTS.fireplace.exhaust, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint exhaust FIREPLACE
    { objectId: FAN_PROFILE_OBJECTS.cooker.supply, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint supply COOKER
    { objectId: FAN_PROFILE_OBJECTS.cooker.exhaust, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint exhaust COOKER
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

const POLL_VALUE_MAPPINGS: Record<string, (value: number, target: PollParseTarget) => void> = {
  [objectKey(TARGET_TEMPERATURE_OBJECTS.home.type, TARGET_TEMPERATURE_OBJECTS.home.instance)]: mapPollValue(TARGET_TEMPERATURE_DATA_KEYS.home),
  [objectKey(TARGET_TEMPERATURE_OBJECTS.away.type, TARGET_TEMPERATURE_OBJECTS.away.instance)]: mapPollValue(TARGET_TEMPERATURE_DATA_KEYS.away),
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
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 194)]: mapPollValue('measure_power', (value) => value * 1000),
  [objectKey(OBJECT_TYPE.ANALOG_INPUT, 5)]: mapPollValue('measure_motor_rpm'),
  [objectKey(OBJECT_TYPE.ANALOG_INPUT, 12)]: mapPollValue('measure_motor_rpm.extract'),
  [objectKey(OBJECT_TYPE.ANALOG_OUTPUT, 3)]: mapPollValue('measure_fan_speed_percent'),
  [objectKey(OBJECT_TYPE.ANALOG_OUTPUT, 4)]: mapPollValue('measure_fan_speed_percent.extract'),
  [objectKey(FAN_PROFILE_OBJECTS.home.supply.type, FAN_PROFILE_OBJECTS.home.supply.instance)]: mapPollValue('fan_profile.home.supply'),
  [objectKey(FAN_PROFILE_OBJECTS.home.exhaust.type, FAN_PROFILE_OBJECTS.home.exhaust.instance)]: mapPollValue('fan_profile.home.exhaust'),
  [objectKey(FAN_PROFILE_OBJECTS.away.supply.type, FAN_PROFILE_OBJECTS.away.supply.instance)]: mapPollValue('fan_profile.away.supply'),
  [objectKey(FAN_PROFILE_OBJECTS.away.exhaust.type, FAN_PROFILE_OBJECTS.away.exhaust.instance)]: mapPollValue('fan_profile.away.exhaust'),
  [objectKey(FAN_PROFILE_OBJECTS.high.supply.type, FAN_PROFILE_OBJECTS.high.supply.instance)]: mapPollValue('fan_profile.high.supply'),
  [objectKey(FAN_PROFILE_OBJECTS.high.exhaust.type, FAN_PROFILE_OBJECTS.high.exhaust.instance)]: mapPollValue('fan_profile.high.exhaust'),
  [objectKey(FAN_PROFILE_OBJECTS.fireplace.supply.type, FAN_PROFILE_OBJECTS.fireplace.supply.instance)]: mapPollValue('fan_profile.fireplace.supply'),
  [objectKey(FAN_PROFILE_OBJECTS.fireplace.exhaust.type, FAN_PROFILE_OBJECTS.fireplace.exhaust.instance)]: mapPollValue('fan_profile.fireplace.exhaust'),
  [objectKey(FAN_PROFILE_OBJECTS.cooker.supply.type, FAN_PROFILE_OBJECTS.cooker.supply.instance)]: mapPollValue('fan_profile.cooker.supply'),
  [objectKey(FAN_PROFILE_OBJECTS.cooker.exhaust.type, FAN_PROFILE_OBJECTS.cooker.exhaust.instance)]: mapPollValue('fan_profile.cooker.exhaust'),
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 285)]: mapPollValue('filter_time'),
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 286)]: mapPollValue('filter_limit'),
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 50)]: mapPollValue('comfort_button'),
  [objectKey(OBJECT_TYPE.POSITIVE_INTEGER_VALUE, 318)]: mapPollValue('comfort_delay'),
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 42)]: mapPollValue('ventilation_mode'),
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 361)]: mapPollValue('operation_mode'),
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
          currentFanSetpointMode: undefined,
          currentFanSetpoints: {},
          currentFanSetpointsInitialized: false,
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

      unit.writeQueue = unit.writeQueue.then(async () => new Promise<void>((resolve, reject) => {
        let handled = false;
        const tm = setTimeout(() => {
          if (!handled) {
            handled = true;
            this.error(`[UnitRegistry] Timeout writing ${mode} setpoint to ${unit.unitId}`);
            reject(new Error('Timeout'));
          }
        }, 5000);

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

      return unit.writeQueue;
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
      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');

      const writeOptions: WriteOptions = {
        maxSegments: BacnetEnums.MaxSegmentsAccepted.SEGMENTS_0,
        maxApdu: BacnetEnums.MaxApduLengthAccepted.OCTETS_1476,
        priority: DEFAULT_WRITE_PRIORITY,
      };

      this.log(`[UnitRegistry] Resetting filter timer for ${unitId}`);

      unit.writeQueue = unit.writeQueue.then(async () => {
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

      return unit.writeQueue;
    }

    async setFilterChangeInterval(unitId: string, requestedHours: number) {
      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');

      const intervalHours = this.normalizeFilterChangeIntervalHours(requestedHours);
      const writeOptions: WriteOptions = {
        maxSegments: BacnetEnums.MaxSegmentsAccepted.SEGMENTS_0,
        maxApdu: BacnetEnums.MaxApduLengthAccepted.OCTETS_1476,
        priority: DEFAULT_WRITE_PRIORITY,
      };

      this.log(`[UnitRegistry] Setting filter change interval to ${intervalHours}h for ${unitId}`);

      unit.writeQueue = unit.writeQueue.then(async () => {
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

      return unit.writeQueue;
    }

    async setFanProfileMode(
      unitId: string,
      mode: FanProfileMode,
      requestedSupplyPercent: number,
      requestedExhaustPercent: number,
    ) {
      if (!isFanProfileMode(mode)) throw new Error(`Unsupported fan profile mode '${mode}'`);

      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');

      const supplyPercent = normalizeFanProfilePercent(requestedSupplyPercent, mode, 'supply');
      const exhaustPercent = normalizeFanProfilePercent(requestedExhaustPercent, mode, 'exhaust');
      const writeOptions: WriteOptions = {
        maxSegments: BacnetEnums.MaxSegmentsAccepted.SEGMENTS_0,
        maxApdu: BacnetEnums.MaxApduLengthAccepted.OCTETS_1476,
        priority: DEFAULT_WRITE_PRIORITY,
      };

      this.log(
        `[UnitRegistry] Setting ${mode} fan profile`
        + ` supply=${supplyPercent}% exhaust=${exhaustPercent}% for ${unitId}`,
      );

      unit.writeQueue = unit.writeQueue.then(async () => {
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

      return unit.writeQueue;
    }

    private pollUnit(unitId: string) {
      const unit = this.units.get(unitId);
      if (!unit) return;
      this.pollAttempt(unit, 0);
    }

    private pollAttempt(unit: UnitState, attempt: number) {
      const client = this.dependencies.getBacnetClient(unit.bacnetPort);
      try {
        client.readPropertyMultiple(unit.ip, POLL_REQUEST, (err: any, value: any) => {
          if (err) {
            this.handlePollError(unit, attempt, err);
            return;
          }
          this.handlePollResponse(unit, value);
        });
      } catch (error) {
        this.error(`[UnitRegistry] Synchronous internal error checking ${unit.unitId}:`, error);
        this.handlePollFailure(unit);
      }
    }

    private handlePollError(unit: UnitState, attempt: number, err: any) {
      const isTimeout = err?.code === 'ERR_TIMEOUT' || String(err?.message || '').includes('ERR_TIMEOUT');
      if (isTimeout && attempt === 0) {
        this.warn(`[UnitRegistry] Poll timeout for ${unit.unitId}, retrying once...`);
        setTimeout(() => this.pollAttempt(unit, 1), 1000);
        return;
      }
      this.error(`[UnitRegistry] Poll error for ${unit.unitId}:`, err);
      this.handlePollFailure(unit);
    }

    private handlePollResponse(unit: UnitState, value: any) {
      if (!value?.values) return;
      try {
        this.handlePollSuccess(unit);
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
      if (pending && valuesMatch(value, pending.value)) {
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
          `[UnitRegistry] Ventilation mode mismatch after write: expected ${context.value} for '${context.mode}', got ${value}`,
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
          const found = await this.dependencies.discoverFlexitUnits({ timeoutMs: 5000, burstCount: 3, burstIntervalMs: 300 });
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

            // Connection settings are labels (read-only), keep runtime values in memory.
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

    private distributeData(unit: UnitState, data: Record<string, number>) {
      const mode = this.resolveFanMode(unit, data);
      const setpointMode = this.resolveCurrentFanSetpointMode(data, mode);
      const temperatureMode = this.resolveCurrentTemperatureSetpointMode(data, mode);

      for (const device of unit.devices) {
        this.applyMappedCapabilities(device, data);
        this.applyCurrentTargetTemperatureCapability(device, data, temperatureMode);
        this.applyCurrentFanSetpointCapabilities(unit, device, data, setpointMode);
        this.syncTargetTemperatureSettings(device, data);
        this.syncFanProfileSettings(device, data);
        this.syncFilterIntervalSetting(device, data.filter_limit);
        const filterLife = this.computeFilterLife(data);
        if (filterLife !== undefined) this.setCapability(device, 'measure_hepa_filter', filterLife);
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
        const changed = previous === undefined || !valuesMatch(previous, normalized) || unit.currentFanSetpointMode !== mode;
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
        this.setFanMode(unit.unitId, 'fireplace').catch(() => { });
      }

      const mode = this.resolveFanModeFromSignals(data, tempOpActive);
      if (!mode) return undefined;

      this.logModeMismatch(unit, mode, data);
      return mode;
    }

    private resolveFanModeFromSignals(
      data: Record<string, number>,
      tempOpActive: boolean = (data.remaining_temp_vent_op ?? 0) > 0,
    ): 'home' | 'away' | 'high' | 'fireplace' | undefined {
      if (!MODE_SIGNAL_KEYS.some((key) => data[key] !== undefined)) return undefined;

      let mode = this.resolveBaseMode(data, tempOpActive);
      if (data.fireplace_active === 1) mode = 'fireplace';
      else if (data.rapid_active === 1) mode = 'high';
      return mode;
    }

    private resolveBaseMode(data: Record<string, number>, tempOpActive: boolean): 'home' | 'away' | 'high' | 'fireplace' {
      const rfMode = MODE_RF_INPUT_MAP[Math.round(data.mode_rf_input ?? NaN)];
      if (data.operation_mode !== undefined) {
        return mapOperationMode(Math.round(data.operation_mode));
      }
      if (data.ventilation_mode !== undefined) {
        return mapVentilationMode(Math.round(data.ventilation_mode));
      }
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
      const { expectedMode } = unit;
      if (!expectedMode) return;

      if (expectedMode === mode) {
        unit.lastMismatchKey = undefined;
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
      this.warn(`[UnitRegistry] Mode mismatch for ${unit.unitId}: expected '${expectedMode}' got '${mode}'`);
    }

    private applyMappedCapabilities(device: FlexitDevice, data: Record<string, number>) {
      for (const { dataKey, capability } of CAPABILITY_MAPPINGS) {
        const value = data[dataKey];
        if (value !== undefined) {
          this.setCapability(device, capability, value);
        }
      }
    }

    private setCapability(device: FlexitDevice, capability: string, value: number | string) {
      device.setCapabilityValue(capability, value).catch(() => { });
    }

    async setFanMode(unitId: string, mode: string) {
      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');

      this.log(`[UnitRegistry] Setting fan mode to '${mode}' for ${unitId}`);
      const writeOptions: WriteOptions = {
        maxSegments: BacnetEnums.MaxSegmentsAccepted.SEGMENTS_0,
        maxApdu: BacnetEnums.MaxApduLengthAccepted.OCTETS_1476,
        priority: DEFAULT_WRITE_PRIORITY,
      };

      unit.writeQueue = unit.writeQueue.then(() => this.applyFanMode(unit, mode, writeOptions));
      return unit.writeQueue;
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

      const rapidActive = (unit.probeValues.get(RAPID_ACTIVE_KEY) ?? 0) === 1;
      const tempVentActive = (unit.probeValues.get(TEMP_VENT_REMAINING_KEY) ?? 0) > 0;
      const temporaryRapidActive = rapidActive || tempVentActive;
      const fireplaceActive = (unit.probeValues.get(FIREPLACE_ACTIVE_KEY) ?? 0) === 1;
      const fireplaceRuntime = clamp(
        Math.round(unit.probeValues.get(FIREPLACE_RUNTIME_KEY) ?? DEFAULT_FIREPLACE_VENTILATION_MINUTES),
        1,
        360,
      );

      if (mode !== 'fireplace') {
        unit.deferredMode = undefined;
        unit.deferredSince = undefined;
      }
      if (mode === 'fireplace' && temporaryRapidActive) {
        this.warn(
          `[UnitRegistry] Fireplace requested while temporary ventilation is active (rapid=${rapidActive} temp=${tempVentActive}); proceeding anyway.`,
        );
      }

      unit.expectedMode = mode;
      unit.expectedModeAt = Date.now();
      unit.lastMismatchKey = undefined;

      if (mode !== 'fireplace' && fireplaceActive) {
        await this.writeFireplaceTrigger(context, TRIGGER_VALUE);
      }

      switch (mode) {
        case 'home':
          await this.applyHomeMode(context, temporaryRapidActive);
          return;
        case 'away':
          await this.applyAwayMode(context, fireplaceActive, temporaryRapidActive);
          return;
        case 'high':
          await this.applyHighMode(context);
          return;
        case 'fireplace':
          await this.applyFireplaceMode(context, fireplaceRuntime);
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
        }, 5000);

        try {
          this.log(`[UnitRegistry] Writing ${update.objectId.type}:${update.objectId.instance} = ${update.value}`);
          const options: { maxSegments: number; maxApdu: number; priority?: number } = {
            maxSegments: context.writeOptions.maxSegments,
            maxApdu: context.writeOptions.maxApdu,
          };
          if (update.priority !== null) {
            options.priority = update.priority ?? DEFAULT_WRITE_PRIORITY;
          }

          context.client.writeProperty(
            unit.ip,
            update.objectId,
            PRESENT_VALUE_ID,
            [{ type: update.tag, value: update.value }],
            options,
            (err: any) => {
              if (handled) return;
              handled = true;
              clearTimeout(tm);
              const now = Date.now();

              if (!err) {
                unit.lastWriteValues.set(writeKey, { value: update.value, at: now });
                this.log(
                  `[UnitRegistry] Successfully wrote ${update.objectId.type}:${update.objectId.instance} to ${update.value}`,
                );
                resolve(true);
                return;
              }

              const message = String(err?.message || err);
              const errMatch = message.match(/Code:(\d+)/);
              const code = errMatch ? Number(errMatch[1]) : undefined;
              if (code === 37) {
                unit.lastWriteValues.set(writeKey, { value: update.value, at: now });
                unit.pendingWriteErrors.set(writeKey, { value: update.value, code });
                this.warn(`[UnitRegistry] Write returned Code:37 for ${writeKey}; will verify on next poll.`);
                resolve(true);
                return;
              }

              if (message.includes('Code:40') || message.includes('Code:9')) {
                unit.lastWriteValues.set(writeKey, { value: update.value, at: now });
                if (NEVER_BLOCK_KEYS.has(writeKey)) {
                  this.warn(`[UnitRegistry] Write denied for ${writeKey}, but will keep retrying.`);
                } else {
                  unit.blockedWrites.add(writeKey);
                  this.warn(`[UnitRegistry] Disabling writes for ${writeKey} due to device error.`);
                }
              } else {
                this.error(
                  `[UnitRegistry] Failed to write ${update.objectId.type}:${update.objectId.instance} to ${update.value}`,
                  err,
                );
              }
              resolve(false);
            },
          );
        } catch (e) {
          if (!handled) {
            handled = true;
            clearTimeout(tm);
            this.error(`[UnitRegistry] Sync error writing ${update.objectId.type}:${update.objectId.instance}:`, e);
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

    private async applyHomeMode(context: FanModeWriteContext, temporaryRapidActive: boolean) {
      const comfortOk = await this.writeComfort(context, 1);
      if (comfortOk && !context.unit.blockedWrites.has(context.ventilationModeKey)) {
        await this.writeVentMode(context, VENTILATION_MODE_VALUES.HOME, { force: true });
      }
      if (temporaryRapidActive) {
        await this.writeRapidTrigger(context, TRIGGER_VALUE);
      }
    }

    private async applyAwayMode(
      context: FanModeWriteContext,
      fireplaceActive: boolean,
      temporaryRapidActive: boolean,
    ) {
      await this.writeComfort(context, 0, { force: fireplaceActive });
      if (temporaryRapidActive) {
        await this.writeRapidTrigger(context, TRIGGER_VALUE);
      }
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

    private async applyFireplaceMode(context: FanModeWriteContext, fireplaceRuntime: number) {
      const comfortState = context.unit.probeValues.get(context.comfortButtonKey);
      if (comfortState !== 1) {
        await this.writeComfort(context, 1);
      }
      await this.writeUpdate(context, {
        objectId: BACNET_OBJECTS.fireplaceVentilationRuntime,
        tag: BacnetEnums.ApplicationTags.UNSIGNED_INTEGER,
        value: fireplaceRuntime,
      });
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
      try {
        if (obj.values && obj.values[0] && obj.values[0].value && obj.values[0].value[0]) {
          return obj.values[0].value[0].value;
        }
      } catch (_e) { /* ignore */ }
      return undefined;
    }
}

export const Registry = new UnitRegistry();
