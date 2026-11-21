import { readFile, open, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { finalizeMp4 } from '../src/core/finalize-mp4.js';

const [source, destination] = process.argv.slice(2);
if (!source || !destination || path.resolve(source) === path.resolve(destination)) {
  throw new Error('Usage: node scripts/repair-mp4.mjs input.mp4 new-output.mp4');
}
await mkdir(path.dirname(destination), {recursive:true});
const file = new Blob([await readFile(source)]);
const output = await open(destination, 'wx');
try {
  await finalizeMp4(file, async (bytes, position) => {
    let done = 0;
    while (done < bytes.length) {
      const {bytesWritten} = await output.write(bytes, done, bytes.length - done, position + done);
      done += bytesWritten;
    }
  });
  await output.close();
  console.log(`Finalized MP4 without re-encoding: ${path.resolve(destination)}`);
} catch (error) {
  await output.close(); await unlink(destination).catch(() => {}); throw error;
}
