// Runs in the page's MAIN world. Reads media metadata only; never copies cookies.
export function collectPlatformMedia() {
  if (/(^|\.)instagram\.com$/.test(location.hostname)) {
    const videos=[...document.querySelectorAll('video')].sort((a,b)=>{
      const score=v=>{const r=v.getBoundingClientRect();return Math.max(0,Math.min(r.right,innerWidth)-Math.max(r.left,0))*Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0));};
      return score(b)-score(a);
    });
    const video=videos[0];if(!video) return null;
    const manifests=[],seen=new WeakSet();let budget=12000;
    const visit=(value,depth)=>{
      if(!value || typeof value!=='object' || seen.has(value) || depth>9 || --budget<0) return;
      seen.add(value);
      for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if(!('value' in descriptor) || /^(return|_owner|stateNode|alternate)$/.test(key)) continue;
        const child=descriptor.value;
        if(typeof child==='string' && /^(?:manifest|dash.*manifest|manifest.*dash)$/i.test(key) && child.includes('<MPD') && child.length<2*1024*1024) manifests.push(child);
        else if(typeof child==='object') visit(child,depth+1);
      }
    };
    let fiber=video[Object.keys(video).find(key=>key.startsWith('__reactFiber$'))];
    for(let depth=0;fiber && depth<16 && !manifests.length;depth++,fiber=fiber.return) visit(fiber.memoizedProps,0);
    const title=(document.querySelector('[role="dialog"] h1')?.textContent || document.querySelector('h1')?.textContent || document.querySelector('meta[property="og:title"]')?.content || 'Instagram video').trim().slice(0,200);
    return {type:'instagram',title,thumbnail:video.poster,duration:Number.isFinite(video.duration)?video.duration:undefined,
      manifests:[...new Set(manifests)].slice(0,4),currentSrc:video.currentSrc};
  }
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return null;
  const response=document.getElementById('movie_player')?.getPlayerResponse?.() || globalThis.ytInitialPlayerResponse;
  if (!response?.videoDetails) return null;
  const videoId=new URL(location.href).searchParams.get('v') || location.pathname.split('/')[2];
  if (response.videoDetails.videoId!==videoId) return null;
  const data=response.streamingData || {};
  const observed=performance.getEntriesByType('resource').map(e=>e.name).reverse().find(value=>{
    try {const u=new URL(value);return u.hostname.endsWith('.googlevideo.com') && u.searchParams.get('sabr')==='1';} catch{return false;}
  });
  return {videoId,title:response.videoDetails.title,duration:Number(response.videoDetails.lengthSeconds),
    thumbnail:response.videoDetails.thumbnail?.thumbnails?.at(-1)?.url,
    formats:(data.adaptiveFormats||[]).slice(0,150),
    config:response.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig,
    url:observed || data.serverAbrStreamingUrl,live:!!response.videoDetails.isLiveContent};
}
