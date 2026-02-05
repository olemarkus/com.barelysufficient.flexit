import assert from 'assert';
import { parseFlexitReply } from '../lib/flexitReplyParser';

console.log('Verifying Flexit Reply Parser...');

// specific test case from user request:
// name: e.g. HvacFnct21y_A
// serial: 800131-008843
// BACnet endpoint string: 192.168.88.32:47808
// FW string

const mockPayloadString = `
some junk
DeviceName: HvacFnct21y_A
SerialNumber: 800131-008843
BACnet: 192.168.88.32:47808
FW: 1.2.3
MAC: 00:11:22:33:44:55
`.trim();

const mockBuffer = Buffer.from(mockPayloadString, 'ascii');
const rinfoAddress = '192.168.88.32';

const result = parseFlexitReply(mockBuffer, rinfoAddress);

if (!result) {
  throw new Error('FAILED: Parser returned null');
}

console.log('Result:', result);

assert.strictEqual(result.serial, '800131-008843');
assert.strictEqual(result.serialNormalized, '800131008843');
assert.strictEqual(result.ip, '192.168.88.32');
assert.strictEqual(result.bacnetPort, 47808);
assert.strictEqual(result.name, 'HvacFnct21y_A');

console.log('PASSED: Parser correctly extracted fields.');
