import { parseHls, validateVod, UnsupportedStream } from './core/hls.js';
import { httpUrl } from './core/media.js';
import { fetchResource, orderedDownload } from './core/network.js';
import { TsRemuxer } from './core/remux.js';
import { setMp4Duration } from './core/mp4.js';
import { createStagingFile } from './storage.js';
import { finalizeMp4 } from './core/finalize-mp4.js';

export class HostPermissionError extends Error {
  constructor(origins) { super('Enable access to the media server to continue.'); this.origins = origins; }
}

export async function ensureAccess(urls) {
  const origins = [...new Set(urls.map(url => {
    if (!httpUrl(url)) throw new Error('Invalid media URL.');
    return `${new URL(url).origin}/*`;
  }))];
  const missing = [];
  if (!chrome.permissions?.contains) {
    const response=await chrome.runtime.sendMessage({target:'background',type:'ACCESS',origins});
    if (response.error) throw new Error(response.error);
    if (response.missing?.length) throw new HostPermissionError(response.missing);
    return;
  }
  for (const origin of origins) if (!await chrome.permissions.contains({ origins: [origin] })) missing.push(origin);
  if (missing.length) throw new HostPermissionError(missing);
}

export async function readPlaylist(url, signal, fetcher) {
  await ensureAccess([url]);
  const response = await fetchResource(url, { text: true, signal, fetcher });
  return { playlist: parseHls(response.text, response.url), url: response.url };
}

export async function resolveMedia(url, signal, fetcher) {
  const seen = new Set();
  for (let depth = 0; depth < 5; depth++) {
    if (seen.has(url)) throw new Error('The HLS playlist contains a loop.');
    seen.add(url);
    const { playlist } = await readPlaylist(url, signal, fetcher);
    if (playlist.type === 'media') return validateVod(playlist);
    const selected = playlist.variants[0];
    if (selected.audio && playlist.renditions.some(r => r.TYPE === 'AUDIO' && r['GROUP-ID'] === selected.audio && r.URI)) {
      throw new UnsupportedStream('This stream uses a separate audio playlist. Audio/video track merging is planned for the next version.');
    }
    url = selected.url;
  }
  throw new Error('The HLS playlist has too many nested variants.');
}

export async function downloadHls(url, { signal, fetcher, onProgress = () => {}, onFinalize = () => {} } = {}) {
  const playlist = await resolveMedia(url, signal, fetcher);
  const urls = playlist.segments.map(x => x.url);
  if (playlist.segments[0].map) urls.push(playlist.segments[0].map.url);
  await ensureAccess(urls);
  const estimate = await navigator.storage.estimate();
  if (estimate.quota && estimate.quota - estimate.usage < 64 * 1024 * 1024) throw new Error('Less than 64 MB of temporary storage is available. Free disk space and retry.');
  const staging = await createStagingFile();
  const init = playlist.segments[0].map;
  const remuxer = init ? null : new TsRemuxer({ duration: playlist.duration });
  let bytes = 0, seconds = 0;
  let finalized;
  try {
    if (init) await staging.write(setMp4Duration(await fetchResource(init.url, { signal, range: init.range, fetcher }), playlist.duration));
    await orderedDownload(playlist.segments,
      (segment, index, batchSignal) => fetchResource(segment.url, { signal: batchSignal, range: segment.range, fetcher }),
      async (data, segment) => {
        if (remuxer) for (const output of remuxer.push(data)) await staging.write(output);
        else {
          // An EXT-X-MAP stream should contain ISO BMFF fragments, not TS or an error page.
          const tag = String.fromCharCode(...data.subarray(4, 8));
          if (!['styp', 'moof', 'sidx', 'emsg', 'prft', 'free', 'ftyp'].includes(tag)) throw new Error('Unsupported fragmented MP4 segment.');
          await staging.write(data);
        }
        seconds += segment.duration;
      }, { signal, onProgress: (done, total, size) => { bytes += size; onProgress({ done, total, bytes, seconds, duration: playlist.duration }); } });
    signal?.throwIfAborted();
    const fragments = await staging.finish();
    onFinalize(0);
    finalized = await createStagingFile();
    await finalizeMp4(fragments, (data, position) => finalized.writeAt(data, position), {
      signal, onProgress: timestamp => onFinalize(Math.min(1, timestamp / playlist.duration))
    });
    const file = await finalized.finish();
    if (!file.size) throw new Error('The output file is empty.');
    await staging.remove();
    return { file, cleanup: () => finalized.remove(), duration: playlist.duration };
  } catch (error) {
    await staging.remove();
    await finalized?.remove();
    if (error.name === 'QuotaExceededError') throw new Error('Temporary disk storage is full. Free space and retry.');
    throw error;
  } finally { remuxer?.dispose(); }
}
