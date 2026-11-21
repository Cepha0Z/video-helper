import { Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, StreamTarget, Conversion, QUALITY_HIGH } from 'mediabunny';

// Use native browser codecs only when a source codec would break native MP4
// playback (e.g. Instagram VP9-in-MP4). H.264/AAC still use packet copying.
export async function needsCompatibilityConversion(file) {
  const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
  try {
    const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();
    return !!(video && !['avc','hevc'].includes(await video.getCodec()) || audio && !['aac','mp3','pcm-s16','pcm-s24'].includes(await audio.getCodec()));
  } finally {input.dispose();}
}
export async function convertCompatibleMp4(file,writeAt,{signal,onProgress=()=>{}}={}) {
  signal?.throwIfAborted();
  const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
  const output=new Output({format:new Mp4OutputFormat({fastStart:false}),target:new StreamTarget(new WritableStream({async write({data,position}){signal?.throwIfAborted();await writeAt(data,position);}}),{chunked:true,chunkSize:1024*1024})});
  let conversion;
  const abort=()=>conversion?.cancel().catch(()=>{});
  try {
    conversion=await Conversion.init({input,output,tracks:'primary',video:{codec:'avc',quality:QUALITY_HIGH},audio:{codec:'aac'},showWarnings:false});
    if(!conversion.isValid || conversion.discardedTracks.length) throw new Error('This browser cannot convert the source codec into a compatible MP4.');
    conversion.onProgress=onProgress;signal?.addEventListener('abort',abort,{once:true});signal?.throwIfAborted();
    await conversion.execute();signal?.throwIfAborted();
  } catch(error){await conversion?.cancel().catch(()=>{});throw error;}
  finally {signal?.removeEventListener('abort',abort);input.dispose();}
}
