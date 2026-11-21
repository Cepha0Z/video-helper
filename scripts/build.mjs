import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('extension', 'dist', { recursive: true });
await build({ entryPoints: ['src/background.js', 'src/popup.js', 'src/engine.js', 'src/watch.js'], bundle: true,
  outdir: 'dist', format: 'esm', target: ['chrome120'], legalComments: 'eof', minify: false });
await mkdir('dist/licenses', { recursive: true });
for(const name of ['googlevideo','fast-xml-parser']) await cp(`node_modules/${name}/LICENSE`, `dist/licenses/${name.replaceAll('/','-')}-LICENSE.txt`);
await cp('licenses/protobuf-LICENSE.txt','dist/licenses/protobuf-LICENSE.txt');
await cp('node_modules/mux.js/LICENSE', 'dist/licenses/mux.js-LICENSE.txt');
await cp('node_modules/mediabunny/LICENSE', 'dist/licenses/mediabunny-LICENSE.txt');
for (const [name, filename] of [['@babel/runtime','LICENSE'],['global','LICENSE'],['min-document','LICENCE'],['dom-walk','LICENCE'],['process','LICENSE']]) {
  await cp(`node_modules/${name}/${filename}`, `dist/licenses/${name.replaceAll('/','-')}-LICENSE.txt`);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([header, body, crc]);
}
function icon(size) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = x / size, ny = y / size;
    const stem = nx > .46 && nx < .54 && ny > .21 && ny < .59;
    const head = ny > .44 && ny < .69 && Math.abs(nx - .5) < (ny - .43) * .95 && Math.abs(nx - .5) > Math.max(0, (ny - .55) * .95);
    const bottom = ny > .77 && ny < .82 && nx > .25 && nx < .75;
    const white = stem || head || bottom;
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    pixels.set(white ? [245, 249, 240, 255] : [40, 110, 89, 255], offset);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
await mkdir('dist/icons', { recursive: true });
for (const size of [16,48,128]) await writeFile(`dist/icons/${size}.png`, icon(size));
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
console.log(`Built ${manifest.name} ${manifest.version} → dist/`);
