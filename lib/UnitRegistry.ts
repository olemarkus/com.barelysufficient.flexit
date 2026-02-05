import { getBacnetClient, BacnetEnums } from './bacnetClient';

// Helper to clamp values
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

interface FlexitDevice {
    getData(): { unitId: string, role: string };
    getSetting(key: string): string | number | boolean | null;
    setCapabilityValue(cap: string, value: any): Promise<void>;
    log(...args: any[]): void;
    error(...args: any[]): void;
}

const PRESENT_VALUE_ID = 85;
const OBJECT_TYPE = BacnetEnums.ObjectType;
const DEFAULT_FIREPLACE_VENTILATION_MINUTES = 10;
const DEFAULT_WRITE_PRIORITY = 13;

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

const MODE_PROBE_OBJECTS = new Map<string, string>([
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 361), 'Operation mode (MSV 361)'],
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 19), 'Actual ventilation mode (MSV 19)'],
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 41), 'Present operating mode (MSV 41)'],
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 42), 'Ventilation mode (MSV 42)'],
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 43), 'Manual operation condition (MSV 43)'],
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 44), 'Central condition trigger (MSV 44)'],
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 45), 'Comfort condition trigger (MSV 45)'],
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 46), 'Energy efficiency condition trigger (MSV 46)'],
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 319), 'Temporary ventilation operation (MSV 319)'],
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 320), 'Room climate op mode for room unit (MSV 320)'],
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 328), 'Room climate op mode input (MSV 328)'],
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 386), 'Operating mode output for RF (MSV 386)'],
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 583), 'Next room operating mode (MSV 583)'],
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 584), 'Room op mode determ for room unit (MSV 584)'],
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 585), 'Temporary room operating mode input (MSV 585)'],
  [objectKey(OBJECT_TYPE.POSITIVE_INTEGER_VALUE, 318), 'Comfort button delay (PIV 318)'],
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 357), 'Rapid ventilation trigger (MSV 357)'],
  [objectKey(OBJECT_TYPE.POSITIVE_INTEGER_VALUE, 293), 'Rapid ventilation runtime (PIV 293)'],
  [objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 360), 'Fireplace ventilation trigger (MSV 360)'],
  [objectKey(OBJECT_TYPE.POSITIVE_INTEGER_VALUE, 270), 'Fireplace ventilation runtime (PIV 270)'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 402), 'Cooker hood active (BV 402)'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 15), 'Rapid ventilation active'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 50), 'Home/Away comfort button'],
  [objectKey(OBJECT_TYPE.BINARY_INPUT, 82), 'Speed HIGH activate DI'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 400), 'Fireplace ventilation active'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 453), 'Temporary fireplace ventilation'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 454), 'Temporary rapid ventilation'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 452), 'Reset temporary ventilation operation'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 487), 'Reset temporary rapid ventilation from RF'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 488), 'Reset temporary fireplace ventilation from RF'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 455), 'Room operator unit button'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 475), 'Fireplace or fume hood input'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 474), 'Scheduler override'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 476), 'Backup comfort button'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 574), 'Delay for away active'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 575), 'Next operating mode'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 409), 'Fan available for ventilation'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 576), 'Scheduler reset/manual trigger'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 485), 'Temporary rapid ventilation request from RF'],
  [objectKey(OBJECT_TYPE.BINARY_VALUE, 486), 'Temporary fireplace ventilation request from RF'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1814), 'Time counter fireplace ventilation'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 2004), 'Time for temporary rapid ventilation'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 2007), 'Time for temporary fireplace ventilation'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 2005), 'Remaining time temporary ventilation op'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 2031), 'Remaining time rapid ventilation'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 2038), 'Remaining time fireplace ventilation'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1869), 'Fan ventilation request'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1870), 'Fan dehumidification request'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1913), 'Time counter STOP'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1914), 'Time counter AWAY'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1915), 'Time counter HOME'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1916), 'Time counter HIGH'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 2125), 'Operating mode input from RF system'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1835), 'Setpoint fan speed supply HIGH'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1836), 'Setpoint fan speed supply HOME'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1837), 'Setpoint fan speed supply AWAY'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1838), 'Setpoint fan speed supply FIRE'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1839), 'Setpoint fan speed supply COOKER'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1840), 'Setpoint fan speed extract HIGH'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1841), 'Setpoint fan speed extract HOME'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1842), 'Setpoint fan speed extract AWAY'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1843), 'Setpoint fan speed extract FIRE'],
  [objectKey(OBJECT_TYPE.ANALOG_VALUE, 1844), 'Setpoint fan speed extract COOKER'],
]);

