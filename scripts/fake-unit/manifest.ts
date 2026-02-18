const Bacnet = require('bacstack');

const BacnetEnums = Bacnet.enum;

export const OBJECT_TYPE = BacnetEnums.ObjectType;
export const PROPERTY_ID = BacnetEnums.PropertyIdentifier;
export const APPLICATION_TAG = BacnetEnums.ApplicationTags;

export interface BacnetObjectId {
  type: number;
  instance: number;
}

export type ValueKind = 'real' | 'unsigned' | 'enum' | 'bool';

export interface SupportedPoint extends BacnetObjectId {
  key: string;
  name: string;
  description: string;
  kind: ValueKind;
  access: 'R' | 'RW';
  units?: string;
  min?: number;
  max?: number;
  source: 'xlsx' | 'observed';
  requiresPriority13?: boolean;
}

function objectType(name: string): number {
  const value = OBJECT_TYPE[name];
  if (typeof value !== 'number') throw new Error(`Unknown BACnet object type: ${name}`);
  return value;
}

export function pointKey(type: number, instance: number): string {
  return `${type}:${instance}`;
}

function point(
  key: string,
  typeName: string,
  instance: number,
  kind: ValueKind,
  access: 'R' | 'RW',
  source: 'xlsx' | 'observed',
  description: string,
  opts?: {
    min?: number;
    max?: number;
    units?: string;
    requiresPriority13?: boolean;
  },
): SupportedPoint {
  return {
    key,
    type: objectType(typeName),
    instance,
    kind,
    access,
    source,
    description,
    min: opts?.min,
    max: opts?.max,
    units: opts?.units,
    requiresPriority13: opts?.requiresPriority13,
    name: key,
  };
}

