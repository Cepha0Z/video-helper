import { httpUrl } from './media.js';

export class UnsupportedStream extends Error {
  constructor(message) { super(message); this.name = 'UnsupportedStream'; }
}

export function attributes(input) {
  const result = {};
  const regex = /([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))(?:,|$)/g;
  let match;
  while ((match = regex.exec(input))) result[match[1]] = match[2] ?? match[3];
  return result;
}

function resolve(value, base) {
  const result = httpUrl(value, base);
  if (!result) throw new Error('Playlist contains an invalid media URL.');
  return result;
}

function byteRange(value, previous, url) {
  const match = /^(\d+)(?:@(\d+))?$/.exec(value || '');
  if (!match || +match[1] <= 0) throw new Error('Invalid HLS byte range.');
  if (match[2] === undefined && (!previous || previous.url !== url)) throw new Error('HLS byte range is missing its starting offset.');
  const start = match[2] === undefined ? previous.end + 1 : +match[2];
  const end = start + +match[1] - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) throw new Error('Invalid HLS byte range size.');
  return { start, end };
}

export function parseHls(text, base) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (lines[0] !== '#EXTM3U') throw new Error('The server did not return an HLS playlist. Your session may have expired.');
  const variants = [], renditions = [], segments = [];
  let pendingVariant, duration, pendingRange, previousRange, map = null, previousMapRange;
  let endList = false, playlistType = '', discontinuities = 0;
  for (const line of lines.slice(1)) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) pendingVariant = attributes(line.slice(18));
    else if (line.startsWith('#EXT-X-MEDIA:')) renditions.push(attributes(line.slice(13)));
    else if (line.startsWith('#EXT-X-KEY:') || line.startsWith('#EXT-X-SESSION-KEY:')) {
      const attrs = attributes(line.slice(line.indexOf(':') + 1));
      if (attrs.METHOD !== 'NONE') throw new UnsupportedStream('Encrypted HLS is not supported in this version.');
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = attributes(line.slice(11));
      if (!attrs.URI) throw new Error('HLS initialization segment is missing its URL.');
      const url = resolve(attrs.URI, base);
      const range = attrs.BYTERANGE ? byteRange(attrs.BYTERANGE, previousMapRange, url) : null;
      map = { url, range };
      previousMapRange = range ? { ...range, url } : null;
    } else if (line.startsWith('#EXTINF:')) {
      duration = Number(line.slice(8).split(',')[0]);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid HLS segment duration.');
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) pendingRange = line.slice(17);
    else if (line === '#EXT-X-ENDLIST') endList = true;
    else if (line.startsWith('#EXT-X-PLAYLIST-TYPE:')) playlistType = line.slice(21);
    else if (line === '#EXT-X-DISCONTINUITY') discontinuities++;
    else if (line.startsWith('#EXT-X-PART:') || line.startsWith('#EXT-X-SKIP:')) throw new UnsupportedStream('Low latency and delta HLS playlists are not supported yet.');
    else if (!line.startsWith('#')) {
      if (pendingVariant) {
        const [width, height] = (pendingVariant.RESOLUTION || '').split('x').map(Number);
        variants.push({ url: resolve(line, base), width: width || null, height: height || null,
          bandwidth: Number(pendingVariant['AVERAGE-BANDWIDTH'] || pendingVariant.BANDWIDTH) || 0,
          codecs: pendingVariant.CODECS || '', audio: pendingVariant.AUDIO || null });
        pendingVariant = null;
      } else {
        if (duration === undefined) throw new Error('HLS segment is missing its duration.');
        const url = resolve(line, base);
        const range = pendingRange ? byteRange(pendingRange, previousRange, url) : null;
        segments.push({ url, duration, range, map, discontinuity: discontinuities });
        previousRange = range ? { ...range, url } : null;
        duration = undefined; pendingRange = undefined;
      }
    }
  }
  if (pendingVariant || duration !== undefined || pendingRange !== undefined) throw new Error('HLS playlist is incomplete.');
  if (variants.length) return { type: 'master', variants: variants.sort((a,b) => (b.height || 0) - (a.height || 0) || b.bandwidth - a.bandwidth), renditions };
  if (!segments.length) throw new Error('No video segments were found in this playlist.');
  return { type: 'media', segments, endList, playlistType, duration: segments.reduce((sum, x) => sum + x.duration, 0), discontinuities };
}

export function validateVod(playlist) {
  if (playlist.type !== 'media') throw new Error('Expected a media playlist.');
  if (!playlist.endList) throw new UnsupportedStream('This stream is still live. Live recording is not supported yet.');
  if (playlist.discontinuities) throw new UnsupportedStream('This stream changes its timeline. Discontinuous HLS is not supported yet.');
  const firstMap = JSON.stringify(playlist.segments[0].map);
  if (playlist.segments.some(segment => JSON.stringify(segment.map) !== firstMap)) throw new UnsupportedStream('This stream changes its initialization data. It is not supported yet.');
  return playlist;
}

export function variantLabel(variant) {
  const resolution = variant.width && variant.height ? `${variant.width} × ${variant.height}` : 'Source quality';
  return `${resolution}${variant.bandwidth ? ` · ${Math.round(variant.bandwidth / 1000)} kbps` : ''}`;
}
