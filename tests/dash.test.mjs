import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDash } from '../src/core/dash.js';

test('DASH combines separate Reddit-style video and audio BaseURLs',()=>{
  const result=parseDash(`<MPD mediaPresentationDuration="PT12S"><Period><AdaptationSet mimeType="video/mp4"><Representation id="v" width="640" height="360"><BaseURL>DASH_360.mp4?source=fallback</BaseURL><SegmentBase indexRange="0-500"/></Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation id="a"><BaseURL>DASH_AUDIO.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`,'https://v.redd.it/abc/DASHPlaylist.mpd');
  assert.equal(result.variants[0].height,360);
  assert.equal(result.variants[0].audio.segments[0].url,'https://v.redd.it/abc/DASH_AUDIO.mp4');
  assert.equal(result.duration,12);
});
test('DASH expands bounded timelines, numbering and initialization',()=>{
  const result=parseDash(`<MPD mediaPresentationDuration="PT12S"><Period><AdaptationSet mimeType="video/mp4"><SegmentTemplate timescale="10" startNumber="5" initialization="$RepresentationID$-init.mp4" media="$RepresentationID$-$Number%03d$-$Time$.m4s"><SegmentTimeline><S t="0" d="40" r="2"/></SegmentTimeline></SegmentTemplate><Representation id="v" height="360"/></AdaptationSet></Period></MPD>`,'https://cdn.example/master.mpd');
  assert.deepEqual(result.variants[0].video.segments.map(s=>s.url),['https://cdn.example/v-005-0.m4s','https://cdn.example/v-006-40.m4s','https://cdn.example/v-007-80.m4s']);
  assert.equal(result.variants[0].video.init.url,'https://cdn.example/v-init.mp4');
});
test('DASH rejects protected, live, unbounded and external entity manifests',()=>{
  for(const xml of ['<!DOCTYPE a><MPD/>','<MPD type="dynamic"/>','<MPD><Period><AdaptationSet ContentProtection="x"/></Period></MPD>','<MPD><Period><AdaptationSet mimeType="video/mp4"><Representation id="1"><SegmentTemplate media="$Time$"><SegmentTimeline><S d="5" r="-1"/></SegmentTimeline></SegmentTemplate></Representation></AdaptationSet></Period></MPD>']) assert.throws(()=>parseDash(xml,'https://cdn.example/master.mpd'));
});
