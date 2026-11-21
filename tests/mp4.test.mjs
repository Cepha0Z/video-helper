import test from 'node:test';
import assert from 'node:assert/strict';
import { setMp4Duration } from '../src/core/mp4.js';

function box(type,payload) {
  const bytes = new Uint8Array(8+payload.length), view = new DataView(bytes.buffer);
  view.setUint32(0,bytes.length); bytes.set(new TextEncoder().encode(type),4); bytes.set(payload,8); return bytes;
}
function timing(type,scale,version=0) {
  const payload = new Uint8Array(56),view = new DataView(payload.buffer); payload[0] = version;
  if (type !== 'tkhd') view.setUint32(version ? 20 : 12,scale);
  const offset = type === 'tkhd' ? (version ? 28 : 20) : (version ? 24 : 16);
  if (version) view.setBigUint64(offset,0xffffffffffffffffn); else view.setUint32(offset,0xffffffff);
  return box(type,payload);
}
test('writes movie and track durations in their own timescales without mutating input', () => {
  const input = box('moov',new Uint8Array([...timing('mvhd',1000),...box('trak',new Uint8Array([
    ...timing('tkhd'),...box('mdia',timing('mdhd',48000))]))]));
  const output = setMp4Duration(input,12);
  assert.notDeepEqual(output,input);
  const view = new DataView(output.buffer);
  assert.equal(view.getUint32(8+24),12000);
  assert.equal(view.getUint32(8+64+8+28),12000);
  assert.equal(view.getUint32(8+64+8+64+8+24),576000);
});
test('supports version 1 timestamps and rejects malformed initialization data', () => {
  const input = box('moov',timing('mvhd',1000,1));
  const output = setMp4Duration(input,12);
  assert.equal(new DataView(output.buffer).getBigUint64(8+32),12000n);
  assert.throws(() => setMp4Duration(new Uint8Array([0,0,0,100,109,111,111,118]),12),/Unsupported/);
  assert.throws(() => setMp4Duration(box('free',new Uint8Array(8)),12),/movie header/);
});
