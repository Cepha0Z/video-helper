import { parseDash } from './core/dash.js';
import { fetchResource } from './core/network.js';
import { sabrVariants, downloadSabr, downloadDash, mergeOutputs } from './adaptive.js';
import { JobQueue } from './core/job-queue.js';
import { wait } from './core/network.js';
import { requestContext } from './core/contexts.js';
import { readPlaylist, downloadHls, ensureAccess } from './download.js';
import { createStagingFile, removeAbandonedFiles } from './storage.js';

const send = message => chrome.runtime.sendMessage({target:'background',...message});
const ready = removeAbandonedFiles();
const jobs = new Map();
let lastUpdate = new Map();
const update = async (id,patch,force = false) => {
  if (!force && Date.now()-(lastUpdate.get(id)||0) < 400) return;
  lastUpdate.set(id,Date.now());
  await send({type:'JOB_UPDATE',id,patch});
};

function contextFetcher(context) {
  const prepared = new Set();
  let chain = Promise.resolve();
  return async (url,init={}) => {
    const scope = new URL('.',url).href;
    if (!prepared.has(scope)) {
      // Serialize the first requests for each new directory within this job.
      const task = chain.then(async () => {
        if (prepared.has(scope)) return;
        const response = await send({type:'CONTEXT',id:context.id,url,
          headers:requestContext(context.documentUrl || context.pageUrl,url,context.headers)});
        if (response.error) throw new Error(response.error);
        prepared.add(scope);
      });
      chain = task.catch(() => {}); await task;
    }
    init.signal?.throwIfAborted();
    return fetch(url,init);
  };
}

async function inspect(context) {
  const fetcher = contextFetcher(context);
  try {
    if(context.kind==='sabr') return sabrVariants(context);
    if(context.kind==='dash') {
      if(context.manifest) return parseDash(context.manifest,context.documentUrl||context.pageUrl);
      await ensureAccess([context.url]);const response=await fetchResource(context.url,{text:true,fetcher});return parseDash(response.text,response.url);
    }
    if (context.kind === 'file') return {variants:[{url:context.url,direct:true}]};
    const {playlist} = await readPlaylist(context.url,undefined,fetcher);
    if (playlist.type === 'media') return {variants:[{url:context.url,duration:playlist.duration}],duration:playlist.duration,children:playlist.segments.map(s=>s.url)};
    return {variants:playlist.variants.map(variant => ({...variant,
      audioUrl:playlist.renditions.filter(r => r.TYPE === 'AUDIO' && r['GROUP-ID'] === variant.audio && r.URI).sort((a,b)=>Number(b.DEFAULT==='YES')-Number(a.DEFAULT==='YES')).map(r=>new URL(r.URI,context.url).href)[0]})),children:[...playlist.variants.map(variant => variant.url),...playlist.renditions.filter(r=>r.URI).map(r=>new URL(r.URI,context.url).href)]};
  } finally {await send({type:'RELEASE_CONTEXT',id:context.id});}
}

async function downloadFile(job,fetcher,signal,onProgress) {
  await ensureAccess([job.selectedUrl]);
  const response = await fetcher(job.selectedUrl,{credentials:'include',signal,headers:{}});
  if (!response.ok || !response.body) throw new Error(`Media server returned HTTP ${response.status}.`);
  if(response.status===206) {const range=/^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'');if(!range || +range[1]+1!==+range[2]) throw new Error('Only a partial media response was returned. Play again and retry.');}
  if(/text\/html|application\/(?:json|vnd.yt-ump)/i.test(response.headers.get('content-type')||'')) throw new Error('The server returned a media transport or error page instead of a video file.');
  const staging = await createStagingFile();
  let bytes = 0;
  try {
    const reader = response.body.getReader();
    try {
      while (true) {
        signal.throwIfAborted();
        const {value,done} = await reader.read(); if (done) break;
        await staging.write(value); bytes += value.byteLength;
        onProgress({bytes,totalBytes:Number(response.headers.get('content-length'))||0});
      }
    } finally {await reader.cancel().catch(() => {});}
    if(!bytes) throw new Error('The downloaded file is empty.');
    const expected=Number(response.headers.get('content-length'));
    if(expected && expected!==bytes) throw new Error('The downloaded file is incomplete.');
    return {file:await staging.finish(),cleanup:() => staging.remove()};
  } catch (error) {await staging.remove();throw error;}
}

