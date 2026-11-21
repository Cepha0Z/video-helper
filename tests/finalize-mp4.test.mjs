import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TsRemuxer } from '../src/core/remux.js';
import { finalizeMp4 } from '../src/core/finalize-mp4.js';
import { Input, BlobSource, MP4, EncodedPacketSink } from 'mediabunny';

test('finalizes actual TS output into indexed MP4 while preserving encoded audio/video packets', async () => {
  const mux = new TsRemuxer();
  const ts = await readFile('node_modules/mux.js/test/segments/test-segment.ts');
  const fragments = new Blob(mux.push(ts)); mux.dispose();
  const writes = [];
  await finalizeMp4(fragments, async (data, position) => writes.push({data:data.slice(),position}));
  const size = Math.max(...writes.map(write => write.position + write.data.length));
  const bytes = new Uint8Array(size);
  for (const write of writes) bytes.set(write.data,write.position);
  const view = new DataView(bytes.buffer);
  const roots = [];
  for (let offset = 0; offset < bytes.length;) {
    const small = view.getUint32(offset);
    const length = small === 1 ? Number(view.getBigUint64(offset + 8)) : small;
    assert.ok(length >= 8 && offset + length <= bytes.length);
    roots.push(String.fromCharCode(...bytes.subarray(offset + 4,offset + 8)));
    offset += length;
  }
  assert.ok(roots.includes('moov') && roots.includes('mdat'));
  assert.ok(!roots.includes('moof'),'Saved file must not depend on streaming fragments');
  const original = new Input({source:new BlobSource(fragments),formats:[MP4]});
  const finalized = new Input({source:new BlobSource(new Blob([bytes])),formats:[MP4]});
  try {
    for (const method of ['getPrimaryVideoTrack','getPrimaryAudioTrack']) {
      const before = await original[method](), after = await finalized[method]();
      assert.ok(before && after,'Both media tracks must survive finalization');
      const beforePacket = await new EncodedPacketSink(before).getFirstPacket();
      const afterPacket = await new EncodedPacketSink(after).getFirstPacket();
      assert.deepEqual(afterPacket.data,beforePacket.data,'Encoded samples must remain unchanged');
      assert.ok(Math.abs(await before.computeDuration() - await after.computeDuration()) < .05);
    }
  } finally {original.dispose();finalized.dispose();}
});

test('cancellation prevents finalization and invalid input is rejected', async () => {
  const controller = new AbortController();controller.abort();
  await assert.rejects(finalizeMp4(new Blob([]),async () => assert.fail('Must not write'),{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(finalizeMp4(new Blob(['not a video']),async () => {}));
});