export const SUPPORTED_POINTS: SupportedPoint[] = [
  point('comfort_button', 'BINARY_VALUE', 50, 'enum', 'RW', 'xlsx', 'Comfort button', { min: 0, max: 1, requiresPriority13: true }),
  point('operation_mode', 'MULTI_STATE_VALUE', 361, 'enum', 'R', 'xlsx', 'Heat recovery ventilation state', { min: 1, max: 7 }),
  point('ventilation_mode', 'MULTI_STATE_VALUE', 42, 'enum', 'RW', 'xlsx', 'Room operating mode', { min: 1, max: 4, requiresPriority13: true }),
  point('setpoint_away', 'ANALOG_VALUE', 1985, 'real', 'RW', 'xlsx', 'Setpoint temperature when away', {
    min: 10, max: 30, units: 'degC', requiresPriority13: true,
  }),
  point('setpoint_home', 'ANALOG_VALUE', 1994, 'real', 'RW', 'xlsx', 'Setpoint temperature when home', {
    min: 10, max: 30, units: 'degC', requiresPriority13: true,
  }),
  point('remaining_fireplace', 'ANALOG_VALUE', 2038, 'real', 'R', 'xlsx', 'Remaining time of fireplace ventilation', { min: 0, max: 360, units: 'min' }),
  point('remaining_rapid', 'ANALOG_VALUE', 2031, 'real', 'R', 'xlsx', 'Remaining time of rapid ventilation', { min: 0, max: 360, units: 'min' }),
  point('runtime_fireplace', 'POSITIVE_INTEGER_VALUE', 270, 'unsigned', 'RW', 'xlsx', 'Fireplace ventilation runtime', { min: 1, max: 360, units: 'min' }),
  point('runtime_rapid', 'POSITIVE_INTEGER_VALUE', 293, 'unsigned', 'RW', 'xlsx', 'Rapid ventilation runtime', { min: 1, max: 360, units: 'min' }),
  point('trigger_fireplace', 'MULTI_STATE_VALUE', 360, 'enum', 'RW', 'xlsx', 'Trigger temporary fireplace ventilation', { min: 1, max: 2 }),
  point('trigger_rapid', 'MULTI_STATE_VALUE', 357, 'enum', 'RW', 'xlsx', 'Trigger temporary rapid ventilation', { min: 1, max: 2 }),
  point('away_delay_timer', 'POSITIVE_INTEGER_VALUE', 318, 'unsigned', 'RW', 'xlsx', 'Away delay timer duration', { min: 0, max: 600, units: 'min' }),
  point('fan_rpm_extract', 'ANALOG_INPUT', 12, 'real', 'R', 'xlsx', 'Exhaust air fan speed feedback', { min: 0, max: 18000, units: 'rpm' }),
  point('fan_rpm_supply', 'ANALOG_INPUT', 5, 'real', 'R', 'xlsx', 'Supply air fan speed feedback', { min: 0, max: 18000, units: 'rpm' }),
  point('extract_pressure', 'ANALOG_INPUT', 72, 'real', 'R', 'xlsx', 'Extract air pressure', { min: -3000, max: 3000, units: 'Pa' }),
  point('supply_pressure', 'ANALOG_INPUT', 73, 'real', 'R', 'xlsx', 'Supply air pressure', { min: -3000, max: 3000, units: 'Pa' }),
  point('temp_exhaust', 'ANALOG_INPUT', 11, 'real', 'R', 'xlsx', 'Exhaust air temperature', { min: -50, max: 80, units: 'degC' }),
  point('temp_extract_doc', 'ANALOG_INPUT', 59, 'real', 'R', 'xlsx', 'Extract air temperature (documented)', { min: -50, max: 80, units: 'degC' }),
  point('temp_frost_protection', 'ANALOG_INPUT', 31, 'real', 'R', 'xlsx', 'Frost protection temperature for heating coil', { min: -30, max: 80, units: 'degC' }),
  point('temp_outside', 'ANALOG_INPUT', 1, 'real', 'R', 'xlsx', 'Outside air temperature', { min: -50, max: 50, units: 'degC' }),
  point('temp_room', 'ANALOG_INPUT', 75, 'real', 'R', 'xlsx', 'Room temperature', { min: 0, max: 50, units: 'degC' }),
  point('humidity_room_1', 'ANALOG_VALUE', 2093, 'real', 'R', 'xlsx', 'Room air humidity 1', { min: 0, max: 100, units: '%' }),
  point('humidity_room_2', 'ANALOG_VALUE', 2094, 'real', 'R', 'xlsx', 'Room air humidity 2', { min: 0, max: 100, units: '%' }),
  point('humidity_room_3', 'ANALOG_VALUE', 2095, 'real', 'R', 'xlsx', 'Room air humidity 3', { min: 0, max: 100, units: '%' }),
  point('air_quality_input', 'ANALOG_INPUT', 50, 'real', 'R', 'xlsx', 'Room air quality input value', { min: 0, max: 2000, units: 'ppm' }),
  point('temp_supply', 'ANALOG_INPUT', 4, 'real', 'R', 'xlsx', 'Supply air temperature', { min: -50, max: 80, units: 'degC' }),
  point('fan_speed_extract_percent', 'ANALOG_OUTPUT', 4, 'real', 'R', 'xlsx', 'Exhaust air fan speed', { min: 0, max: 100, units: '%' }),
  point('fan_speed_supply_percent', 'ANALOG_OUTPUT', 3, 'real', 'R', 'xlsx', 'Supply air fan speed', { min: 0, max: 100, units: '%' }),
  point('heater_electric_position_percent', 'ANALOG_OUTPUT', 29, 'real', 'R', 'xlsx', 'Heating coil electric position', { min: 0, max: 100, units: '%' }),
  point('heater_valve_position_percent', 'ANALOG_OUTPUT', 12, 'real', 'R', 'xlsx', 'Heating coil valve position', { min: 0, max: 100, units: '%' }),
  point('rotor_speed_percent', 'ANALOG_OUTPUT', 0, 'real', 'R', 'xlsx', 'Rotary heat exchanger speed', { min: 0, max: 100, units: '%' }),
  point('filter_operating_time', 'ANALOG_VALUE', 285, 'real', 'R', 'xlsx', 'Operating time filter', { min: 0, max: 99999, units: 'h' }),
  point('filter_exchange_limit', 'ANALOG_VALUE', 286, 'real', 'R', 'xlsx', 'Operating time for filter replacement', { min: 0, max: 99990, units: 'h' }),

  // Observed points used by current Nordic integrations and packet dumps.
  point('temp_extract', 'ANALOG_INPUT', 95, 'real', 'R', 'observed', 'Extract air temperature (observed)', { min: -50, max: 80, units: 'degC' }),
  point('humidity_extract', 'ANALOG_INPUT', 96, 'real', 'R', 'observed', 'Relative humidity for extract air (observed)', { min: 0, max: 100, units: '%' }),
  point('heater_power_kw', 'ANALOG_VALUE', 194, 'real', 'R', 'observed', 'Heating coil electric power', { min: 0, max: 10, units: 'kW' }),
  point('rapid_active', 'BINARY_VALUE', 15, 'enum', 'R', 'observed', 'Rapid ventilation active', { min: 0, max: 1 }),
  point('fireplace_active', 'BINARY_VALUE', 400, 'enum', 'R', 'observed', 'Fireplace ventilation active', { min: 0, max: 1 }),
  point('remaining_temp_vent', 'ANALOG_VALUE', 2005, 'real', 'R', 'observed', 'Remaining temporary ventilation time', { min: 0, max: 360, units: 'min' }),
  point('mode_rf_input', 'ANALOG_VALUE', 2125, 'real', 'R', 'observed', 'Operating mode input from RF', { min: 0, max: 100 }),
  point('away_delay_active', 'BINARY_VALUE', 574, 'enum', 'R', 'observed', 'Away delay active', { min: 0, max: 1 }),
  point('cooker_hood', 'BINARY_VALUE', 402, 'enum', 'RW', 'observed', 'Cooker hood active', { min: 0, max: 1, requiresPriority13: true }),
];

