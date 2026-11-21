import test from 'node:test';
import assert from 'node:assert/strict';
import { sabrVariants } from '../src/adaptive.js';
import { classify } from '../src/core/media.js';
const format=(itag,mimeType,extra)=>({itag,mimeType,lastModified:'123',bitrate:100000,...extra});
test('YouTube SABR offers compatible video plus a separate original AAC audio track',()=>{
  const result=sabrVariants({url:'https://rr1.googlevideo.com/videoplayback?sabr=1',platform:{duration:12,formats:[
    format(137,'video/mp4; codecs="avc1.640028"',{height:1080,width:1920,qualityLabel:'1080p'}),
    format(135,'video/mp4; codecs="avc1.4d401e"',{height:480,width:854,qualityLabel:'480p'}),
    format(399,'video/mp4; codecs="av01.0.08M.08"',{height:1080,qualityLabel:'1080p'}),
    format(140,'audio/mp4; codecs="mp4a.40.2"',{audioQuality:'AUDIO_QUALITY_MEDIUM'})]}});
  assert.deepEqual(result.variants.map(v=>[v.height,v.videoItag,v.audioItag]),[[1080,137,140],[480,135,140]]);
  assert.equal(classify('https://rr1.googlevideo.com/videoplayback?sabr=1'),'sabr');
  assert.equal(classify('https://rr1.googlevideo.com/videoplayback?mime=video%2Fmp4'),'file');
});
test('missing or unsupported SABR metadata cannot become a downloadable empty card',()=>{
  assert.throws(()=>sabrVariants({platform:{formats:[]}}),/Reload/);
  assert.throws(()=>sabrVariants({platform:{live:true,formats:[{}]}}),/Live/);
});
