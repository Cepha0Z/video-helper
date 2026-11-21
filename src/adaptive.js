import { needsCompatibilityConversion, convertCompatibleMp4 } from './core/compatible-mp4.js';
import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';
import { SabrStream } from 'googlevideo/sabr-stream';
import { buildSabrFormat } from 'googlevideo/utils';
import { finalizeMp4 } from './core/finalize-mp4.js';
import { fetchResource, orderedDownload } from './core/network.js';
import { createStagingFile } from './storage.js';
import { ensureAccess } from './download.js';

export function sabrVariants(context) {
  const data=context.platform;
  if(!data?.formats?.length) throw new Error('Reload this video, play briefly, then scan again.');
  if(data.live) throw new Error('Live YouTube streams are not supported.');
  const formats=data.formats.map(buildSabrFormat);
  const audio=formats.filter(f=>f.hasAudio && /mp4a/.test(f.mimeType) && !f.isDrc && !f.isDubbed).sort((a,b)=>b.bitrate-a.bitrate)[0];
  if(!audio) throw new Error('No compatible audio track was found.');
  const variants=formats.filter(f=>f.hasVideo && /avc1|avc3/.test(f.mimeType)).sort((a,b)=>b.height-a.height||b.bitrate-a.bitrate).map(f=>({url:`${context.url}#vh=${f.itag}`,width:f.width,height:f.height,videoItag:f.itag,audioItag:audio.itag}));
  if(!variants.length) throw new Error('No compatible H.264 video track was found.');
  return {variants,duration:data.duration};
}
export async function mergeOutputs(video,audio,{signal,duration,onFinalize=()=>{}}={}) {
  const final=await createStagingFile();let compatible;
  try {
    onFinalize(0);
    await finalizeMp4(video.file,(data,position)=>final.writeAt(data,position),{signal,audioFile:audio?.file});
    let file=await final.finish();
    if(await needsCompatibilityConversion(file)) {
      compatible=await createStagingFile();
      await convertCompatibleMp4(file,(data,position)=>compatible.writeAt(data,position),{signal,onProgress:onFinalize});
      file=await compatible.finish();
      await final.remove();
    }
    if(duration>0) {
      const check=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
      try {
        for(const track of [await check.getPrimaryVideoTrack(),...(audio?[await check.getPrimaryAudioTrack()]:[])]) {
          if(!track || Math.abs(await track.computeDuration()-duration)>Math.max(3,duration*.01)) throw new Error('The media stream ended before the full video was downloaded.');
        }
      } finally {check.dispose();}
    }
    if(!file.size) throw new Error('The output file is empty.');
    return {file,cleanup:()=>compatible ? compatible.remove() : final.remove()};
  } catch(error){await final.remove();await compatible?.remove();throw error;}
}
async function stageStream(stream,signal,onBytes) {
  const staging=await createStagingFile(),reader=stream.getReader();
  try {
    while(true) {
      signal?.throwIfAborted();const {value,done}=await reader.read();if(done)break;
      const bytes=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);await staging.write(bytes);onBytes?.(bytes.byteLength);
    }
    return {file:await staging.finish(),cleanup:()=>staging.remove()};
  } catch(error){await staging.remove();throw error;}
  finally {await reader.cancel().catch(()=>{});}
}
export async function downloadSabr(job,{signal,fetcher,onProgress,onFinalize}={}) {
  const data=job.platform,playback=job.playback || {};
  const config=playback.config || data.config;
  if(!config) throw new Error('Play this YouTube video briefly, then scan again.');
  const formats=data.formats.map(buildSabrFormat), selected=job.variant;
  await ensureAccess([job.sourceUrl]);
  const stream=new SabrStream({videoId:data.videoId,serverAbrStreamingUrl:job.sourceUrl,
    videoPlaybackUstreamerConfig:config,clientInfo:playback.clientInfo || {clientName:1,clientVersion:new URL(job.sourceUrl).searchParams.get('cver') || '2.20261119.01.00'},
    poToken:playback.poToken,formats,fetchFunction:async(url,init)=>fetcher(String(url),{...init,signal:AbortSignal.any([signal,init?.signal,AbortSignal.timeout(30000)].filter(Boolean)),credentials:'include'})});
  const abort=()=>stream.abort().catch(()=>{});signal?.addEventListener('abort',abort,{once:true});
  let bytes=0,outputs=[];
  stream.on('error',()=>{}); // Readable streams propagate the same failure to the job.
  try {
    const {videoStream,audioStream}=stream.start({videoFormat:selected.videoItag,audioFormat:selected.audioItag,isPostLiveDvr:false,maxRetries:2,stallDetectionMs:20000});
    const totalBytes=formats.filter(f=>[selected.videoItag,selected.audioItag].includes(f.itag)).reduce((n,f)=>n+(f.contentLength||0),0);
    const progress=size=>{bytes+=size;onProgress?.({bytes,totalBytes});};
    const settled=await Promise.allSettled([stageStream(videoStream,signal,progress),stageStream(audioStream,signal,progress)]);
    outputs=settled.filter(r=>r.status==='fulfilled').map(r=>r.value);
    const error=settled.find(r=>r.status==='rejected');if(error)throw error.reason;
    return await mergeOutputs(outputs[0],outputs[1],{signal,onFinalize,duration:data.duration});
  } finally {await stream.abort().catch(()=>{});signal?.removeEventListener('abort',abort);await Promise.all(outputs.map(o=>o.cleanup()));}
}
async function downloadTrack(track,{signal,fetcher,onBytes}) {
  if(track.segments.length===1 && !track.init && !track.segments[0].range) {
    await ensureAccess([track.segments[0].url]);
    const response=await (fetcher||fetch)(track.segments[0].url,{signal,credentials:'include'});
    if(!response.ok || !response.body || response.status===206) throw new Error('The media server did not return the complete track.');
    return stageStream(response.body,signal,onBytes);
  }
  const staging=await createStagingFile();
  try {
    await ensureAccess([...track.segments.map(s=>s.url),...(track.init?[track.init.url]:[])]);
    if(track.init) await staging.write(await fetchResource(track.init.url,{signal,fetcher,range:track.init.range}));
    await orderedDownload(track.segments,(s,i,signal)=>fetchResource(s.url,{signal,fetcher,range:s.range}),async data=>{await staging.write(data);onBytes(data.byteLength);},{signal});
    return {file:await staging.finish(),cleanup:()=>staging.remove()};
  } catch(error){await staging.remove();throw error;}
}
export async function downloadDash(job,options) {
  let bytes=0,outputs=[];
  const onBytes=size=>{bytes+=size;options.onProgress?.({bytes});};
  try {
    const settled=await Promise.allSettled([job.variant.video,job.variant.audio].filter(Boolean).map(track=>downloadTrack(track,{...options,onBytes})));
    outputs=settled.filter(r=>r.status==='fulfilled').map(r=>r.value);
    const failed=settled.find(r=>r.status==='rejected');if(failed)throw failed.reason;
    return await mergeOutputs(outputs[0],outputs[1],{...options,duration:job.variant.duration});
  } finally {await Promise.all(outputs.map(o=>o.cleanup()));}
}