async function run(job,signal) {
  await ready;
  jobs.set(job.id,job);
  let output,blobUrl,downloadId;
  try {
    await update(job.id,{status:'downloading',progress:0},true);
    const fetcher = contextFetcher(job);
    const onProgress = progress => {
      const fraction = progress.total ? progress.done/progress.total : progress.totalBytes ? progress.bytes/progress.totalBytes : 0;
      update(job.id,{status:'downloading',progress:Math.min(95,fraction*95),bytes:progress.bytes,done:progress.done,total:progress.total}).catch(() => {});
    };
    const options={signal,fetcher,onProgress,onFinalize:progress=>update(job.id,{status:'finalizing',progress:95+(progress||0)*4}).catch(()=>{})};
    if(job.kind==='sabr') output=await downloadSabr(job,options);
    else if(job.kind==='dash') output=await downloadDash(job,options);
    else if(job.kind==='hls' && job.variant?.audioUrl) {
      let parts=[];
      try {
        const results=await Promise.allSettled([job.selectedUrl,job.variant.audioUrl].map(url=>downloadHls(url,options)));
        parts=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
        const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
        output=await mergeOutputs(parts[0],parts[1],options);
      } finally {await Promise.all(parts.map(p=>p.cleanup()));}
    }
    else if (job.kind === 'file') output = await downloadFile(job,fetcher,signal,onProgress);
    else output = await downloadHls(job.selectedUrl,{signal,fetcher,onProgress,onFinalize:progress => {
      update(job.id,{status:'finalizing',progress:95+progress*4}).catch(() => {});
    }});
    signal.throwIfAborted();
    blobUrl = URL.createObjectURL(output.file);
    await update(job.id,{status:'saving',progress:99,bytes:output.file.size},true);
    const saved = await send({type:'SAVE_FILE',id:job.id,url:blobUrl});
    if (saved.error) throw new Error(saved.error);
    downloadId = saved.downloadId;
    if (signal.aborted) await send({type:'CANCEL_SAVE',id:job.id});
    while (true) {
      signal.throwIfAborted();
      const response = await send({type:'SAVE_STATE',id:job.id});
      if (response.error) throw new Error(response.error);
      if (response.state === 'complete') break;
      if (response.state === 'interrupted') throw new Error(response.reason === 'USER_CANCELED' ? 'Download cancelled.' : 'Browser save interrupted.');
      await wait(500,signal);
    }
    await update(job.id,{status:'complete',progress:100,bytes:output.file.size,downloadId},true);
  } catch (error) {
    if (downloadId !== undefined && signal.aborted) await send({type:'CANCEL_SAVE',id:job.id}).catch(() => {});
    const cancelled = signal.aborted || /cancel/i.test(error.message);
    await update(job.id,{status:cancelled ? 'cancelled' : 'failed',error:cancelled ? '' : error.message.replace(/https?:\/\/[^\s]+/g,'[media server]')},true);
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    await output?.cleanup();
    await send({type:'RELEASE_CONTEXT',id:job.id}).catch(() => {});
    jobs.delete(job.id);lastUpdate.delete(job.id);
  }
}

const queue = new JobQueue(run,{limit:3});
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (message.target !== 'engine' || sender.id !== chrome.runtime.id) return;
  if (message.type === 'INSPECT') {
    inspect(message.context).then(result => respond({result}),error => respond({error:error.message,origins:error.origins}));
    return true;
  }
  if (message.type === 'ENQUEUE') {queue.add(message.job);respond({ok:true});}
  if (message.type === 'CANCEL') {
    const result = queue.cancel(message.id);
    if (result === 'queued') update(message.id,{status:'cancelled'},true).catch(() => {});
    respond({ok:true});
  }
  if (message.type === 'PING') respond({ok:true,ids:[...queue.active.keys(),...queue.pending.map(job => job.id)]});
});
// Keeps status available if Chrome restarts the service worker during a long job.
setInterval(() => {if (queue.active.size || queue.pending.length) send({type:'HEARTBEAT'}).catch(() => {});},15000);
