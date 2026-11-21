import { mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

// Disk-backed adapter for the browser OPFS API. Used only by Node integration tests.
export async function installTestStorage() {
  const root = path.resolve('.test-output/opfs');
  await mkdir(root,{recursive:true});
  function directory(dirname) {
    return {
      async getDirectoryHandle(name) {
        const target = path.join(dirname,name); await mkdir(target,{recursive:true}); return directory(target);
      },
      async getFileHandle(name) {
        const filename = path.join(dirname,name);
        return {
          async createWritable() {
            const file = await open(filename,'w'); let closed = false;
            return {
              async write(bytes) {
                if (bytes.type === 'write') {
                  let done = 0;
                  while (done < bytes.data.byteLength) {
                    const { bytesWritten } = await file.write(bytes.data, done, bytes.data.byteLength - done, bytes.position + done);
                    done += bytesWritten;
                  }
                } else await file.writeFile(bytes);
              },
              async close() { if (!closed) { closed = true; await file.close(); } },
              async abort() { if (!closed) { closed = true; await file.close(); } }
            };
          },
          async getFile() { return new File([await readFile(filename)],name,{type:'video/mp4'}); }
        };
      },
      async removeEntry(name) { await unlink(path.join(dirname,name)); },
      async *entries() { for (const name of await readdir(dirname)) yield [name,{}]; }
    };
  }
  Object.defineProperty(navigator,'storage',{configurable:true,value:{
    getDirectory:async () => directory(root), estimate:async () => ({quota:1e9,usage:0})
  }});
  globalThis.chrome = {permissions:{contains:async () => true}};
  return { root, async files() { return readdir(path.join(root,'downloads')); } };
}