const dedup = new Map<string, SupportedPoint>();
for (const pointDef of SUPPORTED_POINTS) dedup.set(pointKey(pointDef.type, pointDef.instance), pointDef);
export const POINTS_BY_OBJECT = dedup;

export const DEFAULT_VENDOR_ID = 783;
export const DEFAULT_VENDOR_NAME = 'Flexit';
export const DEFAULT_DEVICE_NAME = 'HvacFnct21y_A';
export const DEFAULT_MODEL_NAME = 'Flexit Nordic';
export const DEFAULT_FIRMWARE = '03.39.03.38';
export const DEFAULT_SERIAL = '800131-123456';
export const DEFAULT_MAC = '00:05:19:22:27:43';
export const DEFAULT_BACNET_DEVICE_ID = 2;

export const VENTILATION_MODE_VALUES = {
  STOP: 1,
  AWAY: 2,
  HOME: 3,
  HIGH: 4,
} as const;

export const OPERATION_MODE_VALUES = {
  OFF: 1,
  AWAY: 2,
  HOME: 3,
  HIGH: 4,
  COOKER_HOOD: 5,
  FIREPLACE: 6,
  TEMPORARY_HIGH: 7,
} as const;

export type FanMode = 'away' | 'home' | 'high' | 'fireplace';

export const MODE_RF_VALUES: Record<FanMode, number> = {
  away: 2,
  home: 24,
  high: 13,
  fireplace: 26,
};

