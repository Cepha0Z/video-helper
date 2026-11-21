// Self contained so the same collector can be injected into already-open tabs.
export function collectMedia(since = 0) {
  const previous=globalThis.__videoHelperScanRoute;
  if (!previous) globalThis.__videoHelperScanRoute={url:location.href,since:0};
  else if(previous.url!==location.href) globalThis.__videoHelperScanRoute={url:location.href,since:Math.max(0,performance.now()-500)};
  since=Math.max(since,globalThis.__videoHelperScanRoute.since);
  const usable = value => { if(!value) return ''; try { const url = new URL(value,location.href); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch { return ''; } };
  const media = [...document.querySelectorAll('video,audio')];
  const video = media.filter(node => node.tagName === 'VIDEO').sort((a,b) => b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
  const caption=/(^|\.)(?:x|twitter)\.com$/.test(location.hostname) ? document.querySelector('[data-testid="tweetText"]')?.textContent : '';
  const title = (caption || document.querySelector('h1')?.textContent || document.querySelector('meta[property="og:title"]')?.content || document.title).trim().slice(0,200);
  let thumbnail = usable(video?.poster || document.querySelector('meta[property="og:image"]')?.content || '');
  if (video?.readyState >= 2 && video.videoWidth) {
    try {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = Math.round(320*video.videoHeight/video.videoWidth);
      if (canvas.height > 320) canvas.height = 180;
      canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
      thumbnail = canvas.toDataURL('image/jpeg',.65);
    } catch { /* Cross-origin players may prohibit canvas snapshots; use poster. */ }
  }
  const entries = performance.getEntriesByType('resource').filter(entry => entry.startTime >= since && /(?:\.(?:m3u8|mpd|mp4|webm|m4a|mp3)(?:[?#]|$)|\/videoplayback\?)/i.test(entry.name))
    .map(entry => ({url:entry.name,source:'page history'}));
  for (const element of document.querySelectorAll('video,audio,video source,audio source')) {
    const url = usable(element.currentSrc || element.src || '');
    if (url) entries.push({url,mime:element.type || '',source:'player'});
  }
  for(const element of document.querySelectorAll('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"],meta[name="twitter:player:stream"]')) {
    const url=usable(element.content);if(url) entries.push({url,source:'page metadata'});
  }
  return {url:location.href,title,thumbnail,since,duration:Number.isFinite(video?.duration) ? video.duration : null,entries:entries.slice(-100)};
}
