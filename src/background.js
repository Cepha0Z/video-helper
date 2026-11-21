import { VideoPlaybackAbrRequest } from 'googlevideo/protos';
import { collectPlatformMedia } from './platform.js';
import { classify, httpUrl, safeName, normalizeMediaUrl } from './core/media.js';
import { requestContext, addContext, removeContext, contextRules } from './core/contexts.js';
import { collectMedia } from './collect.js';
import { wait } from './core/network.js';

let queue = Promise.resolve(), creating;
const serialized = fn => {const task=queue.then(fn);queue=task.catch(() => {});return task;};
const key = id => `tab:${id}`;
const active = job => ['queued','downloading','finalizing','saving'].includes(job.status);
const read = async (name,fallback) => (await chrome.storage.session.get(name))[name] || fallback;
const getState = id => read(key(id),{tabId:id,pageUrl:'',title:'',candidates:[]});
const getJobs = () => read('jobs',[]);
const engineUrl = () => chrome.runtime.getURL('engine.html');
const errorText = error => (error.message || 'Please retry.').replace(/https?:\/\/[^\s]+/g,'[media server]');

async function badge(id,count) {
  await chrome.action.setBadgeBackgroundColor({tabId:id,color:'#1689b7'}).catch(() => {});
  await chrome.action.setBadgeText({tabId:id,text:count ? String(count) : ''}).catch(() => {});
}
async function hasEngine() {
  return (await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[engineUrl()]})).length > 0;
}
async function ensureEngine() {
  if (await hasEngine()) return;
  if (!creating) creating = chrome.offscreen.createDocument({url:'engine.html',reasons:['BLOBS'],
    justification:'Download multiple videos and finalize MP4 files while the popup is closed.'}).finally(() => {creating=undefined;});
  await creating;
  for(let i=0;i<30;i++) {
    const response=await engine({type:'PING'}).catch(() => null);
    if(response?.ok) return;
    await wait(50);
  }
  throw new Error('Download engine did not start. Please retry.');
}
const engine = message => chrome.runtime.sendMessage({target:'engine',...message});

async function syncWatchers() {
  const {origins=[]} = await chrome.permissions.getAll();
  const matches = origins.filter(origin => /^https?:/.test(origin));
  const registered = await chrome.scripting.getRegisteredContentScripts({ids:['media-watch']});
  if (registered.length) await chrome.scripting.unregisterContentScripts({ids:['media-watch']});
  if (matches.length) await chrome.scripting.registerContentScripts([{id:'media-watch',matches,js:['watch.js'],allFrames:true,runAt:'document_idle',persistAcrossSessions:true}]);
}

const initialized = (async () => {
  if (!await hasEngine()) {
    const jobs = await getJobs();
    for (const job of jobs) if (active(job)) {job.status='failed';job.error='Browser restarted. Retry this download.';}
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:rules.map(rule => rule.id)});
    await chrome.storage.session.set({jobs,contexts:[],inspections:{}});
  }
  await syncWatchers();
})();
initialized.catch(error => console.warn('Video Helper startup:',errorText(error)));
chrome.permissions.onAdded.addListener(() => syncWatchers().catch(() => {}));
chrome.permissions.onRemoved.addListener(() => syncWatchers().catch(() => {}));

async function addCandidate(tabId,url,mime='',source='network',frameId=0,documentUrl='',headers={}) {
  if (!httpUrl(url)) return;
  url=normalizeMediaUrl(url);
  const kind = classify(url,mime);if (!kind) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !httpUrl(tab.url)) return;
  const state = await getState(tabId);
  state.pageUrl=tab.url;state.title ||= tab.title || 'Video';
  const candidate=state.candidates.find(item => item.url===url || kind==='sabr' && item.kind==='sabr');
  if (candidate) {
    if(kind==='sabr') candidate.url=url;
    candidate.sources=[...new Set([...candidate.sources,source])];candidate.mime ||= mime;candidate.lastSeen=Date.now();
    if (headers.referer || headers.origin) candidate.headers=headers;
  } else {
    if (state.candidates.length >= 60) state.candidates.shift();
    state.candidates.push({id:crypto.randomUUID(),url,kind,mime,sources:[source],frameId,documentUrl,headers,firstSeen:Date.now(),lastSeen:Date.now()});
  }
  await chrome.storage.session.set({[key(tabId)]:state});await badge(tabId,state.candidates.length);
}

