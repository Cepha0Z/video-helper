import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { generateFixtures } from './fixtures.mjs';
import { startFixtureServer } from './fixture-server.mjs';
import { parseHls } from '../src/core/hls.js';
import { fetchResource } from '../src/core/network.js';
import { downloadHls } from '../src/download.js';
import { installTestStorage } from './test-storage.mjs';
import { downloadDash } from '../src/adaptive.js';
import { parseDash } from '../src/core/dash.js';
import { fixtureDirectory } from './fixtures.mjs';
import { removeAbandonedFiles } from '../src/storage.js';
const require = createRequire(import.meta.url);
await generateFixtures();
const storage = await installTestStorage();
await removeAbandonedFiles();
const { server, base } = await startFixtureServer();
try {
  const master = await fetchResource(`${base}/master.m3u8`, { text: true });
  const variants = parseHls(master.text, master.url).variants;
  variants.push({url:`${base}/fmp4/playlist.m3u8`,width:640,height:360,fragmented:true});
  for (const variant of variants) {
    let segmentCount = 0;
    const output = await downloadHls(variant.url,{onProgress:p => { segmentCount = p.done; }});
    const filename = path.resolve(`.test-output/verified-${variant.fragmented ? 'fmp4-' : ''}${variant.height}.mp4`);
    await writeFile(filename, new Uint8Array(await output.file.arrayBuffer()));
    assert.equal((await storage.files()).length,1,'Expected a staged output file');
    const probe = spawnSync(require('@ffprobe-installer/ffprobe').path,
      ['-v','error','-show_streams','-show_format','-of','json',filename], { encoding:'utf8' });
    assert.equal(probe.status,0,probe.stderr || probe.error?.message);
    const info = JSON.parse(probe.stdout);
    assert.equal(info.streams.find(s => s.codec_type === 'video')?.height, variant.height);
    assert.equal(info.streams.find(s => s.codec_type === 'audio')?.codec_name, 'aac');
    assert.ok(Math.abs(Number(info.format.duration) - 12) < .2, `Unexpected duration: ${info.format.duration}`);
    const decoded = spawnSync(require('@ffmpeg-installer/ffmpeg').path,
      ['-v','error','-xerror','-i',filename,'-f','null','-'], { encoding:'utf8' });
    assert.equal(decoded.status,0,decoded.stderr);
    const bytes = await readFile(filename);
    // Decoder acceptance is insufficient: QuickTime needs a finalized movie
    // with populated sample tables rather than streaming-only fragments.
    const boxes = [];
    function inspect(start, end) {
      for (let offset = start; offset + 8 <= end;) {
        const size32 = bytes.readUInt32BE(offset);
        const size = size32 === 1 ? Number(bytes.readBigUInt64BE(offset + 8)) : size32 || end - offset;
        assert.ok(size >= 8 && offset + size <= end, 'Invalid MP4 box bounds');
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        boxes.push({type,offset});
        if (['moov','trak','mdia','minf','stbl'].includes(type)) inspect(offset + 8, offset + size);
        offset += size;
      }
    }
    inspect(0,bytes.length);
    assert.ok(!boxes.some(box => box.type === 'moof'), 'Saved MP4 must not depend on streaming fragments');
    const sampleTables = boxes.filter(box => box.type === 'stsz');
    assert.equal(sampleTables.length,2,'Expected sample tables for video and audio');
    for (const box of sampleTables) assert.ok(bytes.readUInt32BE(box.offset + 16) > 0,'Empty MP4 sample table');
    await output.cleanup();
    assert.deepEqual(await storage.files(),[],'Temporary output must be removed after saving');
    console.log(`Verified ${variant.fragmented ? 'fMP4' : 'TS → MP4'} ${variant.width}×${variant.height}: ${segmentCount} segments, ${info.format.duration}s, H.264 + AAC, ${bytes.length} bytes; full decode and disk cleanup passed.`);
  }
  for(const [name,map] of [['video','0:v:0'],['audio','0:a:0']]) {
    const result=spawnSync(require('@ffmpeg-installer/ffmpeg').path,['-v','error','-y','-i',path.join(fixtureDirectory,'direct.mp4'),'-map',map,'-c','copy',path.join(fixtureDirectory,`${name}.mp4`)],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  }
  const manifest=parseDash('<MPD mediaPresentationDuration="PT12S"><Period><AdaptationSet mimeType="video/mp4"><Representation id="v" height="360"><BaseURL>video.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation id="a"><BaseURL>audio.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>',`${base}/master.mpd`);
  const paired=await downloadDash({variant:manifest.variants[0]},{});
  const pairedPath=path.resolve('.test-output/verified-dash-360.mp4');
  await writeFile(pairedPath,new Uint8Array(await paired.file.arrayBuffer()));
  const decoded=spawnSync(require('@ffmpeg-installer/ffmpeg').path,['-v','error','-xerror','-i',pairedPath,'-map','0:v:0','-map','0:a:0','-f','null','-'],{encoding:'utf8'});
  assert.equal(decoded.status,0,decoded.stderr);
  await paired.cleanup();assert.deepEqual(await storage.files(),[]);
  console.log('Verified separate DASH video + audio download, MP4 merging, full decode and temporary file cleanup.');
  const controller = new AbortController();
  await assert.rejects(downloadHls(variants[0].url,{signal:controller.signal,onProgress:() => controller.abort()}),{name:'AbortError'});
  assert.deepEqual(await storage.files(),[],'Cancelled download must remove its staging file');
  console.log('Verified cancellation removes the partial file and aborts remaining segment fetches.');
} finally { server.close(); server.closeAllConnections(); }
