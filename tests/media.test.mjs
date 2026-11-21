import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, httpUrl, safeName, displayUrl } from '../src/core/media.js';

test('detects HLS via extension or MIME and DASH separately', () => {
  assert.equal(classify('https://cdn.example/a.M3U8?sig=x'), 'hls');
  assert.equal(classify('https://cdn.example/stream','application/vnd.apple.mpegurl; charset=utf-8'), 'hls');
  assert.equal(classify('https://cdn.example/manifest.mpd'), 'dash');
  assert.equal(classify('https://cdn.example/stream','video/mp4'), 'file');
});
test('segments do not become hundreds of individual download candidates', () => {
  for (const extension of ['ts','m4s','cmfv','cmfa','aac']) assert.equal(classify(`https://cdn.example/seg.${extension}`,'video/mp4'),null);
  assert.equal(classify('https://cdn.example/a.ts','video/mp2t'),null);
});
test('only HTTP(S) URLs without embedded credentials are accepted', () => {
  for (const value of ['blob:https://example.com/x','javascript:alert(1)','file:///tmp/x','https://user:pass@example.com']) assert.equal(httpUrl(value),null);
  assert.equal(httpUrl('../stream.m3u8','https://example.com/course/a'),'https://example.com/stream.m3u8');
});
test('file names are safe on supported operating systems', () => {
  assert.equal(safeName('../a/b:video?.mp4'),'a b video.mp4');
  assert.equal(safeName('CON'),'_CON.mp4');
  assert.equal(safeName('   '),'video.mp4');
  assert.equal(safeName('Class | 24/01/2026'),'Class 24 01 2026.mp4');
  assert.equal(safeName('Lesson.webm','webm'),'Lesson.webm');
});
test('display URLs omit signatures and query data', () => {
  assert.equal(displayUrl('https://cdn.example/file.m3u8?token=secret#fragment'),'cdn.example/file.m3u8');
});