// Retain only the media playback fields needed by SABR, never arbitrary POST bodies.
chrome.webRequest.onBeforeRequest.addListener(details => {
  if(details.tabId<0 || classify(details.url)!=='sabr') return;
  let playback;
  try {
    const parts=details.requestBody?.raw || [], length=parts.reduce((n,p)=>n+(p.bytes?.byteLength||0),0);
    if(!length || length>1024*1024) return;
    const bytes=new Uint8Array(length);let offset=0;
    for(const part of parts) if(part.bytes){bytes.set(new Uint8Array(part.bytes),offset);offset+=part.bytes.byteLength;}
    const data=VideoPlaybackAbrRequest.decode(bytes), context=data.streamerContext;
    const b64=bytes=>bytes?.length ? btoa(String.fromCharCode(...bytes)) : undefined;
    playback={clientInfo:context?.clientInfo,poToken:b64(context?.poToken),config:b64(data.videoPlaybackUstreamerConfig)};
  } catch {return;}
  initialized.then(()=>serialized(async()=>{
    await addCandidate(details.tabId,details.url,'','player request',details.frameId,details.documentUrl);
    const state=await getState(details.tabId),candidate=state.candidates.find(c=>c.kind==='sabr');
    if(candidate) {candidate.playback={...candidate.playback,...playback};await chrome.storage.session.set({[key(details.tabId)]:state});}
  })).catch(()=>{});
},{urls:['https://*.googlevideo.com/*']},['requestBody']);

const observed = new Map();
chrome.webRequest.onBeforeSendHeaders.addListener(details => {
  if (details.tabId < 0 || !classify(details.url)) return;
  const headers={};
  for (const header of details.requestHeaders || []) {
    const name=header.name.toLowerCase();
    if (name==='referer' || name==='origin') headers[name]=header.value;
  }
  observed.set(details.requestId,headers);
  if (observed.size>200) observed.delete(observed.keys().next().value);
},{urls:['http://*/*','https://*/*']},['requestHeaders','extraHeaders']);
chrome.webRequest.onHeadersReceived.addListener(details => {
  const headers=observed.get(details.requestId)||{};observed.delete(details.requestId);
  const mime=details.responseHeaders?.find(header => header.name.toLowerCase()==='content-type')?.value || '';
  if (details.tabId>=0 && details.statusCode>=200 && details.statusCode<400 && classify(details.url,mime)) {
    initialized.then(() => serialized(() => addCandidate(details.tabId,details.url,mime,'network',details.frameId,details.documentUrl,headers))).catch(() => {});
  }
},{urls:['http://*/*','https://*/*']},['responseHeaders']);

async function acceptSnapshot(tabId,frameId,snapshot) {
  const tab=await chrome.tabs.get(tabId);
  // Messages from an old document must not restore its media after navigation.
  if (frameId===0 && snapshot.url!==tab.url) return getState(tabId);
  for (const entry of (snapshot.entries||[]).slice(-100)) {
    await addCandidate(tabId,entry.url,entry.mime,entry.source || 'player',frameId,snapshot.url);
  }
  const next=await getState(tabId);
  next.pageUrl=tab.url;
  if(frameId===0) next.since=Math.max(next.since||0,snapshot.since||0);
  if (frameId===0 || !next.thumbnail) {
    next.title=String(snapshot.title||tab.title||'Video').slice(0,200);
    const image=snapshot.thumbnail||'';
    if (image.length<100000 && (image.startsWith('data:image/jpeg;base64,') || httpUrl(image))) next.thumbnail=image;
    if (Number.isFinite(snapshot.duration) && snapshot.duration>0) next.duration=snapshot.duration;
  }
  for (const candidate of next.candidates) {
    if (!candidate.manifest && candidate.frameId===frameId && candidate.documentUrl===snapshot.url) {
      candidate.title=next.title;candidate.thumbnail=next.thumbnail;candidate.duration ||= next.duration;
    }
  }
  await chrome.storage.session.set({[key(tabId)]:next});
  return next;
}
async function scan(tabId) {
  const state=await getState(tabId);
  await chrome.scripting.executeScript({target:{tabId,allFrames:true},files:['watch.js']}).catch(() => {});
  const platform=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:collectPlatformMedia}).catch(()=>[]);
  const results=await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:collectMedia,args:[state.since||0]});
  return serialized(async () => {
    for (const result of results) if (result.result) await acceptSnapshot(tabId,result.frameId,result.result);
    const next=await getState(tabId),data=platform[0]?.result;
    if(data?.type==='instagram' && data.manifests?.length) {
      for(const [index,manifest] of data.manifests.entries()) {
        const url=new URL(`__video_helper__/${index}.mpd`,next.pageUrl).href;
        let item=next.candidates.find(c=>c.url===url);
        if(!item) {item={id:crypto.randomUUID(),url,kind:'dash',sources:['player manifest'],frameId:0,documentUrl:next.pageUrl,headers:{}};next.candidates.push(item);}
        Object.assign(item,{manifest,title:data.title,thumbnail:data.thumbnail||next.thumbnail,duration:data.duration});
      }
      await chrome.storage.session.set({[key(tabId)]:next});
    } else if(data?.videoId) {
      next.platform=data;
      for(const candidate of next.candidates) if(candidate.kind==='sabr') {
        candidate.platform=data;candidate.title=data.title;candidate.thumbnail=data.thumbnail;candidate.duration=data.duration;
      }
      await chrome.storage.session.set({[key(tabId)]:next});
    }
    return next;
  });
}
chrome.tabs.onUpdated.addListener((id,changes) => {
  if (changes.status==='loading' || changes.url) initialized.then(() => serialized(async () => {
    await chrome.storage.session.remove(key(id));await badge(id,0);
  })).then(async () => {
    if (!changes.url || changes.status==='loading') return;
    await chrome.scripting.executeScript({target:{tabId:id},func:expected => {
      if(location.href===expected) globalThis.__videoHelperScanRoute={url:expected,since:Math.max(0,performance.now()-750)};
    },args:[changes.url]});
    await chrome.scripting.executeScript({target:{tabId:id},files:['watch.js']});
  }).catch(() => {});
  if (changes.status==='complete') initialized.then(() => scan(id)).catch(() => {});
});
chrome.tabs.onRemoved.addListener(id => serialized(() => chrome.storage.session.remove(key(id))).catch(() => {}));