const MODE_RF_INPUT_MAP: Record<number, 'home' | 'away' | 'high' | 'fireplace'> = {
  3: 'high',
  13: 'high',
  24: 'home',
  26: 'fireplace',
};

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

class UnitRegistry {
    private units: Map<string, {
        unitId: string;
        devices: Set<FlexitDevice>;
        pollInterval: NodeJS.Timeout | null;
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
    }> = new Map();

    register(unitId: string, device: FlexitDevice) {
      let unit = this.units.get(unitId);
      if (!unit) {
        const ip = String(device.getSetting('ip') || '').trim();
        const bacnetPort = Number(device.getSetting('bacnetPort') || 47808);

        unit = {
          unitId,
          devices: new Set(),
          pollInterval: null,
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
        };
        this.units.set(unitId, unit);

        // Start polling immediately
        this.pollUnit(unitId);
        // And set up interval
        unit.pollInterval = setInterval(() => this.pollUnit(unitId), 10000);
      }
      unit.devices.add(device);
    }

    unregister(unitId: string, device: FlexitDevice) {
      const unit = this.units.get(unitId);
      if (unit) {
        unit.devices.delete(device);
        if (unit.devices.size === 0) {
          if (unit.pollInterval) clearInterval(unit.pollInterval);
          this.units.delete(unitId);
        }
      }
    }

    async writeSetpoint(unitId: string, setpoint: number) {
      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');

      const client = getBacnetClient(unit.bacnetPort);
      const v = clamp(setpoint, 10, 30);
      const writeOptions = {
        maxSegments: BacnetEnums.MaxSegmentsAccepted.SEGMENTS_0, // no segmentation
        maxApdu: BacnetEnums.MaxApduLengthAccepted.OCTETS_1476,
        priority: DEFAULT_WRITE_PRIORITY, // required for Flexit BACnet objects with priority arrays
      };

      console.log(`[UnitRegistry] Writing setpoint ${v} to ${unitId} (${unit.ip})`);

      // Serialize writes for this unit
      unit.writeQueue = unit.writeQueue.then(async () => {
        return new Promise<void>((resolve, reject) => {
          let handled = false;
          const tm = setTimeout(() => {
            if (!handled) {
              handled = true;
              console.error(`[UnitRegistry] Timeout writing setpoint to ${unitId}`);
              reject(new Error('Timeout'));
            }
          }, 5000);

          const objectId = { type: 2, instance: 1994 };
          const presentValue = PRESENT_VALUE_ID;

          try {
            client.writeProperty(
              unit.ip,
              objectId,
              presentValue,
              [{ type: BacnetEnums.ApplicationTags.REAL, value: v }],
              writeOptions,
              (err: any, _value: any) => {
                if (handled) return;
                handled = true;
                clearTimeout(tm);

                if (err) {
                  console.error(`[UnitRegistry] Failed to write setpoint to ${unitId}:`, err);
                  reject(err);
                  return;
                }
                console.log(`[UnitRegistry] Successfully wrote setpoint ${v} to ${unitId}`);
                resolve();
              },
            );
          } catch (e) {
            if (!handled) {
              handled = true;
              clearTimeout(tm);
              console.error(`[UnitRegistry] Sync error writing setpoint to ${unitId}:`, e);
              reject(e);
            }
          }
        });
      });

      return unit.writeQueue;
    }

