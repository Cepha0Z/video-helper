import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPlatformMedia } from '../src/platform.js';
import { normalizeMediaUrl } from '../src/core/media.js';
test('Instagram extracts the current visible player manifest without invoking getters or following React owners',()=>{
  globalThis.location={hostname:'www.instagram.com'};globalThis.innerWidth=1200;globalThis.innerHeight=900;
  const props={manifest:'<MPD><Period/></MPD>',get secret(){assert.fail('Getters must not run');}};
  props._owner={manifest:'<MPD>wrong</MPD>'};
  const video={poster:'https://cdn.example/poster.jpg',duration:16,currentSrc:'blob:abc',getBoundingClientRect:()=>({left:0,top:0,right:600,bottom:800}),__reactFiber$test:{memoizedProps:props}};
  globalThis.document={querySelectorAll:()=>[video],querySelector:()=>({textContent:'Visible reel'})};
  try {const result=collectPlatformMedia();assert.deepEqual(result.manifests,['<MPD><Period/></MPD>']);assert.equal(result.title,'Visible reel');}
  finally {for(const key of ['location','document','innerWidth','innerHeight']) delete globalThis[key];}
});
test('Instagram byte-range offsets collapse to one complete URL while signatures survive',()=>{
  const value='https://instagram.example.fbcdn.net/a.mp4?oh=signature&oe=expiry&bytestart=818&byteend=897';
  assert.equal(normalizeMediaUrl(value),'https://instagram.example.fbcdn.net/a.mp4?oh=signature&oe=expiry');
  assert.equal(normalizeMediaUrl('https://example.com/a.mp4?bytestart=3'),'https://example.com/a.mp4?bytestart=3');
});

test('X groups file fragments and HLS variants by the same video asset',async()=>{
  const {mediaFamily}=await import('../src/core/media.js');
  assert.equal(mediaFamily('https://video.twimg.com/ext_tw_video/123/pu/pl/master.m3u8'),'x:123');
  assert.equal(mediaFamily('https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/init.mp4'),'x:123');
  assert.equal(mediaFamily('https://example.com/ext_tw_video/123/a.mp4'),null);
});