async function changeContexts(records) {
  const rules=await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:rules.map(rule => rule.id),addRules:contextRules(records,chrome.runtime.id)});
  await chrome.storage.session.set({contexts:records});
}
async function missingAccess(origins) {
  const missing=[];
  for (const origin of origins) if (!await chrome.permissions.contains({origins:[origin]})) missing.push(origin);
  return missing;
}
async function inspectCandidate(tabId,candidateId) {
  await scan(tabId);
  const context=await serialized(async () => {
    const state=await getState(tabId), candidate=state.candidates.find(item => item.id===candidateId);
    if (!candidate) throw new Error('Play the video again to detect it.');
    const context={...candidate,id:`inspect:${crypto.randomUUID()}`,pageUrl:state.pageUrl};
    const inspections=await read('inspections',{});inspections[context.id]=context;
    await chrome.storage.session.set({inspections});return context;
  });
  await ensureEngine();
  const response=await engine({type:'INSPECT',context});
  if (response.error) return response;
  return serialized(async () => {
    const state=await getState(tabId), candidate=state.candidates.find(item => item.id===candidateId);
    if (!candidate) return {result:response.result};
    Object.assign(candidate,response.result,{inspected:true});
    if (candidate.children?.length) for (const child of state.candidates) {
      if (candidate.children.includes(child.url)) child.parentId=candidate.id;
    }
    await chrome.storage.session.set({[key(tabId)]:state});
    return {result:response.result};
  });
}
async function startJob(message) {
  const job=await serialized(async () => {
    const state=await getState(message.tabId), candidate=state.candidates.find(item => item.id===message.candidateId);
    if (!candidate || !candidate.inspected) throw new Error('Wait for video details, then retry.');
    const variant=candidate.variants?.find(item => item.url===message.url);
    if (!variant || variant.blocked) throw new Error('This quality is not supported.');
    const jobs=await getJobs(), duplicate=jobs.find(job => job.selectedUrl===variant.url && active(job));
    if (duplicate) return duplicate;
    const ext=candidate.kind==='file' ? new URL(variant.url).pathname.match(/\.(mp4|webm|mov|m4v|mp3|m4a|ogg|wav)$/i)?.[1] || 'mp4' : 'mp4';
    const job={id:crypto.randomUUID(),tabId:message.tabId,candidateId:candidate.id,sourceUrl:candidate.url,
      selectedUrl:variant.url,pageUrl:state.pageUrl,documentUrl:candidate.documentUrl || state.pageUrl,headers:candidate.headers || {},
      kind:candidate.kind,variant,platform:candidate.platform,playback:candidate.playback,title:String(message.filename || candidate.title || state.title || 'Video').slice(0,200),
      filename:safeName(message.filename || candidate.title || state.title,ext),thumbnail:candidate.thumbnail || state.thumbnail,
      duration:candidate.duration || state.duration,width:variant.width,height:variant.height,status:'queued',progress:0,bytes:0,createdAt:Date.now()};
    await chrome.storage.session.set({jobs:[job,...jobs.filter(active),...jobs.filter(item => !active(item)).slice(0,20)]});return job;
  });
  await ensureEngine();await engine({type:'ENQUEUE',job});return {id:job.id};
}

