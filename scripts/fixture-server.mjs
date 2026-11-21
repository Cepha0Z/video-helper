import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFixtures, fixtureDirectory } from './fixtures.mjs';

export async function startFixtureServer(port = 0) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    requests.push(url.pathname);
    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Video Helper · Local test stream</title><style>body{background:#f5f5ef;color:#243a34;font:16px system-ui;max-width:850px;margin:70px auto;padding:20px}button{padding:14px 22px;background:#286e59;color:white;border:0;border-radius:8px;cursor:pointer}video{width:100%;background:#172c24;border-radius:12px}p{line-height:1.7;color:#64766b}h1{font:48px Georgia}code{background:#e7ecdf;padding:3px}</style></head><body><p>VIDEO HELPER / TEST STREAM</p><h1>A small stream. A real download.</h1><p>This 12-second synthetic video has H.264 video and an AAC tone. Click below to load HLS playlists through Fetch, then open Video Helper and scan this page.</p><video controls src="/direct.mp4"></video><p><button id="load">Load HLS request history</button> <span id="status"></span></p><p>Expected qualities: <code>640 × 360</code> and <code>320 × 180</code>. Download either and verify the 12-second video and audio.</p><script>document.getElementById('load').onclick=async()=>{await fetch('/master.m3u8');await fetch('/360p/playlist.m3u8');document.getElementById('status').textContent='HLS playlists loaded. Ready to scan.'}</script></body></html>`); return;
    }
    const filename = path.resolve(fixtureDirectory, '.' + url.pathname);
    if (!filename.startsWith(fixtureDirectory + path.sep)) { response.writeHead(403); response.end(); return; }
    try {
      const bytes = await readFile(filename);
      response.setHeader('Content-Type', filename.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : filename.endsWith('.ts') ? 'video/mp2t' : 'video/mp4');
      response.setHeader('Access-Control-Allow-Origin','*');
      response.setHeader('Cache-Control','public, max-age=3600');
      const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
      if (match) {
        const start = +match[1], end = match[2] ? +match[2] : bytes.length - 1;
        if (start > end || end >= bytes.length) { response.writeHead(416); response.end(); return; }
        response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length':end-start+1 });
        response.end(bytes.subarray(start, end+1));
      } else { response.setHeader('Content-Length',bytes.length); response.end(bytes); }
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, requests, base: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generateFixtures();
  const { base } = await startFixtureServer(Number(process.env.PORT || 4173));
  console.log(`Local video test: ${base}`);
}
