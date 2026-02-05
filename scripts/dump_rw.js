#!/usr/bin/env node
/* eslint-disable no-console */
const Bacnet = require('bacstack');

const BacnetEnums = Bacnet.enum;

const ip = process.argv[2];
const deviceId = Number(process.argv[3] || 2);
const localPort = Number(process.argv[4] || 47809);

if (!ip) {
  console.error('Usage: node scripts/dump_rw.js <ip> [deviceId=2] [localPort=47809]');
  process.exit(1);
}

const client = new Bacnet({
  port: localPort,
  apduTimeout: 10000,
  apduSize: 1476,
});

const PRESENT_VALUE = BacnetEnums.PropertyIdentifier.PRESENT_VALUE ?? 85;
const OBJECT_LIST = BacnetEnums.PropertyIdentifier.OBJECT_LIST ?? 76;

const WRITABLE_TYPES = new Set([
  BacnetEnums.ObjectType.ANALOG_VALUE,
  BacnetEnums.ObjectType.ANALOG_OUTPUT,
  BacnetEnums.ObjectType.BINARY_VALUE,
  BacnetEnums.ObjectType.BINARY_OUTPUT,
  BacnetEnums.ObjectType.MULTI_STATE_VALUE,
  BacnetEnums.ObjectType.MULTI_STATE_OUTPUT,
  BacnetEnums.ObjectType.POSITIVE_INTEGER_VALUE,
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractSingleValue(res) {
  const values = res?.values?.[0]?.value;
  if (values === undefined) return undefined;
  if (!Array.isArray(values)) return values;
  if (values.length === 0) return undefined;
  if (values.length === 1 && Object.prototype.hasOwnProperty.call(values[0], 'value')) {
    return values[0].value;
  }
  return values.map((v) => (Object.prototype.hasOwnProperty.call(v, 'value') ? v.value : v));
}

function readProperty(objectId, propertyId, options = {}) {
  return new Promise((resolve, reject) => {
    client.readProperty(ip, objectId, propertyId, options, (err, value) => {
      if (err) return reject(err);
      resolve(value);
    });
  });
}

function writeProperty(objectId, tag, value, priority = 16) {
  return new Promise((resolve, reject) => {
    const options = {
      maxSegments: BacnetEnums.MaxSegmentsAccepted.SEGMENTS_0,
      maxApdu: BacnetEnums.MaxApduLengthAccepted.OCTETS_1476,
      priority,
    };
    client.writeProperty(
      ip,
      objectId,
      PRESENT_VALUE,
      [{ type: tag, value }],
      options,
      (err) => {
        if (err) return reject(err);
        resolve(undefined);
      },
    );
  });
}

function tagForType(type) {
  if (type === BacnetEnums.ObjectType.BINARY_VALUE || type === BacnetEnums.ObjectType.BINARY_OUTPUT) {
    return BacnetEnums.ApplicationTags.ENUMERATED;
  }
  if (
    type === BacnetEnums.ObjectType.MULTI_STATE_VALUE
    || type === BacnetEnums.ObjectType.MULTI_STATE_OUTPUT
    || type === BacnetEnums.ObjectType.POSITIVE_INTEGER_VALUE
  ) {
    return BacnetEnums.ApplicationTags.UNSIGNED_INTEGER;
  }
  return BacnetEnums.ApplicationTags.REAL;
}

async function main() {
  const deviceObject = { type: BacnetEnums.ObjectType.DEVICE, instance: deviceId };

  let objectCount;
  try {
    const res = await readProperty(deviceObject, OBJECT_LIST, { arrayIndex: 0 });
    objectCount = Number(extractSingleValue(res));
  } catch (err) {
    console.error('Failed to read object list length:', err?.message || err);
    process.exit(2);
  }

  if (!Number.isFinite(objectCount) || objectCount <= 0) {
    console.error('Object list length invalid:', objectCount);
    process.exit(2);
  }

  const rw = [];
  const ro = [];
  const unknown = [];

  for (let i = 1; i <= objectCount; i += 1) {
    let obj;
    try {
      const res = await readProperty(deviceObject, OBJECT_LIST, { arrayIndex: i });
      const val = extractSingleValue(res);
      obj = Array.isArray(val) ? val[0] : val;
    } catch (err) {
      console.warn(`Failed to read object list index ${i}:`, err?.message || err);
      continue;
    }

    if (!obj || typeof obj.type !== 'number' || typeof obj.instance !== 'number') {
      continue;
    }

    if (!WRITABLE_TYPES.has(obj.type)) continue;

    let present;
    try {
      const res = await readProperty(obj, PRESENT_VALUE);
      present = extractSingleValue(res);
    } catch (err) {
      unknown.push({ obj, reason: 'read present value failed' });
      continue;
    }

    if (typeof present !== 'number') {
      unknown.push({ obj, reason: `non-numeric present value (${typeof present})` });
      continue;
    }

    try {
      await writeProperty(obj, tagForType(obj.type), present, 16);
      rw.push(obj);
    } catch (err) {
      const message = String(err?.message || err);
      if (message.includes('Code:40') || message.includes('Code:9')) {
        ro.push(obj);
      } else {
        unknown.push({ obj, reason: message });
      }
    }

    // be gentle
    await sleep(25);
  }

  console.log('RW objects:');
  rw.forEach((o) => console.log(`  ${o.type}:${o.instance}`));

  console.log('\nRO objects (write denied):');
  ro.forEach((o) => console.log(`  ${o.type}:${o.instance}`));

  console.log('\nUnknown (errors/non-numeric):');
  unknown.forEach((o) => {
    console.log(`  ${o.obj?.type}:${o.obj?.instance} (${o.reason})`);
  });

  client.close();
}

main().catch((err) => {
  console.error(err);
  client.close();
  process.exit(1);
});