async function handle(message,sender,isEngine) {
  await initialized;
  const id=message.id;
  if (message.type==='GET_STATE') return {state:await serialized(() => getState(message.tabId)),jobs:await getJobs()};
  if (message.type==='SCAN') return {state:await scan(message.tabId)};
  if (message.type==='INSPECT') return inspectCandidate(message.tabId,message.candidateId);
  if (message.type==='START_JOB') return startJob(message);
  if (message.type==='CANCEL_JOB') {await ensureEngine();return engine({type:'CANCEL',id});}
  if (message.type==='CLEAR_FINISHED') return serialized(async () => {
    await chrome.storage.session.set({jobs:(await getJobs()).filter(active)});return {ok:true};
  });
  if (message.type==='SHOW_FILE') {
    const job=(await getJobs()).find(job => job.id===id);
    if (job?.downloadId!==undefined) await chrome.downloads.show(job.downloadId);return {ok:true};
  }
  if (!isEngine) throw new Error('Unsupported action.');
  if (message.type==='ACCESS') return {missing:await missingAccess(message.origins)};
  if (message.type==='HEARTBEAT') return {ok:true};
  if (message.type==='CONTEXT') return serialized(async () => {
    const inspections=await read('inspections',{}), owner=(await getJobs()).find(job => job.id===id) || inspections[id];
    if (!owner || !httpUrl(message.url)) throw new Error('Download context expired.');
    const origins=[`${new URL(message.url).origin}/*`,`${new URL(owner.documentUrl || owner.pageUrl).origin}/*`];
    if ((await missingAccess(origins)).length) throw new Error('Enable access to this media server.');
    const headers=requestContext(owner.documentUrl || owner.pageUrl,message.url,owner.headers);
    await changeContexts(addContext(await read('contexts',[]),id,message.url,headers));return {ok:true};
  });
  if (message.type==='RELEASE_CONTEXT') return serialized(async () => {
    await changeContexts(removeContext(await read('contexts',[]),id));
    const inspections=await read('inspections',{});delete inspections[id];await chrome.storage.session.set({inspections});return {ok:true};
  });
  if (message.type==='JOB_UPDATE') return serialized(async () => {
    const jobs=await getJobs(), job=jobs.find(job => job.id===id);
    if (job) {
      Object.assign(job,message.patch,{updatedAt:Date.now()});
      if(!active(job)) {delete job.playback;delete job.platform;}
    }
    await chrome.storage.session.set({jobs});return {ok:true};
  });
  if (message.type==='SAVE_FILE') {
    const job=(await getJobs()).find(job => job.id===id);
    if (!job || !message.url?.startsWith(`blob:${chrome.runtime.getURL('')}`)) throw new Error('Invalid output file.');
    const downloadId=await chrome.downloads.download({url:message.url,filename:job.filename,conflictAction:'uniquify',saveAs:false});
    await serialized(async () => {const jobs=await getJobs();const item=jobs.find(item => item.id===id);if(item) item.downloadId=downloadId;await chrome.storage.session.set({jobs});});
    return {downloadId};
  }
  if (message.type==='SAVE_STATE' || message.type==='CANCEL_SAVE') {
    const job=(await getJobs()).find(job => job.id===id);
    if (job?.downloadId===undefined) throw new Error('Saved file is unavailable.');
    if (message.type==='CANCEL_SAVE') {await chrome.downloads.cancel(job.downloadId).catch(() => {});return {ok:true};}
    const [item]=await chrome.downloads.search({id:job.downloadId});
    if (!item) throw new Error('Browser download was removed.');
    return {state:item.state,reason:item.error};
  }
}

chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (message.target && message.target!=='background') return;
  if (sender.id!==chrome.runtime.id) return;
  const ownPage=sender.url?.startsWith(chrome.runtime.getURL(''));
  if (!ownPage) {
    if (message.type!=='DISCOVER' || !sender.tab || !httpUrl(sender.url) || message.snapshot?.url!==sender.url) return;
    initialized.then(() => serialized(() => acceptSnapshot(sender.tab.id,sender.frameId || 0,message.snapshot))).then(() => respond({ok:true}),() => respond({ok:false}));
    return true;
  }
  handle(message,sender,sender.url===engineUrl()).then(result => respond(result || {ok:true}),error => respond({error:errorText(error),origins:error.origins}));
  return true;
});