export function valueTagForPoint(pointDef: SupportedPoint): number {
  switch (pointDef.kind) {
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

export function clamp(value: number, min?: number, max?: number): number {
  let out = value;
  if (typeof min === 'number') out = Math.max(min, out);
  if (typeof max === 'number') out = Math.min(max, out);
  return out;
}

function key(typeName: string, instance: number): string {
  return pointKey(objectType(typeName), instance);
}

export const DEFAULT_POINT_VALUES: Record<string, number> = {
  [key('BINARY_VALUE', 50)]: 1,
  [key('MULTI_STATE_VALUE', 361)]: OPERATION_MODE_VALUES.HOME,
  [key('MULTI_STATE_VALUE', 42)]: VENTILATION_MODE_VALUES.HOME,
  [key('ANALOG_VALUE', 1985)]: 18,
  [key('ANALOG_VALUE', 1994)]: 20,
  [key('ANALOG_VALUE', 2038)]: 0,
  [key('ANALOG_VALUE', 2031)]: 0,
  [key('POSITIVE_INTEGER_VALUE', 270)]: 10,
  [key('POSITIVE_INTEGER_VALUE', 293)]: 10,
  [key('MULTI_STATE_VALUE', 360)]: 1,
  [key('MULTI_STATE_VALUE', 357)]: 1,
  [key('POSITIVE_INTEGER_VALUE', 318)]: 30,
  [key('ANALOG_INPUT', 12)]: 3000,
  [key('ANALOG_INPUT', 5)]: 3100,
  [key('ANALOG_INPUT', 72)]: 0,
  [key('ANALOG_INPUT', 73)]: 0,
  [key('ANALOG_INPUT', 11)]: 17,
  [key('ANALOG_INPUT', 59)]: 21,
  [key('ANALOG_INPUT', 31)]: 5,
  [key('ANALOG_INPUT', 1)]: 2,
  [key('ANALOG_INPUT', 75)]: 21.5,
  [key('ANALOG_VALUE', 2093)]: 35,
  [key('ANALOG_VALUE', 2094)]: 36,
  [key('ANALOG_VALUE', 2095)]: 37,
  [key('ANALOG_INPUT', 50)]: 700,
  [key('ANALOG_INPUT', 4)]: 19.5,
  [key('ANALOG_OUTPUT', 4)]: 79,
  [key('ANALOG_OUTPUT', 3)]: 80,
  [key('ANALOG_OUTPUT', 29)]: 30,
  [key('ANALOG_OUTPUT', 12)]: 0,
  [key('ANALOG_OUTPUT', 0)]: 55,
  [key('ANALOG_VALUE', 285)]: 1200,
  [key('ANALOG_VALUE', 286)]: 4380,
  [key('ANALOG_INPUT', 95)]: 21,
  [key('ANALOG_INPUT', 96)]: 34,
  [key('ANALOG_VALUE', 194)]: 0.3,
  [key('BINARY_VALUE', 15)]: 0,
  [key('BINARY_VALUE', 400)]: 0,
  [key('ANALOG_VALUE', 2005)]: 0,
  [key('ANALOG_VALUE', 2125)]: MODE_RF_VALUES.home,
  [key('BINARY_VALUE', 574)]: 0,
  [key('BINARY_VALUE', 402)]: 0,
};

export interface DevicePropertyDefinition {
  id: number;
  name: string;
  kind: 'string' | 'unsigned' | 'enum' | 'objectId' | 'objectIdArray' | 'bitstring';
}

export const DEVICE_OBJECT_TYPE = OBJECT_TYPE.DEVICE;

export const SUPPORTED_DEVICE_PROPERTIES: DevicePropertyDefinition[] = [
  { id: PROPERTY_ID.OBJECT_IDENTIFIER, name: 'object_identifier', kind: 'objectId' },
  { id: PROPERTY_ID.OBJECT_NAME, name: 'object_name', kind: 'string' },
  { id: PROPERTY_ID.OBJECT_TYPE, name: 'object_type', kind: 'enum' },
  { id: PROPERTY_ID.DESCRIPTION, name: 'description', kind: 'string' },
  { id: PROPERTY_ID.MODEL_NAME, name: 'model_name', kind: 'string' },
  { id: PROPERTY_ID.VENDOR_NAME, name: 'vendor_name', kind: 'string' },
  { id: PROPERTY_ID.FIRMWARE_REVISION, name: 'firmware_revision', kind: 'string' },
  { id: PROPERTY_ID.APPLICATION_SOFTWARE_VERSION, name: 'application_software_version', kind: 'string' },
  { id: PROPERTY_ID.PROTOCOL_VERSION, name: 'protocol_version', kind: 'unsigned' },
  { id: PROPERTY_ID.PROTOCOL_REVISION, name: 'protocol_revision', kind: 'unsigned' },
  { id: PROPERTY_ID.PROTOCOL_SERVICES_SUPPORTED, name: 'protocol_services_supported', kind: 'bitstring' },
  { id: PROPERTY_ID.PROTOCOL_OBJECT_TYPES_SUPPORTED, name: 'protocol_object_types_supported', kind: 'bitstring' },
  { id: PROPERTY_ID.MAX_APDU_LENGTH_ACCEPTED, name: 'max_apdu_length_accepted', kind: 'unsigned' },
  { id: PROPERTY_ID.SEGMENTATION_SUPPORTED, name: 'segmentation_supported', kind: 'enum' },
  { id: PROPERTY_ID.VENDOR_IDENTIFIER, name: 'vendor_identifier', kind: 'unsigned' },
  { id: PROPERTY_ID.SYSTEM_STATUS, name: 'system_status', kind: 'enum' },
  { id: PROPERTY_ID.APDU_TIMEOUT, name: 'apdu_timeout', kind: 'unsigned' },
  { id: PROPERTY_ID.NUMBER_OF_APDU_RETRIES, name: 'number_of_apdu_retries', kind: 'unsigned' },
  { id: PROPERTY_ID.DATABASE_REVISION, name: 'database_revision', kind: 'unsigned' },
  { id: PROPERTY_ID.MAX_INFO_FRAMES, name: 'max_info_frames', kind: 'unsigned' },
  { id: PROPERTY_ID.MAX_MASTER, name: 'max_master', kind: 'unsigned' },
  { id: PROPERTY_ID.OBJECT_LIST, name: 'object_list', kind: 'objectIdArray' },
];

// Common (non-device) object properties exposed by this fake unit.
// Some properties (UNITS, MIN/MAX) are only returned when the point definition specifies them.
export const SUPPORTED_POINT_PROPERTY_IDS: number[] = [
  PROPERTY_ID.OBJECT_IDENTIFIER,
  PROPERTY_ID.OBJECT_NAME,
  PROPERTY_ID.OBJECT_TYPE,
  PROPERTY_ID.DESCRIPTION,
  PROPERTY_ID.PRESENT_VALUE,
  PROPERTY_ID.UNITS,
  PROPERTY_ID.MIN_PRES_VALUE,
  PROPERTY_ID.MAX_PRES_VALUE,
  PROPERTY_ID.STATUS_FLAGS,
  PROPERTY_ID.OUT_OF_SERVICE,
  PROPERTY_ID.RELIABILITY,
  PROPERTY_ID.EVENT_STATE,
];

// Proprietary compatibility surface used by Flexit GO login flow.
// These are intentionally kept separate from documented BACnet points/properties.
export const FLEXIT_GO_COMPAT_DEVICE_INSTANCE = 2;
export const FLEXIT_GO_LOGIN_OBJECT_TYPE = 264;
export const FLEXIT_GO_LOGIN_OBJECT_INSTANCE = 2;
export const FLEXIT_GO_LOGIN_PROPERTY_ID = 4743;
export const FLEXIT_GO_STATE_1_OBJECT_TYPE = OBJECT_TYPE.ANALOG_VALUE;
export const FLEXIT_GO_STATE_1_OBJECT_INSTANCE = 2275;
export const FLEXIT_GO_STATE_1_DEFAULT_VALUE = 0;
export const FLEXIT_GO_PRIORITY_HINT_PROPERTY_ID = 5093;
export const FLEXIT_GO_PRIORITY_HINT_VALUE = 13;
export const FLEXIT_GO_RANGE_MAX_PROPERTY_ID = 5037;
export const FLEXIT_GO_RANGE_MIN_PROPERTY_ID = 5036;

export interface FlexitGoCompatPropertyDefinition {
  id: number;
  name: string;
  tag: number;
  value: number | string;
  description: string;
}

export interface FlexitGoCompatObjectDefinition {
  objectType: number;
  instance: number;
  objectName: string;
  description: string;
  properties: FlexitGoCompatPropertyDefinition[];
}

export interface FlexitGoCompatPropertyOverlayDefinition {
  objectType: number;
  instance: number;
  properties: FlexitGoCompatPropertyDefinition[];
}

// Static proprietary objects observed from the real unit during Flexit GO login.
export const FLEXIT_GO_STATIC_COMPAT_OBJECTS: FlexitGoCompatObjectDefinition[] = [{
  objectType: FLEXIT_GO_STATE_1_OBJECT_TYPE,
  instance: FLEXIT_GO_STATE_1_OBJECT_INSTANCE,
  objectName: 'HdwCnf.Sta1',
  description: 'State 1 (Flexit GO compatibility)',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: FLEXIT_GO_STATE_1_DEFAULT_VALUE,
    description: 'Flexit GO proprietary state point (AV 2275)',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 8,
  objectName: 'Compat.Av8',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 0,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 126,
  objectName: 'Compat.Av126',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 16,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 130,
  objectName: 'Compat.Av130',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 0,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 60,
  objectName: 'Compat.Av60',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 70,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 1831,
  objectName: 'Compat.Av1831',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 700,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 1833,
  objectName: 'Compat.Av1833',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 700,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 1834,
  objectName: 'Compat.Av1834',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 700,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 1835,
  objectName: 'Compat.Av1835',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 100,
    description: 'Observed from real unit',
  }, {
    id: FLEXIT_GO_RANGE_MAX_PROPERTY_ID,
    name: 'range_max',
    tag: APPLICATION_TAG.REAL,
    value: 100,
    description: 'Observed proprietary AV range hint',
  }, {
    id: FLEXIT_GO_RANGE_MIN_PROPERTY_ID,
    name: 'range_min',
    tag: APPLICATION_TAG.REAL,
    value: 80,
    description: 'Observed proprietary AV range hint',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 1836,
  objectName: 'Compat.Av1836',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 80,
    description: 'Observed from real unit',
  }, {
    id: FLEXIT_GO_RANGE_MAX_PROPERTY_ID,
    name: 'range_max',
    tag: APPLICATION_TAG.REAL,
    value: 100,
    description: 'Observed proprietary AV range hint',
  }, {
    id: FLEXIT_GO_RANGE_MIN_PROPERTY_ID,
    name: 'range_min',
    tag: APPLICATION_TAG.REAL,
    value: 56,
    description: 'Observed proprietary AV range hint',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 1837,
  objectName: 'Compat.Av1837',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 56,
    description: 'Observed from real unit',
  }, {
    id: FLEXIT_GO_RANGE_MAX_PROPERTY_ID,
    name: 'range_max',
    tag: APPLICATION_TAG.REAL,
    value: 80,
    description: 'Observed proprietary AV range hint',
  }, {
    id: FLEXIT_GO_RANGE_MIN_PROPERTY_ID,
    name: 'range_min',
    tag: APPLICATION_TAG.REAL,
    value: 30,
    description: 'Observed proprietary AV range hint',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 1838,
  objectName: 'Compat.Av1838',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 90,
    description: 'Observed from real unit',
  }, {
    id: FLEXIT_GO_RANGE_MAX_PROPERTY_ID,
    name: 'range_max',
    tag: APPLICATION_TAG.REAL,
    value: 100,
    description: 'Observed proprietary AV range hint',
  }, {
    id: FLEXIT_GO_RANGE_MIN_PROPERTY_ID,
    name: 'range_min',
    tag: APPLICATION_TAG.REAL,
    value: 30,
    description: 'Observed proprietary AV range hint',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 1839,
  objectName: 'Compat.Av1839',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 90,
    description: 'Observed from real unit',
  }, {
    id: FLEXIT_GO_RANGE_MAX_PROPERTY_ID,
    name: 'range_max',
    tag: APPLICATION_TAG.REAL,
    value: 100,
    description: 'Observed proprietary AV range hint',
  }, {
    id: FLEXIT_GO_RANGE_MIN_PROPERTY_ID,
    name: 'range_min',
    tag: APPLICATION_TAG.REAL,
    value: 30,
    description: 'Observed proprietary AV range hint',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 1840,
  objectName: 'Compat.Av1840',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 99,
    description: 'Observed from real unit',
  }, {
    id: FLEXIT_GO_RANGE_MAX_PROPERTY_ID,
    name: 'range_max',
    tag: APPLICATION_TAG.REAL,
    value: 100,
    description: 'Observed proprietary AV range hint',
  }, {
    id: FLEXIT_GO_RANGE_MIN_PROPERTY_ID,
    name: 'range_min',
    tag: APPLICATION_TAG.REAL,
    value: 79,
    description: 'Observed proprietary AV range hint',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 1841,
  objectName: 'Compat.Av1841',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 79,
    description: 'Observed from real unit',
  }, {
    id: FLEXIT_GO_RANGE_MAX_PROPERTY_ID,
    name: 'range_max',
    tag: APPLICATION_TAG.REAL,
    value: 99,
    description: 'Observed proprietary AV range hint',
  }, {
    id: FLEXIT_GO_RANGE_MIN_PROPERTY_ID,
    name: 'range_min',
    tag: APPLICATION_TAG.REAL,
    value: 55,
    description: 'Observed proprietary AV range hint',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 1842,
  objectName: 'Compat.Av1842',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 55,
    description: 'Observed from real unit',
  }, {
    id: FLEXIT_GO_RANGE_MAX_PROPERTY_ID,
    name: 'range_max',
    tag: APPLICATION_TAG.REAL,
    value: 79,
    description: 'Observed proprietary AV range hint',
  }, {
    id: FLEXIT_GO_RANGE_MIN_PROPERTY_ID,
    name: 'range_min',
    tag: APPLICATION_TAG.REAL,
    value: 30,
    description: 'Observed proprietary AV range hint',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 1843,
  objectName: 'Compat.Av1843',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 50,
    description: 'Observed from real unit',
  }, {
    id: FLEXIT_GO_RANGE_MAX_PROPERTY_ID,
    name: 'range_max',
    tag: APPLICATION_TAG.REAL,
    value: 100,
    description: 'Observed proprietary AV range hint',
  }, {
    id: FLEXIT_GO_RANGE_MIN_PROPERTY_ID,
    name: 'range_min',
    tag: APPLICATION_TAG.REAL,
    value: 30,
    description: 'Observed proprietary AV range hint',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 1844,
  objectName: 'Compat.Av1844',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 50,
    description: 'Observed from real unit',
  }, {
    id: FLEXIT_GO_RANGE_MAX_PROPERTY_ID,
    name: 'range_max',
    tag: APPLICATION_TAG.REAL,
    value: 100,
    description: 'Observed proprietary AV range hint',
  }, {
    id: FLEXIT_GO_RANGE_MIN_PROPERTY_ID,
    name: 'range_min',
    tag: APPLICATION_TAG.REAL,
    value: 30,
    description: 'Observed proprietary AV range hint',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 2096,
  objectName: 'Compat.Av2096',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 0,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 1919,
  objectName: 'Compat.Av1919',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 0,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 2090,
  objectName: 'Compat.Av2090',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 22.999996185302734,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 2113,
  objectName: 'Compat.Av2113',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 2441,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 2114,
  objectName: 'Compat.Av2114',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 1213,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 2115,
  objectName: 'Compat.Av2115',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 2001,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 2118,
  objectName: 'Compat.Av2118',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 205,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 2119,
  objectName: 'Compat.Av2119',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 211,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 2120,
  objectName: 'Compat.Av2120',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 104,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 2121,
  objectName: 'Compat.Av2121',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 1242,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.ANALOG_VALUE,
  instance: 2122,
  objectName: 'Compat.Av2122',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.REAL,
    value: 212,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.MULTI_STATE_VALUE,
  instance: 7,
  objectName: 'Compat.Msv7',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.UNSIGNED_INTEGER,
    value: 1,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.MULTI_STATE_VALUE,
  instance: 18,
  objectName: 'Compat.Msv18',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.UNSIGNED_INTEGER,
    value: 1,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.MULTI_STATE_VALUE,
  instance: 340,
  objectName: 'Compat.Msv340',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.UNSIGNED_INTEGER,
    value: 1,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.MULTI_STATE_VALUE,
  instance: 341,
  objectName: 'Compat.Msv341',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.UNSIGNED_INTEGER,
    value: 1,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.MULTI_STATE_VALUE,
  instance: 343,
  objectName: 'Compat.Msv343',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.UNSIGNED_INTEGER,
    value: 1,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.MULTI_STATE_VALUE,
  instance: 344,
  objectName: 'Compat.Msv344',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.UNSIGNED_INTEGER,
    value: 1,
    description: 'Observed from real unit',
  }],
}, {
  objectType: OBJECT_TYPE.BINARY_VALUE,
  instance: 474,
  objectName: 'Compat.Bv474',
  description: 'Observed proprietary login state',
  properties: [{
    id: PROPERTY_ID.PRESENT_VALUE,
    name: 'present_value',
    tag: APPLICATION_TAG.ENUMERATED,
    value: 0,
    description: 'Observed from real unit',
  }],
}];

