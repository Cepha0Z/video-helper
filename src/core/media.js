export function httpUrl(value, base) {
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function classify(url, mime = '') {
  const parsed = new URL(url), path = parsed.pathname.toLowerCase();
  if (parsed.hostname.endsWith('.googlevideo.com') && path==='/videoplayback') {
    if(parsed.searchParams.get('sabr')==='1') return 'sabr';
    mime ||= parsed.searchParams.get('mime') || '';
  }
  mime = mime.toLowerCase().split(';')[0].trim();
  if (/\.(ts|m4s|cmfv|cmfa|aac)$/.test(path)) return null;
  if (/\.m3u8$/.test(path) || ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl'].includes(mime)) return 'hls';
  if (/\.mpd$/.test(path) || mime === 'application/dash+xml') return 'dash';
  if (/\.(mp4|webm|mov|m4v|mp3|m4a|ogg|wav)$/.test(path) || /^(video|audio)\//.test(mime) && !/mp2t|mpegurl/.test(mime)) return 'file';
  return null;
}

export function safeName(name, extension = 'mp4') {
  const cleaned = String(name || 'video').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ').replace(/^\.+|[. ]+$/g, '').trim().slice(0, 160) || 'video';
  const stem = cleaned.replace(/\.(mp4|webm|mov|m4v|mp3|m4a|ogg|wav|ts)$/i, '').trim().replace(/[. ]+$/g, '') || 'video';
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem);
  return `${reserved ? '_' : ''}${stem}.${extension}`;
}

export function displayUrl(value) {
  try { const url = new URL(value); return url.hostname + decodeURI(url.pathname); }
  catch { return 'Media stream'; }
}

export function formatBytes(value) {
  if (!value) return '0 B';
  const i = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** i).toFixed(i ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][i]}`;
}

// Instagram adds byte ranges to otherwise complete media URLs. Keep signatures,
// remove only its transport offsets so each file has one candidate.
export function normalizeMediaUrl(value) {
  const url=new URL(value);
  if(/(^|\.)(?:fbcdn\.net|cdninstagram\.com)$/.test(url.hostname) && /\.mp4$/i.test(url.pathname)) {
    url.searchParams.delete('bytestart');url.searchParams.delete('byteend');
  }
  return url.href;
}

export function mediaFamily(value) {
  const url=new URL(value);
  if(url.hostname==='video.twimg.com') {
    const match=/\/(?:ext_tw_video|amplify_video)\/(\d+)\//.exec(url.pathname);
    return match ? `x:${match[1]}` : null;
  }
  return null;
}
