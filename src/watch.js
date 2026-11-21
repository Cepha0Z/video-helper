import { collectMedia } from './collect.js';

// Replace the previous watcher when reinjected, including after an unpacked
// extension reload. Old invalidated content-script listeners must not linger.
globalThis.__videoHelperWatching?.stop?.();
{
  let current=location.href,since=0,timer,last='',stopped=false;
  let observer,resources,interval;
  const events=['loadedmetadata','loadeddata','durationchange','play'];
  const stop=()=>{
    stopped=true;clearTimeout(timer);clearInterval(interval);observer?.disconnect();resources?.disconnect();
    for(const name of events) document.removeEventListener(name,schedule,true);
  };
  const send=()=>{
    clearTimeout(timer);if(stopped)return;
    if(location.href!==current){current=location.href;since=Math.max(0,performance.now()-500);last='';}
    const snapshot=collectMedia(since);
    const signature=JSON.stringify([snapshot.url,snapshot.title,snapshot.duration,snapshot.entries.map(e=>e.url),snapshot.thumbnail?.startsWith('data:')]);
    if(signature===last)return;last=signature;
    try {chrome.runtime.sendMessage({target:'background',type:'DISCOVER',snapshot}).catch(()=>{});}
    catch {stop();}
  };
  const schedule=()=>{if(stopped)return;clearTimeout(timer);timer=setTimeout(send,300);};
  for(const name of events) document.addEventListener(name,schedule,true);
  try {resources=new PerformanceObserver(schedule);resources.observe({type:'resource',buffered:true});}catch{}
  observer=new MutationObserver(schedule);observer.observe(document.documentElement,{childList:true,subtree:true});
  interval=setInterval(()=>{if(current!==location.href)schedule();},1000);
  globalThis.__videoHelperWatching={stop};send();
}