// Proprietary property overlays on documented points.
export const FLEXIT_GO_PROPRIETARY_PROPERTY_OVERLAYS: FlexitGoCompatPropertyOverlayDefinition[] = [{
  objectType: OBJECT_TYPE.MULTI_STATE_VALUE,
  instance: 42,
  properties: [{
    id: FLEXIT_GO_PRIORITY_HINT_PROPERTY_ID,
    name: 'priority_hint',
    tag: APPLICATION_TAG.UNSIGNED_INTEGER,
    value: FLEXIT_GO_PRIORITY_HINT_VALUE,
    description: 'Observed proprietary priority hint',
  }],
}, {
  objectType: OBJECT_TYPE.BINARY_VALUE,
  instance: 50,
  properties: [{
    id: FLEXIT_GO_PRIORITY_HINT_PROPERTY_ID,
    name: 'priority_hint',
    tag: APPLICATION_TAG.UNSIGNED_INTEGER,
    value: FLEXIT_GO_PRIORITY_HINT_VALUE,
    description: 'Observed proprietary priority hint',
  }],
}];

export const FLEXIT_GO_PROPRIETARY_COMPAT = {
  deviceInstanceAlias: FLEXIT_GO_COMPAT_DEVICE_INSTANCE,
  deviceAliasOverrides: [{
    propertyId: PROPERTY_ID.DESCRIPTION,
    description: 'Returns serial number for DEVICE:2',
  }, {
    propertyId: PROPERTY_ID.MODEL_NAME,
    description: 'Returns platform version (e.g. POS3.67) for DEVICE:2',
  }, {
    propertyId: PROPERTY_ID.APPLICATION_SOFTWARE_VERSION,
    description: 'Returns discovery app version (e.g. 2.11.0) for DEVICE:2',
  }],
  objects: [{
    objectType: FLEXIT_GO_LOGIN_OBJECT_TYPE,
    instance: FLEXIT_GO_LOGIN_OBJECT_INSTANCE,
    objectName: 'FlexitGoLogin',
    description: 'Flexit GO proprietary login object',
    properties: [{
      id: FLEXIT_GO_LOGIN_PROPERTY_ID,
      name: 'login_state',
      tag: APPLICATION_TAG.CHARACTER_STRING,
      value: '<derived from serial>',
      description: 'Flexit GO proprietary login property (compatibility shim)',
    }],
  }, ...FLEXIT_GO_STATIC_COMPAT_OBJECTS],
  propertyOverlays: FLEXIT_GO_PROPRIETARY_PROPERTY_OVERLAYS,
} as const;
