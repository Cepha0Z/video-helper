import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHls, attributes, validateVod, variantLabel } from '../src/core/hls.js';
const base = 'https://media.example/course/master.m3u8?token=private';

test('master uses declared resolutions, resolves paths, and sorts highest first', () => {
  const result = parseHls(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=260198,RESOLUTION=852x480\n480p/playlist.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=416944,RESOLUTION=1600x900,CODECS="avc1.64001f,mp4a.40.2"\n1080p/playlist.m3u8`, base);
  assert.equal(result.type, 'master');
  assert.equal(result.variants[0].height, 900);
  assert.equal(result.variants[0].url, 'https://media.example/course/1080p/playlist.m3u8');
  assert.equal(result.variants[0].codecs, 'avc1.64001f,mp4a.40.2');
  assert.equal(variantLabel(result.variants[0]), '1600 × 900 · 417 kbps');
});

test('quoted attribute values retain commas', () => {
  assert.deepEqual(attributes('TYPE=AUDIO,GROUP-ID="main",NAME="English, original",URI="a.m3u8"'),
    { TYPE:'AUDIO', 'GROUP-ID':'main', NAME:'English, original', URI:'a.m3u8' });
});

test('VOD preserves order, fractional durations, and segment query parameters', () => {
  const result = validateVod(parseHls('\uFEFF#EXTM3U\r\n#EXT-X-PLAYLIST-TYPE:VOD\r\n#EXTINF:6.76,\r\na.ts?sig=one\r\n#EXTINF:3.08,\r\nb.ts?sig=two\r\n#EXT-X-ENDLIST\r\n', base));
  assert.equal(result.segments.length, 2);
  assert.equal(result.duration, 9.84);
  assert.equal(result.segments[1].url, 'https://media.example/course/b.ts?sig=two');
  assert.equal(result.playlistType, 'VOD');
});

test('fragmented MP4 init and byte ranges are parsed correctly', () => {
  const result = parseHls('#EXTM3U\n#EXT-X-MAP:URI="file.mp4",BYTERANGE="100@0"\n#EXTINF:2,\n#EXT-X-BYTERANGE:20@100\nfile.mp4\n#EXTINF:2,\n#EXT-X-BYTERANGE:30\nfile.mp4\n#EXT-X-ENDLIST', base);
  assert.deepEqual(result.segments[0].map.range, {start:0,end:99});
  assert.deepEqual(result.segments[1].range, {start:120,end:149});
  validateVod(result);
});

test('implicit ranges cannot inherit offsets from a different resource', () => {
  assert.throws(() => parseHls('#EXTM3U\n#EXTINF:2,\n#EXT-X-BYTERANGE:20\na.ts\n#EXT-X-ENDLIST', base), /starting offset/);
  assert.throws(() => parseHls('#EXTM3U\n#EXTINF:2,\n#EXT-X-BYTERANGE:20@0\na.ts\n#EXTINF:2,\n#EXT-X-BYTERANGE:20\nb.ts\n#EXT-X-ENDLIST', base), /starting offset/);
});

test('rejects encrypted media before requesting any segments', () => {
  for (const tag of ['#EXT-X-KEY:METHOD=AES-128,URI="key"', '#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="key"']) {
    assert.throws(() => parseHls(`#EXTM3U\n${tag}\n#EXTINF:2,\na.ts\n#EXT-X-ENDLIST`, base), /Encrypted/);
  }
});

test('rejects live, discontinuous, changing init, invalid and unfinished manifests', () => {
  assert.throws(() => validateVod(parseHls('#EXTM3U\n#EXTINF:2,\na.ts', base)), /live/);
  assert.throws(() => validateVod(parseHls('#EXTM3U\n#EXTINF:2,\na.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:2,\nb.ts\n#EXT-X-ENDLIST', base)), /timeline/);
  assert.throws(() => validateVod(parseHls('#EXTM3U\n#EXT-X-MAP:URI="init1.mp4"\n#EXTINF:2,\na.m4s\n#EXT-X-MAP:URI="init2.mp4"\n#EXTINF:2,\nb.m4s\n#EXT-X-ENDLIST', base)), /initialization/);
  assert.throws(() => parseHls('<html>Login required</html>', base), /session/);
  assert.throws(() => parseHls('#EXTM3U\n#EXTINF:2,', base), /incomplete/);
  assert.throws(() => parseHls('#EXTM3U\n#EXTINF:NaN,\na.ts', base), /duration/);
  assert.throws(() => parseHls('#EXTM3U\n#EXTINF:2,\nfile:///etc/passwd', base), /invalid media URL/);
});
