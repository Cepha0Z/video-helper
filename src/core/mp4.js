// Streaming init segments often declare unknown (0xffffffff) track durations.
// A saved MP4 needs the VOD duration in each header, in that header's timescale.
export function setMp4Duration(input, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid output duration.');
  const bytes = input.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headers = [];
  function walk(start, end) {
    for (let offset = start; offset + 8 <= end;) {
      const size = view.getUint32(offset);
      if (size < 8 || offset + size > end) throw new Error('Unsupported MP4 initialization data.');
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (['moov', 'trak', 'mdia'].includes(type)) walk(offset + 8, offset + size);
      if (['mvhd', 'tkhd', 'mdhd'].includes(type)) headers.push({type, offset, size});
      offset += size;
    }
  }
  walk(0, bytes.length);
  const movie = headers.find(header => header.type === 'mvhd');
  if (!movie) throw new Error('MP4 initialization data has no movie header.');
  function timeInfo(header) {
    const version = view.getUint8(header.offset + 8);
    if (version !== 0 && version !== 1) throw new Error('Unsupported MP4 timing version.');
    const timescaleOffset = header.offset + (version === 1 ? 28 : 20);
    const durationOffset = header.offset + (header.type === 'tkhd' ? (version === 1 ? 36 : 28) : (version === 1 ? 32 : 24));
    if (durationOffset + (version === 1 ? 8 : 4) > header.offset + header.size) throw new Error('Truncated MP4 timing header.');
    return { version, timescaleOffset, durationOffset };
  }
  const movieScale = view.getUint32(timeInfo(movie).timescaleOffset);
  for (const header of headers) {
    const {version, timescaleOffset, durationOffset} = timeInfo(header);
    const scale = header.type === 'tkhd' ? movieScale : view.getUint32(timescaleOffset);
    const ticks = Math.round(seconds * scale);
    if (!scale || !Number.isSafeInteger(ticks) || version === 0 && ticks >= 0xffffffff) throw new Error('This video exceeds the supported MP4 duration.');
    if (version === 1) view.setBigUint64(durationOffset, BigInt(ticks));
    else view.setUint32(durationOffset, ticks);
  }
  return bytes;
}