    private pollUnit(unitId: string) {
      const unit = this.units.get(unitId);
      if (!unit) return;

      const client = getBacnetClient(unit.bacnetPort);

      const requestArray = [
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1994 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint
        { objectId: { type: OBJECT_TYPE.ANALOG_INPUT, instance: 4 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Supply Temp
        { objectId: { type: OBJECT_TYPE.ANALOG_INPUT, instance: 1 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Outdoor Temp
        { objectId: { type: OBJECT_TYPE.ANALOG_INPUT, instance: 95 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Extract Temp
        { objectId: { type: OBJECT_TYPE.ANALOG_INPUT, instance: 96 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Humidity
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 194 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Heater Power

        // Fan & Filter
        { objectId: { type: OBJECT_TYPE.ANALOG_INPUT, instance: 5 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Fan RPM Supply
        { objectId: { type: OBJECT_TYPE.ANALOG_INPUT, instance: 12 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Fan RPM Extract
        { objectId: { type: OBJECT_TYPE.ANALOG_OUTPUT, instance: 3 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Fan Speed % Supply (AO 1:3)
        { objectId: { type: OBJECT_TYPE.ANALOG_OUTPUT, instance: 4 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Fan Speed % Extract (AO 1:4)
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 285 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Filter Time
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 286 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Filter Limit

        // Mode/comfort
        { objectId: BACNET_OBJECTS.comfortButton, properties: [{ id: PRESENT_VALUE_ID }] }, // Comfort button
        { objectId: BACNET_OBJECTS.comfortButtonDelay, properties: [{ id: PRESENT_VALUE_ID }] }, // Comfort delay
        { objectId: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 19 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Actual ventilation mode (MSV 19)
        { objectId: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 41 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Present operating mode (MSV 41)
        { objectId: BACNET_OBJECTS.ventilationMode, properties: [{ id: PRESENT_VALUE_ID }] }, // Ventilation mode (MSV 42)
        { objectId: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 43 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Manual operation condition (MSV 43)
        { objectId: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 44 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Central condition trigger (MSV 44)
        { objectId: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 45 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Comfort condition trigger (MSV 45)
        { objectId: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 46 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Energy efficiency condition trigger (MSV 46)
        { objectId: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 319 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Temporary ventilation operation (MSV 319)
        { objectId: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 320 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Room climate op mode for room unit (MSV 320)
        { objectId: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 328 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Room climate op mode input (MSV 328)
        { objectId: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 386 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Operating mode output for RF (MSV 386)
        { objectId: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 583 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Next room operating mode (MSV 583)
        { objectId: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 584 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Room op mode determ for room unit (MSV 584)
        { objectId: { type: OBJECT_TYPE.MULTI_STATE_VALUE, instance: 585 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Temporary room operating mode input (MSV 585)
        { objectId: BACNET_OBJECTS.operationMode, properties: [{ id: PRESENT_VALUE_ID }] }, // Operation mode (MSV 361)
        { objectId: BACNET_OBJECTS.rapidVentilationTrigger, properties: [{ id: PRESENT_VALUE_ID }] }, // Rapid ventilation trigger
        { objectId: BACNET_OBJECTS.rapidVentilationRuntime, properties: [{ id: PRESENT_VALUE_ID }] }, // Rapid ventilation runtime
        { objectId: BACNET_OBJECTS.fireplaceVentilationTrigger, properties: [{ id: PRESENT_VALUE_ID }] }, // Fireplace ventilation trigger
        { objectId: BACNET_OBJECTS.fireplaceVentilationRuntime, properties: [{ id: PRESENT_VALUE_ID }] }, // Fireplace ventilation runtime
        { objectId: BACNET_OBJECTS.cookerHood, properties: [{ id: PRESENT_VALUE_ID }] }, // Cooker hood active
        { objectId: { type: OBJECT_TYPE.BINARY_INPUT, instance: 82 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Speed HIGH activate DI
        { objectId: { type: OBJECT_TYPE.BINARY_VALUE, instance: 15 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Rapid ventilation active
        { objectId: BACNET_OBJECTS.fireplaceState, properties: [{ id: PRESENT_VALUE_ID }] }, // Fireplace ventilation active
        { objectId: BACNET_OBJECTS.rapidVentilationRemaining, properties: [{ id: PRESENT_VALUE_ID }] }, // Remaining rapid ventilation time
        { objectId: BACNET_OBJECTS.fireplaceVentilationRemaining, properties: [{ id: PRESENT_VALUE_ID }] }, // Remaining fireplace ventilation time
        { objectId: { type: OBJECT_TYPE.BINARY_VALUE, instance: 453 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Temporary fireplace ventilation
        { objectId: { type: OBJECT_TYPE.BINARY_VALUE, instance: 454 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Temporary rapid ventilation
        { objectId: BACNET_OBJECTS.resetTempVentOp, properties: [{ id: PRESENT_VALUE_ID }] }, // Reset temporary ventilation operation
        { objectId: BACNET_OBJECTS.resetTempRapidRf, properties: [{ id: PRESENT_VALUE_ID }] }, // Reset temporary rapid ventilation from RF
        { objectId: BACNET_OBJECTS.resetTempFireplaceRf, properties: [{ id: PRESENT_VALUE_ID }] }, // Reset temporary fireplace ventilation from RF
        { objectId: { type: OBJECT_TYPE.BINARY_VALUE, instance: 455 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Room operator unit button
        { objectId: { type: OBJECT_TYPE.BINARY_VALUE, instance: 475 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Fireplace or fume hood input
        { objectId: { type: OBJECT_TYPE.BINARY_VALUE, instance: 474 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Scheduler override
        { objectId: { type: OBJECT_TYPE.BINARY_VALUE, instance: 476 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Backup comfort button
        { objectId: { type: OBJECT_TYPE.BINARY_VALUE, instance: 574 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Delay for away active
        { objectId: { type: OBJECT_TYPE.BINARY_VALUE, instance: 575 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Next operating mode
        { objectId: { type: OBJECT_TYPE.BINARY_VALUE, instance: 409 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Fan available for ventilation
        { objectId: { type: OBJECT_TYPE.BINARY_VALUE, instance: 576 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Scheduler reset/manual trigger
        { objectId: { type: OBJECT_TYPE.BINARY_VALUE, instance: 485 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Temporary rapid ventilation request from RF
        { objectId: { type: OBJECT_TYPE.BINARY_VALUE, instance: 486 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Temporary fireplace ventilation request from RF
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1814 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Time counter fireplace ventilation
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 2004 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Time for temporary rapid ventilation
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 2007 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Time for temporary fireplace ventilation
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 2005 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Remaining time temporary ventilation op
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1869 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Fan ventilation request
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1870 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Fan dehumidification request
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1913 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Time counter STOP
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1914 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Time counter AWAY
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1915 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Time counter HOME
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1916 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Time counter HIGH
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 2125 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Operating mode input from RF system
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1835 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint fan speed supply HIGH
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1836 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint fan speed supply HOME
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1837 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint fan speed supply AWAY
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1838 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint fan speed supply FIRE
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1839 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint fan speed supply COOKER
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1840 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint fan speed extract HIGH
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1841 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint fan speed extract HOME
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1842 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint fan speed extract AWAY
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1843 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint fan speed extract FIRE
        { objectId: { type: OBJECT_TYPE.ANALOG_VALUE, instance: 1844 }, properties: [{ id: PRESENT_VALUE_ID }] }, // Setpoint fan speed extract COOKER
      ];

      const pollOnce = (attempt: number) => {
        // Wrap distinct polling action in try/catch to catch synchronous library errors
        try {
          console.log(`[UnitRegistry] Polling ${unitId} at ${unit.ip}...`);
          client.readPropertyMultiple(unit.ip, requestArray, (err: any, value: any) => {
            if (err) {
              const isTimeout = err?.code === 'ERR_TIMEOUT' || String(err?.message || '').includes('ERR_TIMEOUT');
              if (isTimeout && attempt === 0) {
                console.warn(`[UnitRegistry] Poll timeout for ${unitId}, retrying once...`);
                setTimeout(() => pollOnce(1), 1000);
                return;
              }
              console.error(`[UnitRegistry] Poll error for ${unitId}:`, err);
              return;
            }

            // console.log(`[UnitRegistry] Poll success for ${unitId}, parsing values...`);

            try {
              if (value && value.values) {
                unit.lastPollAt = Date.now();
                const data: any = {};
                const pollTime = unit.lastPollAt;
                value.values.forEach((obj: any) => {
                  const { type } = obj.objectId;
                  const { instance } = obj.objectId;
                  const val = this.extractValue(obj);
                  if (typeof val !== 'number') return;

                  if (type === OBJECT_TYPE.ANALOG_VALUE && instance === 1994) data.target_temperature = val;
                  if (type === OBJECT_TYPE.ANALOG_INPUT && instance === 4) data['measure_temperature'] = val; // Supply
                  if (type === OBJECT_TYPE.ANALOG_INPUT && instance === 1) data['measure_temperature.outdoor'] = val;
                  if (type === OBJECT_TYPE.ANALOG_INPUT && instance === 95) data['measure_temperature.extract'] = val;
                  if (type === OBJECT_TYPE.ANALOG_INPUT && instance === 96) data['measure_humidity'] = val;
                  if (type === OBJECT_TYPE.ANALOG_VALUE && instance === 194) data['measure_power'] = val * 1000; // kW -> W

                  // New points
                  if (type === OBJECT_TYPE.ANALOG_INPUT && instance === 5) data['measure_motor_rpm'] = val;
                  if (type === OBJECT_TYPE.ANALOG_INPUT && instance === 12) data['measure_motor_rpm.extract'] = val;
                  if (type === OBJECT_TYPE.ANALOG_OUTPUT && instance === 3) data['measure_fan_speed_percent'] = val; // 0-100
                  if (type === OBJECT_TYPE.ANALOG_OUTPUT && instance === 4) data['measure_fan_speed_percent.extract'] = val; // 0-100
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
                    console.warn(
                      `[UnitRegistry] Write error cleared for ${key}: now ${val} (was code ${pending.code})`,
                    );
                    unit.pendingWriteErrors.delete(key);
                  } else if (key === objectKey(BACNET_OBJECTS.ventilationMode.type, BACNET_OBJECTS.ventilationMode.instance) && unit.writeContext) {
                    const ctx = unit.writeContext.get(key);
                    if (ctx && ctx.value !== val && pollTime - ctx.at < 60000) {
                      console.warn(
                        `[UnitRegistry] Ventilation mode mismatch after write: expected ${ctx.value} for '${ctx.mode}', got ${val}`,
                      );
                      unit.writeContext.delete(key);
                    } else if (ctx && ctx.value === val) {
                      unit.writeContext.delete(key);
                    }
                  }

                  this.recordProbeValue(unit, type, instance, val);
                });

                this.distributeData(unit, data);
              }
            } catch (e) {
              console.error(`[UnitRegistry] Parse error for ${unitId}:`, e);
            }
          });
        } catch (error) {
          console.error(`[UnitRegistry] Synchronous internal error checking ${unitId}:`, error);
        }
      };

      pollOnce(0);
    }

    private distributeData(
      unit: {
        unitId?: string;
        devices: Set<FlexitDevice>;
        writeContext?: Map<string, { value: number; mode: string; at: number }>;
        deferredMode?: 'fireplace';
        deferredSince?: number;
        expectedMode?: string;
        expectedModeAt?: number;
        lastMismatchKey?: string;
      },
      data: any,
    ) {
      for (const device of unit.devices) {
        const { role } = device.getData();

        if (role === 'thermostat') {
          if (data.target_temperature !== undefined) device.setCapabilityValue('target_temperature', data.target_temperature).catch(() => { });
          if (data['measure_temperature'] !== undefined) device.setCapabilityValue('measure_temperature', data['measure_temperature']).catch(() => { });
          if (data['measure_temperature.outdoor'] !== undefined) device.setCapabilityValue('measure_temperature.outdoor', data['measure_temperature.outdoor']).catch(() => { });
          if (data['measure_temperature.extract'] !== undefined) device.setCapabilityValue('measure_temperature.extract', data['measure_temperature.extract']).catch(() => { });
          if (data['measure_power'] !== undefined) device.setCapabilityValue('measure_power', data['measure_power']).catch(() => { });
        } else if (role === 'fan') {
          if (data['measure_humidity'] !== undefined) device.setCapabilityValue('measure_humidity', data['measure_humidity']).catch(() => { });
          if (data['measure_motor_rpm'] !== undefined) device.setCapabilityValue('measure_motor_rpm', data['measure_motor_rpm']).catch(() => { });
          if (data['measure_motor_rpm.extract'] !== undefined) device.setCapabilityValue('measure_motor_rpm.extract', data['measure_motor_rpm.extract']).catch(() => { });
          if (data['measure_fan_speed_percent'] !== undefined) device.setCapabilityValue('measure_fan_speed_percent', data['measure_fan_speed_percent']).catch(() => { });
          if (data['measure_fan_speed_percent.extract'] !== undefined) device.setCapabilityValue('measure_fan_speed_percent.extract', data['measure_fan_speed_percent.extract']).catch(() => { });

          if (data['filter_time'] !== undefined && data['filter_limit'] !== undefined && data['filter_limit'] > 0) {
            const life = Math.max(0, (1 - (data['filter_time'] / data['filter_limit'])) * 100);
            device.setCapabilityValue('measure_hepa_filter', parseFloat(life.toFixed(1))).catch(() => { });
          }

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
            let mode = 'away';
            const rfMode = MODE_RF_INPUT_MAP[Math.round(data['mode_rf_input'] ?? NaN)];
            const tempOpActive = (data['remaining_temp_vent_op'] ?? 0) > 0;

            if (unit.deferredMode === 'fireplace' && !tempOpActive && data['rapid_active'] !== 1) {
              unit.deferredMode = undefined;
              unit.deferredSince = undefined;
              if (unit.unitId) {
                console.warn(`[UnitRegistry] Retrying deferred fireplace for ${unit.unitId}`);
                this.setFanMode(unit.unitId, 'fireplace').catch(() => { });
              }
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

            const expectedMode = unit.expectedMode;
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
                  const unitLabel = unit.unitId ?? 'unknown';
                  const delay = data['comfort_delay'] ?? 'unknown';
                  console.warn(
                    `[UnitRegistry] Away pending for ${unitLabel}: delay active (configured ${delay} min)`,
                  );
                }
              } else {
                const mismatchKey = `${expectedMode}->${mode}`;
                if (unit.lastMismatchKey !== mismatchKey) {
                  unit.lastMismatchKey = mismatchKey;
                  const unitLabel = unit.unitId ?? 'unknown';
                  console.warn(
                    `[UnitRegistry] Mode mismatch for ${unitLabel}: expected '${expectedMode}' got '${mode}'`,
                  );
                }
              }
            } else if (expectedMode && expectedMode === mode) {
              unit.lastMismatchKey = undefined;
            }

            device.setCapabilityValue('fan_mode', mode).catch(() => { });
          }
        }
      }
    }

    private recordProbeValue(
      unit: { probeValues: Map<string, number> },
      type: number,
      instance: number,
      value: number,
    ) {
      const key = `${type}:${instance}`;
      const label = MODE_PROBE_OBJECTS.get(key);
      if (!label) return;

      const prev = unit.probeValues.get(key);
      if (prev === undefined || prev !== value) {
        unit.probeValues.set(key, value);
        console.log(`[UnitRegistry] Probe ${label} (${key}) = ${value}`);
      }
    }

    async setFanMode(unitId: string, mode: string) {
      const unit = this.units.get(unitId);
      if (!unit) throw new Error('Unit not found');

      console.log(`[UnitRegistry] Setting fan mode to '${mode}' for ${unitId}`);
      const writeOptions = {
        maxSegments: BacnetEnums.MaxSegmentsAccepted.SEGMENTS_0,
        maxApdu: BacnetEnums.MaxApduLengthAccepted.OCTETS_1476,
        priority: 13,
      };

      unit.writeQueue = unit.writeQueue.then(async () => {
        const client = getBacnetClient(unit.bacnetPort);

        const writeUpdate = async (up: { objectId: { type: number; instance: number }; tag: number; value: number; priority?: number | null }) => {
          const writeKey = objectKey(up.objectId.type, up.objectId.instance);
          if (unit.blockedWrites.has(writeKey)) {
            console.warn(`[UnitRegistry] Skipping write ${writeKey} (write access denied previously)`);
            return false;
          }
          return new Promise<boolean>((resolve) => {
            let handled = false;
            const tm = setTimeout(() => {
              if (!handled) {
                handled = true;
                console.error(`[UnitRegistry] Timeout writing ${up.objectId.type}:${up.objectId.instance}`);
                resolve(false);
              }
            }, 5000);

            try {
              console.log(`[UnitRegistry] Writing ${up.objectId.type}:${up.objectId.instance} = ${up.value}`);
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
                    const match = message.match(/Code:(\d+)/);
                    const code = match ? Number(match[1]) : undefined;
                    if (code === 37) {
                      unit.lastWriteValues.set(writeKey, { value: up.value, at: now });
                      unit.pendingWriteErrors.set(writeKey, { value: up.value, code });
                      console.warn(`[UnitRegistry] Write returned Code:37 for ${writeKey}; will verify on next poll.`);
                      resolve(true);
                      return;
                    }
                    if (message.includes('Code:40') || message.includes('Code:9')) {
                      unit.lastWriteValues.set(writeKey, { value: up.value, at: now });
                      if (neverBlockKeys.has(writeKey)) {
                        console.warn(`[UnitRegistry] Write denied for ${writeKey}, but will keep retrying.`);
                      } else {
                        unit.blockedWrites.add(writeKey);
                        console.warn(`[UnitRegistry] Disabling writes for ${writeKey} due to device error.`);
                      }
                    } else {
                      console.error(
                        `[UnitRegistry] Failed to write ${up.objectId.type}:${up.objectId.instance} to ${up.value}`,
                        err,
                      );
                    }
                    resolve(false);
                  } else {
                    unit.lastWriteValues.set(writeKey, { value: up.value, at: now });
                    console.log(`[UnitRegistry] Successfully wrote ${up.objectId.type}:${up.objectId.instance} to ${up.value}`);
                    resolve(true);
                  }
                },
              );
            } catch (e) {
              if (!handled) {
                handled = true;
                clearTimeout(tm);
                console.error(`[UnitRegistry] Sync error writing ${up.objectId.type}:${up.objectId.instance}:`, e);
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
        const ventilationModeKey = objectKey(
          BACNET_OBJECTS.ventilationMode.type,
          BACNET_OBJECTS.ventilationMode.instance,
        );
        const comfortButtonKey = objectKey(OBJECT_TYPE.BINARY_VALUE, 50);
        const fireplaceTriggerKey = objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 360);
        const fireplaceRuntimeKey = objectKey(OBJECT_TYPE.POSITIVE_INTEGER_VALUE, 270);
        const rapidTriggerKey = objectKey(OBJECT_TYPE.MULTI_STATE_VALUE, 357);
        const neverBlockKeys = new Set<string>([
          ventilationModeKey,
          comfortButtonKey,
          fireplaceTriggerKey,
          fireplaceRuntimeKey,
          rapidTriggerKey,
        ]);

        // Ensure core control points are never permanently blocked.
        for (const key of neverBlockKeys) {
          unit.blockedWrites.delete(key);
        }

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
            console.log(`[UnitRegistry] Comfort button already ${value}, skipping write.`);
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
            console.log(`[UnitRegistry] Ventilation mode already ${value}, skipping write.`);
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

        const writeFireplaceTrigger = async (value: number, opts?: { priority?: number | null }) =>
          writeUpdate({
            objectId: BACNET_OBJECTS.fireplaceVentilationTrigger,
            tag: BacnetEnums.ApplicationTags.UNSIGNED_INTEGER,
            value,
            priority: opts?.priority,
          });

        const writeRapidTrigger = async (value: number, opts?: { priority?: number | null }) =>
          writeUpdate({
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
          console.warn(
            `[UnitRegistry] Fireplace requested while temporary ventilation is active (rapid=${rapidActive} temp=${tempVentActive}); proceeding anyway.`,
          );
        }

        unit.expectedMode = mode;
        unit.expectedModeAt = Date.now();
        unit.lastMismatchKey = undefined;

        const fireplaceActive = (unit.probeValues.get(objectKey(OBJECT_TYPE.BINARY_VALUE, 400)) ?? 0) === 1;
        const temporaryRapidActive = rapidActive || tempVentActive;
        if (mode !== 'fireplace' && fireplaceActive) {
          // Clear temporary fireplace trigger with a plain write.
          await writeFireplaceTrigger(TRIGGER_VALUE, { priority: null });
        }

        if (mode === 'home') {
          const comfortOk = await writeComfort(1);
          if (comfortOk && !unit.blockedWrites.has(ventilationModeKey)) {
            // Even if the unit reports HOME already, re-assert it to break out of temporary fireplace/high modes.
            await writeVentMode(VENTILATION_MODE_VALUES.HOME, { force: true });
          }
          if (temporaryRapidActive) {
            // Flexit app clears temporary rapid ventilation with a plain write when leaving timed high.
            await writeRapidTrigger(TRIGGER_VALUE, { priority: null });
          }
        } else if (mode === 'away') {
          // Always re-assert away when leaving fireplace to avoid snapping back to home.
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
            console.warn('[UnitRegistry] Ventilation mode write blocked; cannot set high mode.');
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
      } catch (e) { }
      return undefined;
    }
}

export const Registry = new UnitRegistry();
