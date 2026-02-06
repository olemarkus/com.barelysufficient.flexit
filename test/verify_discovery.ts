import assert from 'assert';
import { parseFlexitReply } from '../lib/flexitReplyParser';

console.log('Verifying Flexit Reply Parser...');

// specific test case from user request:
// name: e.g. HvacFnct21y_A
// serial: 800131-000001
// BACnet endpoint string: 192.0.2.10:47808
// FW string

const mockPayloadString = `
some junk
DeviceName: HvacFnct21y_A
SerialNumber: 800131-000001
BACnet: 192.0.2.10:47808
FW: 1.2.3
MAC: 02:00:00:00:00:01
`.trim();

const mockBuffer = Buffer.from(mockPayloadString, 'ascii');
const rinfoAddress = '192.0.2.10';

const result = parseFlexitReply(mockBuffer, rinfoAddress);

if (!result) {
  throw new Error('FAILED: Parser returned null');
}

console.log('Result:', result);

assert.strictEqual(result.serial, '800131-000001');
assert.strictEqual(result.serialNormalized, '800131000001');
assert.strictEqual(result.ip, '192.0.2.10');
assert.strictEqual(result.bacnetPort, 47808);
assert.strictEqual(result.model, 'S4 REL');
assert.strictEqual(result.name, 'Nordic S4 REL');

console.log('PASSED: Parser correctly extracted fields.');
